import { BrowserWindow } from 'electron';
import logger from '../logger';
import { BluetoothDiscoveryService } from './BluetoothDiscoveryService';
import { BluetoothPrinterTransport } from './transport/BluetoothPrinterTransport';
import { ConfigurationService } from '../../services/ConfigurationService';
import { PrinterCommandGenerator } from './commands/PrinterCommandGenerator';
import { BluetoothConnectionState, BluetoothPairedDevice, V1PrinterProfileBrand, PrinterType } from '../../shared/types';
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
  /* JOSH COMMENTED OUT
  if (brand === 'JOSH') return 'LABEL';
  */
  if (brand === 'DEV') return 'RECEIPT_AND_LABEL';
  return 'RECEIPT';
}

const INITIAL_STATE: BluetoothConnectionState = {
  step: 'IDLE',
  stepMessage: 'Bluetooth printer not connected yet.',
  devices: [],
  isScanning: false,
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
    logger.info(`[BluetoothPrinterService] State -> [${this.state.step}] ${this.state.stepMessage}`);
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('event:bluetoothStateChanged', this.state);
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
      const devices = await this.discovery.getPairedDevices();
      if (devices.length === 0) {
        return this.updateState({
          step: 'NO_DEVICES_FOUND',
          stepMessage: 'No paired Bluetooth devices found. Pair your printer in Windows Bluetooth settings first.',
          devices: [],
          isScanning: false,
        });
      }
      return this.updateState({
        step: 'DEVICES_FOUND',
        stepMessage: `Found ${devices.length} paired Bluetooth device(s).`,
        devices,
        isScanning: false,
      });
    } catch (err: any) {
      logger.error(`[BluetoothPrinterService] scanPairedDevices failed: ${err.message}`);
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
      this.updateState({ devices: rescanned });
      device = this.findDevice(rescanned, deviceId);
    }

    if (!device) {
      return this.updateState({
        step: 'ERROR',
        stepMessage: 'Selected Bluetooth device is no longer available. Please rescan.',
        errorDetails: 'DEVICE_NOT_FOUND',
      });
    }

    if (!device.comPort) {
      return this.updateState({
        step: 'ERROR',
        stepMessage: `"${device.name}" is paired but Windows hasn't bound a serial port to it yet. Open Windows Bluetooth settings, remove and re-pair the printer, and make sure "Serial Port" / SPP service is enabled, then rescan.`,
        errorDetails: 'NO_COM_PORT',
      });
    }

    const resolvedBrand: V1PrinterProfileBrand =
      brand && brand !== 'UNSUPPORTED' ? brand : device.likelyBrand !== 'UNSUPPORTED' ? device.likelyBrand : 'VEER';

    const savedId = `seznik-bt-${normalizeDeviceKey(device.id)}`;
    const queueName = await this.resolveQueueName(device.name, savedId);

    // Step 1: CONNECTING — initial state
    this.updateState({
      step: 'CONNECTING',
      stepMessage: `Setting up "${device.name}" as a receipt printer (${resolvedBrand})...`,
    });

    // Step 2: INSTALLING_DRIVER + CREATING_QUEUE + SETTING_DEFAULT
    // All handled inside registerPrinterQueue which:
    //   - Checks/installs POS58 driver (driver-only, no USB queue)
    //   - Creates Windows Spooler queue on Bluetooth COM port
    //   - Sets as Windows system default printer
    this.updateState({
      step: 'CONNECTING',
      stepMessage: `Installing driver and creating printer queue for "${device.name}"...`,
    });

    const registerResult = await this.transport.registerPrinterQueue(device.comPort, queueName, resolvedBrand);
    if (!registerResult.success) {
      return this.updateState({
        step: 'ERROR',
        stepMessage: registerResult.message,
        errorDetails: registerResult.message,
      });
    }

    // Step 3: CONNECTED — queue is ready
    this.updateState({
      step: 'CONNECTED',
      stepMessage: `"${queueName}" is ready and set as system default — find it in any app's Print dialog (Ctrl+P).`,
      connectedDeviceId: device.id,
      connectedDeviceName: device.name,
      connectedComPort: device.comPort,
      connectedQueueName: queueName,
      connectedDriverName: registerResult.driverUsed,
      connectedBrand: resolvedBrand,
      testPrintSuccess: false,
      lastTestPrintMessage: null,
      lastReachabilityCheck: null,
    });

    // Step 4: Persist to config + set as default in app
    try {
      await this.appConfig.savePrinter({
        id: savedId,
        name: queueName,
        driverName: registerResult.driverUsed,
        portName: device.comPort,
        connectionType: 'BLUETOOTH',
        isDefault: true,
        printerType: printerTypeForBrand(resolvedBrand),
        macAddress: device.address,
      });
      await this.appConfig.setSavedDefaultPrinter(savedId);
    } catch (persistErr: any) {
      logger.warn(`[BluetoothPrinterService] Failed to persist Bluetooth printer: ${persistErr.message}`);
    }

    // Step 5: Automatic test print
    return this.triggerTestPrint();
  }

  async triggerTestPrint(): Promise<BluetoothConnectionState> {
    const queueName = this.state.connectedQueueName;
    const brand = this.state.connectedBrand || 'VEER';
    const jobLabel = 'test receipt';

    if (!queueName) {
      return this.updateState({
        step: 'ERROR',
        stepMessage: 'No connected Bluetooth printer to test. Connect a device first.',
        errorDetails: 'NOT_CONNECTED',
      });
    }

    this.updateState({ step: 'TEST_PRINTING', stepMessage: `Sending ${jobLabel} to "${queueName}"...` });

    // Reuses the exact same proven TSPL/ESC-POS payloads the USB pipeline
    // sends (JoshLabelCommands for JOSH, VeerReceiptCommands otherwise).
    const payload = PrinterCommandGenerator.generateTestPayload(brand);
    const result = await this.transport.write(queueName, payload);

    if (result.success) {
      return this.updateState({
        step: 'TEST_PRINT_SUCCESS',
        stepMessage: `${jobLabel[0].toUpperCase()}${jobLabel.slice(1)} sent to "${queueName}" ✓ Check the physical printout.`,
        testPrintSuccess: true,
        lastTestPrintMessage: `${jobLabel} (${payload.length} bytes) delivered to "${queueName}" via the Windows print queue ✓`,
      });
    }

    return this.updateState({
      step: 'TEST_PRINT_FAILED',
      stepMessage: `${jobLabel[0].toUpperCase()}${jobLabel.slice(1)} failed: ${result.errorMessage || 'Unknown error'}`,
      testPrintSuccess: false,
      lastTestPrintMessage: result.errorMessage || 'Unknown error',
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
      logger.warn(`[BluetoothPrinterService] forgetDevice cleanup notice: ${err.message}`);
    }

    if (this.state.connectedDeviceId && normalizeDeviceKey(this.state.connectedDeviceId) === normalizeDeviceKey(deviceId)) {
      return this.disconnect();
    }
    return this.getState();
  }
}
