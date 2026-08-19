import { exec } from 'child_process';
import util from 'util';
import os from 'os';
import fs from 'fs';
import path from 'path';
import logger from '../../logger';
import { PrintResult, V1PrinterProfileBrand } from '../../../shared/types';
import { sendRawBytesToPrinterQueue } from '../util/WinSpoolRawPrint';
import { DriverManager } from '../DriverManager';
import { DefaultPrinterService } from '../DefaultPrinterService';

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
   *
   * Flow:
   * 1. Check if POS58 driver is in the Windows Driver Store
   * 2. If not, install driver ONLY (no USB queue creation)
   * 3. Create/update the Windows Spooler queue on the Bluetooth COM port
   * 4. Set as Windows system default printer
   */
  async registerPrinterQueue(comPort: string, queueName: string, brand: V1PrinterProfileBrand): Promise<RegisterQueueResult> {
    if (os.platform() !== 'win32') {
      return { success: false, message: 'Bluetooth printer registration is only supported on Windows.', driverUsed: '' };
    }

    const portName = this.toLocalPortName(comPort);

    // Step 1: Find or install the driver (driver-only, no USB queue side effects)
    let preferredDriver = await this.findPreferredDriver(brand);

    if (!preferredDriver) {
      try {
        logger.info(`[BT:DRIVER] Driver not found for [${brand}]. Installing driver only (no USB queue)...`);
        const driverManager = new DriverManager();
        const drvResult = await driverManager.installDriverOnly(brand);
        if (drvResult.success && drvResult.driverName) {
          preferredDriver = drvResult.driverName;
        } else {
          // Re-check after install attempt
          preferredDriver = await this.findPreferredDriver(brand);
        }
      } catch (eDrv: any) {
        logger.warn(`[BT:DRIVER] Driver installation notice: ${eDrv.message}`);
      }
    }

    const driverName = preferredDriver || 'POS58';
    logger.info(`[BT:DRIVER] Using driver "${driverName}" for Bluetooth queue "${queueName}" on ${portName}`);

    // Step 2: Ensure the COM port is registered as a Windows Printer Port
    // Windows requires the port to exist in the spooler's port list before a
    // printer queue can be bound to it. For COM ports, this means adding it
    // as a Local Port if it isn't already present.
    const esc = (s: string) => s.replace(/'/g, "''");
    try {
      const psEnsurePort = `powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='SilentlyContinue'; $existing = Get-PrinterPort -Name '${esc(portName)}' -ErrorAction SilentlyContinue; if (-not $existing) { Add-PrinterPort -Name '${esc(portName)}' -ErrorAction SilentlyContinue }"`;
      await execPromise(psEnsurePort, { timeout: 10000 });
      logger.info(`[BT:QUEUE] Ensured printer port "${portName}" exists in Windows spooler ✓`);
    } catch (ePort: any) {
      logger.warn(`[BT:QUEUE] Printer port registration notice for "${portName}": ${ePort.message}`);
      // Not fatal — the port may already exist or Add-Printer may create it implicitly
    }

    // Step 3: Create or update the Windows Spooler queue bound to the REAL COM port
    // (Previously this was PORTPROMPT: which popped up a port dialog on every print)
    try {
      const psCmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='SilentlyContinue'; if (-not (Get-Printer -Name '${esc(queueName)}' -ErrorAction SilentlyContinue)) { Add-Printer -Name '${esc(queueName)}' -DriverName '${esc(driverName)}' -PortName '${esc(portName)}' -ErrorAction SilentlyContinue } else { Set-Printer -Name '${esc(queueName)}' -PortName '${esc(portName)}' -ErrorAction SilentlyContinue }"`;
      await execPromise(psCmd, { timeout: 25000 });
      logger.info(`[BT:QUEUE] Created/updated Windows queue "${queueName}" on port "${portName}" with driver "${driverName}" ✓`);
    } catch (err: any) {
      const detail: string = err.stderr || err.message || 'Unknown error';
      logger.error(`[BT:QUEUE] Failed to create queue "${queueName}": ${detail}`);
      return { success: false, message: `Could not register "${queueName}" as a Windows printer: ${detail}`, driverUsed: driverName };
    }

    // Step 4: Validate the queue was actually created and is on the right port
    try {
      const psCheck = `powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = Get-Printer -Name '${esc(queueName)}' -ErrorAction SilentlyContinue; if ($p) { Write-Output $p.PortName } else { Write-Output 'NOT_FOUND' }"`;
      const { stdout } = await execPromise(psCheck, { timeout: 8000 });
      const boundPort = (stdout || '').trim();
      if (boundPort === 'NOT_FOUND') {
        logger.warn(`[BT:QUEUE] Queue "${queueName}" was not found after creation — may need admin rights.`);
      } else if (boundPort.toUpperCase() !== portName.toUpperCase()) {
        logger.warn(`[BT:QUEUE] Queue "${queueName}" bound to "${boundPort}" instead of expected "${portName}" — rebinding...`);
        await execPromise(`powershell -NoProfile -ExecutionPolicy Bypass -Command "Set-Printer -Name '${esc(queueName)}' -PortName '${esc(portName)}' -ErrorAction SilentlyContinue"`, { timeout: 10000 });
      } else {
        logger.info(`[BT:QUEUE] Verified queue "${queueName}" is bound to port "${boundPort}" ✓`);
      }
    } catch (eCheck: any) {
      logger.warn(`[BT:QUEUE] Post-creation validation notice: ${eCheck.message}`);
    }

    // Step 5: Set as Windows system default printer (robust multi-method approach)
    try {
      const defaultService = new DefaultPrinterService();
      await defaultService.setAsDefaultPrinter(queueName);
      logger.info(`[BT:QUEUE] Set "${queueName}" as Windows system default printer ✓`);
    } catch (eDefault: any) {
      logger.warn(`[BT:QUEUE] Default printer notice: ${eDefault.message}`);
    }

    return {
      success: true,
      message: `"${queueName}" installed as Windows Default printer on ${portName} using ${driverName} driver ✓`,
      driverUsed: driverName,
    };
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

  /** Sends raw bytes directly to Bluetooth SPP COM port, RFCOMM StreamSocket, Spooler, or BLE GATT */
  async write(queueName: string, data: Buffer, comPort?: string, macAddress?: string): Promise<PrintResult> {
    const cleanMac = (macAddress || '').replace(/[^A-Fa-f0-9]/g, '').toUpperCase();
    const targetCom = (comPort || '').replace(/:$/, '').toUpperCase();
    const jobId = `BT-${Date.now().toString(36).toUpperCase()}`;

    logger.info(`[BluetoothPrinterTransport][JOB:${jobId}] Initiating print write (${data.length} bytes) to target "${queueName}", MAC: "${cleanMac || 'N/A'}", Port: "${targetCom || 'N/A'}"`);

    // 1. Direct Win32 Serial Port (Primary Physical SPP Channel for Thermal & Label Printers)
    if (targetCom.startsWith('COM') && os.platform() === 'win32') {
      try {
        const tempBin = path.join(os.tmpdir(), `seznik_bt_com_${Date.now()}.bin`);
        fs.writeFileSync(tempBin, data);

        let actualScript = path.join(__dirname, '..', 'scripts', 'bt_com_writer.ps1');
        if (!fs.existsSync(actualScript)) {
          actualScript = path.join(__dirname, '..', '..', 'src', 'main', 'scripts', 'bt_com_writer.ps1');
        }
        if (!fs.existsSync(actualScript)) {
          actualScript = path.resolve(process.cwd(), 'src', 'main', 'scripts', 'bt_com_writer.ps1');
        }

        const cleanCom = targetCom.replace(/:$/, '');
        logger.info(`[BluetoothPrinterTransport][JOB:${jobId}][COM] Writing ${data.length} bytes to ${cleanCom} via Win32 Serial...`);
        const psCmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${actualScript}" -PortName "${cleanCom}" -FilePath "${tempBin}"`;
        const { stdout } = await execPromise(psCmd, { timeout: 15000 });
        const result = (stdout || '').trim();
        try { if (fs.existsSync(tempBin)) fs.unlinkSync(tempBin); } catch {}

        if (result.startsWith('OK:') && !result.includes('OK:0')) {
          const bytesWritten = parseInt(result.split(':')[1], 10) || data.length;
          logger.info(`[BluetoothPrinterTransport][JOB:${jobId}][COM] Physical print verified: Delivered ${bytesWritten} bytes to ${targetCom} via Win32 Serial ✓`);
          return {
            success: true,
            printerId: queueName,
            platform: process.platform,
            queueName,
            portName: targetCom,
            bytesSent: bytesWritten,
          };
        } else {
          logger.warn(`[BluetoothPrinterTransport][JOB:${jobId}][COM] Serial write to ${cleanCom} returned: ${result}. Testing RFCOMM...`);
        }
      } catch (comErr: any) {
        logger.warn(`[BluetoothPrinterTransport][JOB:${jobId}][COM] Serial COM write error on ${targetCom}: ${comErr.message}`);
      }
    }

    // 2. WinRT RFCOMM StreamSocket (Direct Bluetooth SPP {00001101} Link via MAC Address)
    if (cleanMac.length === 12 && os.platform() === 'win32') {
      try {
        const tempBin = path.join(os.tmpdir(), `seznik_bt_rfcomm_${Date.now()}.bin`);
        fs.writeFileSync(tempBin, data);

        let actualRfcommScript = path.join(__dirname, '..', 'scripts', 'bt_rfcomm_writer.ps1');
        if (!fs.existsSync(actualRfcommScript)) {
          actualRfcommScript = path.join(__dirname, '..', '..', 'src', 'main', 'scripts', 'bt_rfcomm_writer.ps1');
        }
        if (!fs.existsSync(actualRfcommScript)) {
          actualRfcommScript = path.resolve(process.cwd(), 'src', 'main', 'scripts', 'bt_rfcomm_writer.ps1');
        }

        logger.info(`[BluetoothPrinterTransport][JOB:${jobId}][RFCOMM] Writing ${data.length} bytes to RFCOMM SPP MAC ${cleanMac}...`);
        const psCmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${actualRfcommScript}" -MacAddress "${cleanMac}" -FilePath "${tempBin}"`;
        const { stdout } = await execPromise(psCmd, { timeout: 15000 });
        const result = (stdout || '').trim();
        try { if (fs.existsSync(tempBin)) fs.unlinkSync(tempBin); } catch {}

        if (result.startsWith('OK:') && !result.includes('OK:0')) {
          const bytesWritten = parseInt(result.split(':')[1], 10) || data.length;
          logger.info(`[BluetoothPrinterTransport][JOB:${jobId}][RFCOMM] Physical print verified: ${bytesWritten} bytes to ${cleanMac} via WinRT RFCOMM StreamSocket ✓`);
          return {
            success: true,
            printerId: queueName,
            platform: process.platform,
            queueName,
            portName: 'BT-RFCOMM',
            bytesSent: bytesWritten,
          };
        } else {
          logger.warn(`[BluetoothPrinterTransport][JOB:${jobId}][RFCOMM] RFCOMM write result: ${result}`);
        }
      } catch (rfcommErr: any) {
        logger.warn(`[BluetoothPrinterTransport][JOB:${jobId}][RFCOMM] RFCOMM write error: ${rfcommErr.message}`);
      }
    }

    // 3. Fallback to alternative Bluetooth COM ports if the primary target failed
    if (os.platform() === 'win32') {
      try {
        const { stdout: portListOut } = await execPromise(`powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-PnpDevice -Class Ports -PresentOnly | Where-Object { $_.InstanceId -like 'BTHENUM*' } | Select-Object -ExpandProperty FriendlyName"`);
        const lines = (portListOut || '').split('\n').map(l => l.trim()).filter(Boolean);
        for (const line of lines) {
          const match = line.match(/\(COM(\d+)\)/i);
          if (match) {
            const altCom = `COM${match[1]}`;
            if (altCom.toUpperCase() !== targetCom) {
              logger.info(`[BluetoothPrinterTransport][JOB:${jobId}][ALT_COM] Trying alternative Bluetooth port ${altCom}...`);
              const tempBin = path.join(os.tmpdir(), `seznik_bt_altcom_${Date.now()}.bin`);
              fs.writeFileSync(tempBin, data);

              let actualScript = path.join(__dirname, '..', 'scripts', 'bt_com_writer.ps1');
              if (!fs.existsSync(actualScript)) actualScript = path.resolve(process.cwd(), 'src', 'main', 'scripts', 'bt_com_writer.ps1');

              const psCmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${actualScript}" -PortName "${altCom}" -FilePath "${tempBin}"`;
              const { stdout } = await execPromise(psCmd, { timeout: 12000 });
              const result = (stdout || '').trim();
              try { if (fs.existsSync(tempBin)) fs.unlinkSync(tempBin); } catch {}

              if (result.startsWith('OK:') && !result.includes('OK:0')) {
                const bytesWritten = parseInt(result.split(':')[1], 10) || data.length;
                logger.info(`[BluetoothPrinterTransport][JOB:${jobId}][ALT_COM] Physical print verified via ${altCom} ✓`);
                return {
                  success: true,
                  printerId: queueName,
                  platform: process.platform,
                  queueName,
                  portName: altCom,
                  bytesSent: bytesWritten,
                };
              }
            }
          }
        }
      } catch (altErr: any) {
        logger.warn(`[BluetoothPrinterTransport][JOB:${jobId}][ALT_COM] Alt COM check notice: ${altErr.message}`);
      }
    }

    // 4. BLE GATT characteristic fallback
    if (cleanMac.length === 12 && os.platform() === 'win32') {
      try {
        const tempBin = path.join(os.tmpdir(), `seznik_bt_ble_${Date.now()}.bin`);
        fs.writeFileSync(tempBin, data);

        let actualBleScript = path.join(__dirname, '..', 'scripts', 'bt_ble_writer.ps1');
        if (!fs.existsSync(actualBleScript)) {
          actualBleScript = path.resolve(process.cwd(), 'src', 'main', 'scripts', 'bt_ble_writer.ps1');
        }

        logger.info(`[BluetoothPrinterTransport][JOB:${jobId}][BLE] Fallback to WinRT BLE GATT Characteristic...`);
        const psCmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${actualBleScript}" -MacAddress "${cleanMac}" -FilePath "${tempBin}"`;
        const { stdout } = await execPromise(psCmd, { timeout: 20000 });
        const result = (stdout || '').trim();
        try { if (fs.existsSync(tempBin)) fs.unlinkSync(tempBin); } catch {}

        if (result.startsWith('OK:') && !result.includes('OK:0')) {
          const parts = result.split(':');
          const bytesWritten = parseInt(parts[1], 10) || data.length;
          logger.info(`[BluetoothPrinterTransport][JOB:${jobId}][BLE] Verified transmission to ${cleanMac} via BLE GATT ✓ (${result})`);
          return {
            success: true,
            printerId: queueName,
            platform: process.platform,
            queueName,
            portName: 'BLE-GATT',
            bytesSent: bytesWritten,
          };
        }
      } catch (bleErr: any) {
        logger.warn(`[BluetoothPrinterTransport][JOB:${jobId}][BLE] BLE write error: ${bleErr.message}`);
      }
    }

    const failureReason = `Bluetooth printer "${queueName}" is unreachable over Serial (COM3/COM4), RFCOMM StreamSocket, and BLE. Please verify the printer is powered ON, paired in Windows Bluetooth settings, and in range.`;
    logger.error(`[BluetoothPrinterTransport][JOB:${jobId}] Transmission failed: ${failureReason}`);

    return {
      success: false,
      printerId: queueName,
      platform: process.platform,
      queueName,
      portName: targetCom || 'BT',
      bytesSent: 0,
      errorCode: 'BT_WRITE_FAILED',
      errorMessage: failureReason,
    };
  }
}
