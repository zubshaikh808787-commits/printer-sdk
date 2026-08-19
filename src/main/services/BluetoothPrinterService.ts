import { BrowserWindow } from 'electron';
import os from 'os';
import logger from '../logger';
import { BluetoothDiscoveryService } from './BluetoothDiscoveryService';
import { BluetoothPrinterTransport } from './transport/BluetoothPrinterTransport';
import { ConfigurationService } from '../../services/ConfigurationService';
import { PrinterCommandGenerator } from './commands/PrinterCommandGenerator';
import { BluetoothAdapterStatus, BluetoothConnectionState, BluetoothPairedDevice, V1PrinterProfileBrand, PrinterType } from '../../shared/types';
import { DefaultPrinterService } from './DefaultPrinterService';

// Normalizes a device id/mac-address into a stable, comparable key (used both
// when deriving the persisted SavedPrinter id and when matching a requested
// deviceId back to a freshly-scanned BluetoothPairedDevice). Must be applied
// consistently everywhere an id round-trips through persistence, or a saved
// device without a resolvable MAC (id like "bt-my-printer") won't be found
// again after its hyphens/case are lost in storage.
function normalizeDeviceKey(raw: string): string {
  return (raw || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function printerTypeForBrand(brand: V1PrinterProfileBrand): PrinterType {
  if (brand === 'JOSH') return 'LABEL';
  if (brand === 'DEV') return 'RECEIPT_AND_LABEL';
  return 'RECEIPT';
}

const INITIAL_STATE: BluetoothConnectionState = {
  step: 'IDLE',
  stepMessage: 'Bluetooth printer not connected yet.',
  devices: [],
  isScanning: false,
  adapterStatus: 'UNKNOWN',
  connectedDeviceId: null,
  connectedDeviceName: null,
  connectedComPort: null,
  connectedQueueName: null,
  connectedDriverName: null,
  connectedBrand: null,
  testPrintSuccess: false,
  lastTestPrintMessage: null,
  lastReachabilityCheck: null,
};

export class BluetoothPrinterService {
  private discovery: BluetoothDiscoveryService;
  private transport: BluetoothPrinterTransport;
  // Shared with PrinterSetupOrchestrator (and the rest of the app) — using a
  // second independent persistence layer here was the root cause of Set
  // Default/Delete needing several clicks to actually stick (two services
  // silently clobbering the same on-disk file with stale in-memory copies).
  private appConfig: ConfigurationService;
  private state: BluetoothConnectionState = { ...INITIAL_STATE, devices: [] };
  private window: BrowserWindow | null = null;

  constructor(appConfig: ConfigurationService) {
    this.discovery = new BluetoothDiscoveryService();
    this.transport = new BluetoothPrinterTransport();
    this.appConfig = appConfig;
  }

  setWindow(win: BrowserWindow) {
    this.window = win;
  }

  getState(): BluetoothConnectionState {
    return { ...this.state };
  }

  private updateState(partial: Partial<BluetoothConnectionState>): BluetoothConnectionState {
    this.state = { ...this.state, ...partial };
    logger.info(`[BT:STATE] Step -> [${this.state.step}] ${this.state.stepMessage}`);
    if (this.window && !this.window.isDestroyed()) {
      try {
        this.window.webContents.send('event:bluetoothStateChanged', this.state);
      } catch (e) {}
    }
    return this.getState();
  }

  /**
   * Lists Windows-paired Bluetooth devices so the user can pick their
   * printer. Called from the "Connect via Bluetooth" screen after USB setup
   * has completed, and again from Settings for reconnects.
   */
  async scanPairedDevices(): Promise<BluetoothConnectionState> {
    this.updateState({ step: 'SCANNING', stepMessage: 'Scanning Windows-paired Bluetooth devices...', isScanning: true });

    try {
      const result = await this.discovery.getPairedDevices();
      const { adapterStatus, devices } = result;

      // Check adapter status first — surface specific error if adapter is off or missing
      if (adapterStatus === 'NOT_PRESENT') {
        return this.updateState({
          step: 'ADAPTER_MISSING',
          stepMessage: 'No Bluetooth adapter found on this computer. A USB Bluetooth dongle is required for wireless printing.',
          devices: [],
          isScanning: false,
          adapterStatus,
        });
      }

      if (adapterStatus === 'PRESENT_BUT_DISABLED') {
        return this.updateState({
          step: 'ADAPTER_OFF',
          stepMessage: 'Bluetooth is turned off. Enable it in Windows Settings → Bluetooth & devices, then rescan.',
          devices: [],
          isScanning: false,
          adapterStatus,
        });
      }

      if (devices.length === 0) {
        return this.updateState({
          step: 'NO_DEVICES_FOUND',
          stepMessage: 'No paired Bluetooth devices found. Pair your printer in Windows Bluetooth settings first.',
          devices: [],
          isScanning: false,
          adapterStatus,
        });
      }

      return this.updateState({
        step: 'DEVICES_FOUND',
        stepMessage: `Found ${devices.length} paired Bluetooth device(s).`,
        devices,
        isScanning: false,
        adapterStatus,
      });
    } catch (err: any) {
      logger.error(`[BT:DISCOVERY] scanPairedDevices failed: ${err.message}`);
      return this.updateState({
        step: 'ERROR',
        stepMessage: `Bluetooth scan failed: ${err.message}`,
        isScanning: false,
        errorDetails: err.message,
      });
    }
  }

  private findDevice(devices: BluetoothPairedDevice[], deviceId: string): BluetoothPairedDevice | undefined {
    const key = normalizeDeviceKey(deviceId);
    return devices.find(d => normalizeDeviceKey(d.id) === key || (d.address && normalizeDeviceKey(d.address) === key));
  }

  /**
   * The Windows printer queue name we register for a paired device — this is
   * exactly what shows up in every app's Print dialog (Ctrl+P), not just
   * inside SEZNIK, so it should read like a real printer name, not an
   * internal identifier. Uses the device's own Bluetooth name as-is; only
   * appends a "(Bluetooth)" qualifier if that exact name is already taken by
   * a different printer (e.g. the same model also set up over USB).
   */
  private async resolveQueueName(deviceName: string, excludeSavedId: string): Promise<string> {
    try {
      const saved = await this.appConfig.getSavedPrinters();
      const collision = saved.find(p => p.id !== excludeSavedId && p.name.toLowerCase() === deviceName.toLowerCase());
      return collision ? `${deviceName} (Bluetooth)` : deviceName;
    } catch {
      return deviceName;
    }
  }

  /**
   * Connects to a previously-scanned paired device by id: registers a real
   * Windows printer queue on its COM port (so it shows up in every app's
   * Print dialog, including Ctrl+P) using the driver for the given brand,
   * then immediately fires one automatic test print through that same queue
   * to confirm it actually prints.
   *
   * `brand` lets JOSH (50x50mm label/TSPL) printers pair the same way VEER
   * (58mm receipt/ESC-POS) ones do — if omitted, falls back to the device's
   * name-based guess, then VEER (matches the receipt-only original behavior).
   */
  async connectDevice(deviceId: string, brand?: V1PrinterProfileBrand): Promise<BluetoothConnectionState> {
    let device: BluetoothPairedDevice | undefined = this.findDevice(this.state.devices, deviceId);

    if (!device) {
      // Device list may be stale (e.g. user re-opened the modal) — rescan once.
      const rescanned = await this.discovery.getPairedDevices();
      this.updateState({ devices: rescanned.devices, adapterStatus: rescanned.adapterStatus });
      device = this.findDevice(rescanned.devices, deviceId);
    }

    if (!device) {
      return this.updateState({
        step: 'ERROR',
        stepMessage: 'Selected Bluetooth device is no longer available. Please rescan.',
        errorDetails: 'DEVICE_NOT_FOUND',
      });
    }

    const resolvedBrand: V1PrinterProfileBrand =
      brand && brand !== 'UNSUPPORTED' ? brand : device.likelyBrand !== 'UNSUPPORTED' ? device.likelyBrand : 'JOSH';

    const savedId = `seznik-bt-${normalizeDeviceKey(device.id)}`;
    const queueName = await this.resolveQueueName(device.name, savedId);

    // ──────────────────────────────────────────────────────────────
    // Step 1: PAIRING — auto-pair / link synchronization
    // ──────────────────────────────────────────────────────────────
    const typeLabel = resolvedBrand === 'JOSH' ? 'label' : 'receipt';
    this.updateState({
      step: 'PAIRING',
      stepMessage: `Synchronizing wireless link to "${device.name}" (${resolvedBrand} ${typeLabel} printer)...`,
    });

    if (device.address) {
      const pairResult = await this.autoPair(device.address, false);
      logger.info(`[BT:PAIRING] Auto-pair for ${device.address}: ${pairResult ? 'OK' : 'skipped/failed (non-fatal)'}`);
    }

    // ──────────────────────────────────────────────────────────────
    // Step 2: COM PORT — resolve or auto-create
    // ──────────────────────────────────────────────────────────────
    let effectiveComPort = device.comPort;

    if (!effectiveComPort && device.address) {
      this.updateState({
        step: 'COM_PORT_CREATING',
        stepMessage: `Resolving serial port for "${device.name}"...`,
      });

      const comResult = await this.discovery.ensureComPort(device.address);

      if (comResult.comPort) {
        effectiveComPort = comResult.comPort;
        logger.info(`[BT:COM_PORT] Auto-resolved COM port: ${effectiveComPort}`);
      } else if (comResult.hasRfcomm) {
        // Device supports RFCOMM but no COM port — we can still print via
        // the RFCOMM StreamSocket path in BluetoothPrinterTransport.write()
        // Create a synthetic COM port reference for the queue — Windows may
        // not need it since we bypass the spooler for actual data transmission
        logger.info(`[BT:COM_PORT] No COM port but RFCOMM available — will use direct RFCOMM transport for ${device.address}`);
        // Use COM99 as a placeholder port for queue registration; actual
        // printing goes through RFCOMM StreamSocket bypassing the spooler
        effectiveComPort = 'COM99';
      } else {
        logger.warn(`[BT:COM_PORT] Cannot resolve COM port for "${device.name}": ${comResult.error}`);
        return this.updateState({
          step: 'NO_COM_PORT',
          stepMessage: `Cannot connect: Windows hasn't created a serial port for "${device.name}". Open Windows Settings → Bluetooth & devices → find this device → More options → "More Bluetooth settings" → COM Ports → Add → Outgoing, select "${device.name}", and click OK. Then rescan and try again.`,
          errorDetails: 'NO_COM_PORT',
        });
      }
    }

    if (!effectiveComPort) {
      return this.updateState({
        step: 'NO_COM_PORT',
        stepMessage: `Cannot connect: No Bluetooth MAC address or serial port available for "${device.name}". Remove and re-pair the device in Windows Bluetooth settings, then rescan.`,
        errorDetails: 'NO_COM_PORT_NO_MAC',
      });
    }

    // ──────────────────────────────────────────────────────────────
    // Step 3: DRIVER — install if needed
    // ──────────────────────────────────────────────────────────────
    this.updateState({
      step: 'DRIVER_INSTALLING',
      stepMessage: `Checking ${resolvedBrand} driver for "${device.name}"...`,
    });

    // (Driver installation happens inside registerPrinterQueue — this step
    // just provides UI feedback that something is happening)

    // ──────────────────────────────────────────────────────────────
    // Step 4: QUEUE — register Windows printer queue on the COM port
    // ──────────────────────────────────────────────────────────────
    this.updateState({
      step: 'QUEUE_REGISTERING',
      stepMessage: `Installing printer queue for "${device.name}" on ${effectiveComPort}...`,
    });

    const registerResult = await this.transport.registerPrinterQueue(effectiveComPort, queueName, resolvedBrand);
    if (!registerResult.success) {
      return this.updateState({
        step: 'ERROR',
        stepMessage: registerResult.message,
        errorDetails: registerResult.message,
      });
    }

    // ──────────────────────────────────────────────────────────────
    // Step 5: CONNECTED — queue is ready
    // ──────────────────────────────────────────────────────────────
    this.updateState({
      step: 'CONNECTED',
      stepMessage: `"${queueName}" is ready and set as system default — find it in any app's Print dialog (Ctrl+P).`,
      connectedDeviceId: device.id,
      connectedDeviceName: device.name,
      connectedComPort: effectiveComPort,
      connectedQueueName: queueName,
      connectedDriverName: registerResult.driverUsed,
      connectedBrand: resolvedBrand,
      connectedMacAddress: device.address || null,
      lastReachabilityCheck: null,
    });

    // ──────────────────────────────────────────────────────────────
    // Step 6: Persist to config + set as default in app
    // ──────────────────────────────────────────────────────────────
    try {
      await this.appConfig.savePrinter({
        id: savedId,
        name: queueName,
        driverName: registerResult.driverUsed,
        portName: effectiveComPort,
        connectionType: 'BLUETOOTH',
        isDefault: true,
        printerType: printerTypeForBrand(resolvedBrand),
        macAddress: device.address,
      });
      await this.appConfig.setSavedDefaultPrinter(savedId);
      logger.info(`[BT:CONFIG] Persisted printer "${queueName}" (${savedId}) as default ✓`);
    } catch (persistErr: any) {
      logger.warn(`[BT:CONFIG] Failed to persist Bluetooth printer: ${persistErr.message}`);
    }

    // ──────────────────────────────────────────────────────────────
    // Step 7: Automatically trigger test print
    // ──────────────────────────────────────────────────────────────
    return this.triggerTestPrint();
  }

  private async autoPair(macAddress: string, forceRePair = false): Promise<boolean> {
    if (!macAddress) return false;
    try {
      const { exec } = require('child_process');
      const util = require('util');
      const execPromise = util.promisify(exec);
      const fs = require('fs');
      const path = require('path');

      let scriptPath = path.join(__dirname, '..', 'scripts', 'bt_auto_pair.ps1');
      if (!fs.existsSync(scriptPath)) {
        scriptPath = path.join(__dirname, '..', '..', 'src', 'main', 'scripts', 'bt_auto_pair.ps1');
      }
      if (!fs.existsSync(scriptPath)) {
        scriptPath = path.resolve(process.cwd(), 'src', 'main', 'scripts', 'bt_auto_pair.ps1');
      }
      const psCmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -MacAddress "${macAddress}" -ForceRePair $${forceRePair}`;
      const { stdout } = await execPromise(psCmd, { timeout: 20000 });
      logger.info(`[BT:PAIRING] bt_auto_pair result for [${macAddress}]: ${stdout?.trim()}`);
      return (stdout || '').includes('OK:');
    } catch (e: any) {
      logger.warn(`[BT:PAIRING] bt_auto_pair notice: ${e.message}`);
      return false;
    }
  }

  async triggerTestPrint(): Promise<BluetoothConnectionState> {
    const queueName = this.state.connectedQueueName;
    const comPort = this.state.connectedComPort;
    const brand = this.state.connectedBrand || 'JOSH';
    const jobLabel = brand === 'JOSH' ? 'test label' : 'test receipt';

    if (!queueName && !comPort) {
      return this.updateState({
        step: 'ERROR',
        stepMessage: 'No connected Bluetooth printer to test. Connect a device first.',
        errorDetails: 'NOT_CONNECTED',
      });
    }

    const targetDestination = queueName || comPort || 'Bluetooth Printer';
    this.updateState({ step: 'TEST_PRINTING', stepMessage: `Sending ${jobLabel} to "${targetDestination}"...` });

    // Step 1: If registered as a real Windows Printer Queue with a driver, use the official GDI spooler pipeline
    if (queueName && os.platform() === 'win32') {
      try {
        logger.info(`[BT:TEST_PRINT] Printing ${brand} test document via Windows GDI Spooler to queue "${queueName}"...`);
        const { TestPrintService } = await import('./TestPrintService');
        const testService = new TestPrintService();
        const profile = { brand, paperWidthMm: brand === 'JOSH' ? 50 : 58, documentType: brand === 'JOSH' ? 'LABEL' : 'RECEIPT' } as any;
        const gdiResult = await testService.executeAutomatedTestPrint(queueName, profile);

        if (gdiResult.success) {
          logger.info(`[BT:TEST_PRINT] Physical test print delivered to queue "${queueName}" via Windows Spooler ✓`);
          return this.updateState({
            step: 'TEST_PRINT_SUCCESS',
            stepMessage: `${jobLabel[0].toUpperCase()}${jobLabel.slice(1)} printed to "${queueName}" via Windows Spooler (${queueName}) ✓`,
            testPrintSuccess: true,
            lastTestPrintMessage: `${jobLabel} verified printed via Windows Spooler (${queueName}) ✓`,
          });
        } else {
          logger.warn(`[BT:TEST_PRINT] GDI Spooler notice: ${gdiResult.message}. Testing direct transport fallback...`);
        }
      } catch (gdiErr: any) {
        logger.warn(`[BT:TEST_PRINT] GDI Spooler exception: ${gdiErr.message}. Testing direct transport fallback...`);
      }
    }

    // Step 2: Direct raw command stream fallback (TSPL for JOSH, ESC/POS for VEER)
    const payload = PrinterCommandGenerator.generateTestPayload(brand);
    let result = await this.transport.write(targetDestination, payload, comPort || undefined, this.state.connectedMacAddress || undefined);

    // If unreachable (Error 1231), perform an automatic Link Key resync & retry once
    if (!result.success && result.errorMessage?.includes('unreachable') && this.state.connectedMacAddress) {
      logger.info(`[BT:TRANSPORT] Link unreachable. Attempting automatic Link Key resynchronization...`);
      this.updateState({ step: 'CONNECTING', stepMessage: 'Re-syncing wireless Link Key...' });
      await this.autoPair(this.state.connectedMacAddress, true);
      this.updateState({ step: 'TEST_PRINTING', stepMessage: `Retrying ${jobLabel}...` });
      result = await this.transport.write(targetDestination, payload, comPort || undefined, this.state.connectedMacAddress || undefined);
    }

    if (result.success) {
      logger.info(`[BT:TRANSPORT] Test print job confirmed transmitted: ${result.bytesSent} bytes via ${result.portName}`);
      return this.updateState({
        step: 'TEST_PRINT_SUCCESS',
        stepMessage: `${jobLabel[0].toUpperCase()}${jobLabel.slice(1)} transmitted to "${targetDestination}" via ${result.portName} (${result.bytesSent} bytes) ✓`,
        testPrintSuccess: true,
        lastTestPrintMessage: `${jobLabel} (${result.bytesSent} bytes) verified transmitted via ${result.portName} ✓`,
      });
    }

    logger.error(`[BT:TRANSPORT] Test print failed: ${result.errorMessage}`);
    return this.updateState({
      step: 'TEST_PRINT_FAILED',
      stepMessage: `${jobLabel[0].toUpperCase()}${jobLabel.slice(1)} failed: ${result.errorMessage || 'Bluetooth radio unreachable'}`,
      testPrintSuccess: false,
      lastTestPrintMessage: result.errorMessage || 'Bluetooth radio unreachable',
      errorDetails: result.errorMessage,
    });
  }

  /**
   * On-demand hardware check: briefly opens then closes the COM port to see
   * if the printer actually answers right now. This is the real answer to
   * "is it actually connected?" — it works identically whether SEZNIK has
   * been open the whole time or was just launched, and doesn't require
   * holding the port open (which would break Ctrl+P printing, see
   * BluetoothPrinterTransport). It only reports the reachability of the
   * hardware; the printer queue itself stays installed either way.
   */
  async checkConnection(comPort?: string): Promise<BluetoothConnectionState> {
    const targetPort = comPort || this.state.connectedComPort;
    if (!targetPort) {
      return this.updateState({
        lastReachabilityCheck: {
          reachable: false,
          message: 'No Bluetooth printer selected in SEZNIK. Connect one first, or check via Settings.',
          checkedAt: new Date().toISOString(),
        },
      });
    }

    const res = await this.transport.probeReachable(targetPort);
    return this.updateState({
      lastReachabilityCheck: { reachable: res.reachable, message: `${targetPort}: ${res.message}`, checkedAt: new Date().toISOString() },
    });
  }

  /**
   * Clears SEZNIK's own "currently selected" indicator only. The Windows
   * printer queue registered by connectDevice() is left installed — that's
   * the whole point, so it keeps working from Ctrl+P and other apps even
   * when SEZNIK isn't actively "connected" to it. Use forgetDevice() to
   * actually uninstall the queue.
   */
  disconnect(): BluetoothConnectionState {
    return this.updateState({
      step: 'DISCONNECTED',
      stepMessage: this.state.connectedQueueName
        ? `Deselected in SEZNIK. "${this.state.connectedQueueName}" remains installed in Windows — it's still usable from Ctrl+P in any app.`
        : 'Bluetooth printer disconnected.',
      connectedDeviceId: null,
      connectedDeviceName: null,
      connectedComPort: null,
      connectedQueueName: null,
      connectedDriverName: null,
      connectedBrand: null,
      testPrintSuccess: false,
      lastTestPrintMessage: null,
    });
  }

  /** Fully uninstalls the Windows printer queue and removes the saved record (does not un-pair Bluetooth). */
  async forgetDevice(deviceId: string): Promise<BluetoothConnectionState> {
    const savedId = `seznik-bt-${normalizeDeviceKey(deviceId)}`;
    try {
      const saved = await this.appConfig.getSavedPrinters();
      const record = saved.find(p => p.id === savedId);
      if (record) {
        await this.transport.removePrinterQueue(record.name);
      }
      await this.appConfig.removeSavedPrinter(savedId);
    } catch (err: any) {
      logger.warn(`[BT:CONFIG] forgetDevice cleanup notice: ${err.message}`);
    }

    if (this.state.connectedDeviceId && normalizeDeviceKey(this.state.connectedDeviceId) === normalizeDeviceKey(deviceId)) {
      return this.disconnect();
    }
    return this.getState();
  }
}
