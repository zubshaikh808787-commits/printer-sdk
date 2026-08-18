import { exec } from 'child_process';
import util from 'util';
import os from 'os';
import fs from 'fs';
import path from 'path';
import logger from '../../logger';
import { PrintResult, V1PrinterProfileBrand } from '../../../shared/types';
import { sendRawBytesToPrinterQueue } from '../util/WinSpoolRawPrint';
import { DriverManager } from '../DriverManager';

const execPromise = util.promisify(exec);

// Opens and immediately closes the COM port — a near-instant liveness probe.
// This is NOT the old persistent-hold approach (which blocked the Windows
// spooler); it's a fire-and-forget open/close, same as any app briefly
// touching the port, so it's safe to run even while a print queue exists on it.
const REACHABILITY_PROBE_SCRIPT = `param(
    [string]$PortName
)

$ErrorActionPreference = 'Stop'

try {
    $port = New-Object System.IO.Ports.SerialPort $PortName, 9600, ([System.IO.Ports.Parity]::None), 8, ([System.IO.Ports.StopBits]::One)
    $port.Open()
    Start-Sleep -Milliseconds 150
    $port.Close()
    Write-Output "OK"
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
`;

// ============================================================================
// A Bluetooth SPP printer only really "exists" to the rest of Windows once it
// is registered as a normal printer QUEUE bound to its "Standard Serial over
// Bluetooth link (COMx)" port — exactly like a USB or network printer. Once
// that queue exists, it shows up in every app's Print dialog (Ctrl+P), and
// Windows' own spooler owns opening/closing the COM port per job, so there is
// no conflict with other apps (or SEZNIK) printing to it at the same time.
//
// An earlier version of this transport tried to hold the COM port open
// itself to keep the Bluetooth link "alive" — that's exactly backwards: it
// blocked the Windows spooler from ever reaching the port, which is why the
// printer never showed up for Ctrl+P printing. Don't reintroduce that.
// ============================================================================

export interface RegisterQueueResult {
  success: boolean;
  message: string;
  driverUsed: string;
}

export class BluetoothPrinterTransport {
  /** Local Port monitor naming convention Windows uses for serial ports (e.g. "COM5:"). */
  private toLocalPortName(comPort: string): string {
    return comPort.endsWith(':') ? comPort : `${comPort}:`;
  }

  /** Driver-name keywords to prefer per hardware brand, mirroring DriverManager's USB driver discovery. */
  private driverKeywordsForBrand(brand: V1PrinterProfileBrand): string[] {
    switch (brand) {
      case 'JOSH':
        return ['dp27', 'josh', 'detong', 'ld0801', 'label'];
      case 'DEV':
        return ['dev', 'sz-80d', 'pos80', 'pos58', 'veer'];
      case 'VEER':
      default:
        return ['pos58', 'pos-58', '58mm', 'veer'];
    }
  }

  /**
   * Finds an already-installed printer driver that matches the given brand
   * (e.g. one the USB setup pipeline installed earlier) so Ctrl+P image/photo
   * jobs get rasterized correctly instead of being silently dropped by a
   * text-only driver.
   */
  private async findPreferredDriver(brand: V1PrinterProfileBrand): Promise<string | null> {
    if (os.platform() !== 'win32') return null;
    try {
      const psCmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-PrinterDriver -ErrorAction SilentlyContinue | Select-Object Name | ConvertTo-Json"`;
      const { stdout } = await execPromise(psCmd);
      if (!stdout || stdout.trim() === '') return null;
      const parsed = JSON.parse(stdout);
      const list: any[] = Array.isArray(parsed) ? parsed : [parsed];
      const keywords = this.driverKeywordsForBrand(brand);
      const found = list.find((d: any) => {
        const n = String(d.Name || '').toLowerCase();
        return keywords.some(k => n.includes(k));
      });
      return found?.Name || null;
    } catch (err: any) {
      logger.warn(`[BluetoothPrinterTransport] Driver discovery notice: ${err.message}`);
      return null;
    }
  }

  /**
   * Ensures a real Windows printer queue exists on the given Bluetooth COM
   * port. Idempotent — safe to call again to "reconnect" or rebind after the
   * COM port number changes across a re-pair.
   */
  async registerPrinterQueue(comPort: string, queueName: string, brand: V1PrinterProfileBrand): Promise<RegisterQueueResult> {
    if (os.platform() !== 'win32') {
      return { success: false, message: 'Bluetooth printer registration is only supported on Windows.', driverUsed: '' };
    }

    const portName = this.toLocalPortName(comPort);
    let preferredDriver = await this.findPreferredDriver(brand);

    // If official driver (e.g. POS58) is not yet in Driver Store, auto-install from bundled driver package
    if (!preferredDriver) {
      try {
        logger.info(`[BluetoothPrinterTransport] Driver not yet installed for [${brand}]. Auto-installing bundled driver package...`);
        const driverManager = new DriverManager();
        await driverManager.installDriverAutomatically(brand);
        preferredDriver = await this.findPreferredDriver(brand);
      } catch (eDrv: any) {
        logger.warn(`[BluetoothPrinterTransport] Auto driver installation notice: ${eDrv.message}`);
      }
    }

    const driverName = preferredDriver || 'POS58';

    // Escape single quotes defensively — printer/device display names can contain them.
    const esc = (s: string) => s.replace(/'/g, "''");

    try {
      const psCmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='SilentlyContinue'; if (-not (Get-PrinterPort -Name '${esc(portName)}' -ErrorAction SilentlyContinue)) { Add-PrinterPort -Name '${esc(portName)}' -ErrorAction SilentlyContinue }; if (-not (Get-Printer -Name '${esc(queueName)}' -ErrorAction SilentlyContinue)) { Add-Printer -Name '${esc(queueName)}' -DriverName '${esc(driverName)}' -PortName '${esc(portName)}' -ErrorAction SilentlyContinue } else { Set-Printer -Name '${esc(queueName)}' -PortName '${esc(portName)}' -ErrorAction SilentlyContinue }; (New-Object -ComObject WScript.Network).SetDefaultPrinter('${esc(queueName)}')"` ;
      await execPromise(psCmd, { timeout: 25000 });

      logger.info(`[BluetoothPrinterTransport] Registered Windows printer "${queueName}" on port "${portName}" using driver "${driverName}" and set as Default ✓`);
      return {
        success: true,
        message: `"${queueName}" installed as Windows Default printer on ${portName} using ${driverName} driver ✓`,
        driverUsed: driverName,
      };
    } catch (err: any) {
      const detail: string = err.stderr || err.message || 'Unknown error';
      logger.error(`[BluetoothPrinterTransport] Failed to register Windows printer queue "${queueName}": ${detail}`);
      return { success: false, message: `Could not register "${queueName}" as a Windows printer: ${detail}`, driverUsed: driverName };
    }
  }

  /** Fully uninstalls the queue (used by "Forget device") — removes it from Ctrl+P everywhere. */
  async removePrinterQueue(queueName: string): Promise<void> {
    if (os.platform() !== 'win32') return;
    try {
      const esc = queueName.replace(/'/g, "''");
      await execPromise(`powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='SilentlyContinue'; Remove-Printer -Name '${esc}' -ErrorAction SilentlyContinue"`);
      logger.info(`[BluetoothPrinterTransport] Removed Windows printer queue "${queueName}".`);
    } catch (err: any) {
      logger.warn(`[BluetoothPrinterTransport] Notice removing queue "${queueName}": ${err.message}`);
    }
  }

  /**
   * Actually tests whether the printer answers right now — the only honest
   * way to know it's powered on and in range, since neither Windows' Print
   * queue status nor its Bluetooth panel reliably reports this for SPP
   * devices. Independent of whether SEZNIK is even running otherwise; this
   * is a one-shot check the user can trigger on demand.
   */
  async probeReachable(comPort: string): Promise<{ reachable: boolean; message: string }> {
    if (os.platform() !== 'win32') {
      return { reachable: false, message: 'Only supported on Windows.' };
    }

    const scriptPath = path.join(os.tmpdir(), 'seznik_bt_reachability_probe.ps1');
    try {
      fs.writeFileSync(scriptPath, REACHABILITY_PROBE_SCRIPT, 'utf-8');
      await execPromise(`powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -PortName "${comPort}"`, { timeout: 8000 });
      logger.info(`[BluetoothPrinterTransport] Reachability probe OK for "${comPort}".`);
      return { reachable: true, message: `Responded — the printer is powered on and in range.` };
    } catch (err: any) {
      const detail: string = err.stderr || err.message || 'Unknown error';
      logger.warn(`[BluetoothPrinterTransport] Reachability probe failed for "${comPort}": ${detail}`);
      const friendly = detail.toLowerCase().includes('access')
        ? `${comPort} is busy — a print job may be in progress. Try again in a moment.`
        : `No response from ${comPort}. Make sure the printer is powered on and in range — some models also need their power button pressed to wake from sleep.`;
      return { reachable: false, message: friendly };
    }
  }

  async isQueueReady(queueName: string): Promise<boolean> {
    if (os.platform() !== 'win32') return false;
    try {
      const esc = queueName.replace(/'/g, "''");
      const { stdout } = await execPromise(`powershell -NoProfile -ExecutionPolicy Bypass -Command "[bool](Get-Printer -Name '${esc}' -ErrorAction SilentlyContinue)"`);
      return stdout.trim().toLowerCase() === 'true';
    } catch {
      return false;
    }
  }

  /** Sends raw ESC/POS bytes through the registered Windows queue — same RAW technique as USB printing. */
  async write(queueName: string, data: Buffer): Promise<PrintResult> {
    const res = await sendRawBytesToPrinterQueue(queueName, data, 'SEZNIK Bluetooth Print Job');
    return {
      success: res.success,
      printerId: queueName,
      platform: process.platform,
      queueName,
      bytesSent: res.success ? data.length : 0,
      errorCode: res.success ? undefined : 'BT_WRITE_FAILED',
      errorMessage: res.success ? undefined : res.message,
    };
  }
}
