import { BrowserWindow } from 'electron';
import { UsbDiscoveryService, DetectedUsbHardware } from './UsbDiscoveryService';
import { PrinterIdentificationService } from './PrinterIdentificationService';
import { PrinterProfileService } from './PrinterProfileService';
import { DriverManager } from './DriverManager';
import { PrinterConfigurationService } from './PrinterConfigurationService';
import { TestPrintService } from './TestPrintService';
import { DefaultPrinterService } from './DefaultPrinterService';
import { ConfigurationService } from '../../services/ConfigurationService';
import { PrinterStateService } from './PrinterStateService';
import { V1OrchestratorState, JoshTestPrintResult } from '../../shared/types';
import os from 'os';
import { exec } from 'child_process';
import util from 'util';
import logger from '../logger';

const execPromise = util.promisify(exec);

export class PrinterSetupOrchestrator {
  private usbDiscovery: UsbDiscoveryService;
  private identification: PrinterIdentificationService;
  private profileService: PrinterProfileService;
  private driverManager: DriverManager;
  private configurationService: PrinterConfigurationService;
  private testPrintService: TestPrintService;
  private defaultPrinterService: DefaultPrinterService;
  // Shared with BluetoothPrinterService (and the rest of the app) so every
  // saved-printer read/write goes through ONE in-memory config + on-disk
  // file — two independent services writing the same file was the root
  // cause of Set Default/Delete silently needing several clicks to "take".
  private appConfig: ConfigurationService;
  private stateService: PrinterStateService;

  private isSetupRunning = false;

  constructor(appConfig: ConfigurationService) {
    this.usbDiscovery = new UsbDiscoveryService();
    this.identification = new PrinterIdentificationService();
    this.profileService = new PrinterProfileService();
    this.driverManager = new DriverManager();
    this.configurationService = new PrinterConfigurationService();
    this.testPrintService = new TestPrintService();
    this.defaultPrinterService = new DefaultPrinterService();
    this.appConfig = appConfig;
    this.stateService = new PrinterStateService();
  }

  setWindow(win: BrowserWindow) {
    this.stateService.setWindow(win);
  }

  getState(): V1OrchestratorState {
    return this.stateService.getState();
  }

  /**
   * Starts the 100% automated V1 Setup Pipeline.
   * NO manual user brand selection!
   */
  async runAutomatedV1Pipeline(): Promise<V1OrchestratorState> {
    if (this.isSetupRunning) {
      logger.warn('[PrinterSetupOrchestrator] Pipeline is already running.');
      return this.getState();
    }

    this.isSetupRunning = true;
    logger.info('================ STARTING V1 AUTOMATED PRINTER PIPELINE ================');

    try {
      // Step 1: Real USB Discovery
      this.stateService.updateState({
        step: 'NO_USB_CONNECTED',
        stepMessage: 'Scanning physical USB bus for connected printers...',
        progressPercent: 5,
      });

      let devices = await this.usbDiscovery.scanPhysicalUsbDevices();

      if (devices.length === 0) {
        logger.info('[V1 Pipeline] No physical USB thermal printer detected on USB bus.');
        this.isSetupRunning = false;
        return this.stateService.resetState();
      }

      logger.info(`[V1 Pipeline] Scanned ${devices.length} physical USB device(s):`);
      devices.forEach(d => {
        const identifiedBrand = this.identification.identifyHardware(d);
        logger.info(` -> Device: "${d.name}" [PNP: ${d.pnpDeviceId}] [Service: ${d.service}] => Brand: [${identifiedBrand}]`);
      });

      // Select the first supported printer target (JOSH, VEER, DEV)
      const targetHardware = devices.find(d => {
        const b = this.identification.identifyHardware(d);
        return b !== 'UNSUPPORTED';
      }) || devices[0];

      logger.info(`[V1 Pipeline] Target USB Hardware Selected -> Name: "${targetHardware.name}" [PNP: ${targetHardware.pnpDeviceId}]`);

      this.stateService.updateState({
        step: 'USB_DETECTED',
        stepMessage: `USB Printer Detected: "${targetHardware.name}"`,
        progressPercent: 15,
        usbConnected: true,
        detectedHardwareName: targetHardware.name,
        vendorId: targetHardware.vendorId,
        productId: targetHardware.productId,
      });

      // Step 2: Automatic Printer Hardware Identification
      this.stateService.updateState({
        step: 'IDENTIFYING',
        stepMessage: 'Identifying printer hardware profile automatically...',
        progressPercent: 25,
      });

      let brand = this.identification.identifyHardware(targetHardware);

      // JOSH active pipeline (defaulting thermal USB hardware to JOSH)
      if (brand === 'UNSUPPORTED' || brand === 'VEER') {
        brand = 'JOSH';
      }

      const profile = this.profileService.getProfile(brand);

      this.stateService.updateState({
        step: 'PROFILE_MATCHED',
        stepMessage: `Auto-matched Hardware Profile: [${brand}] (${profile.paperWidthMm}mm ${profile.documentType})`,
        progressPercent: 35,
        brand,
      });

      // Step 3: Automatic Driver Check & Auto Installation
      this.stateService.updateState({
        step: 'CHECKING_DRIVER',
        stepMessage: `Checking OS Spooler for ${brand} driver installation...`,
        progressPercent: 45,
      });

      let driverStatus = await this.driverManager.checkDriverInstalled(brand);

      const activeLivePort = await this.driverManager.discoverActiveUsbPort();

      if (driverStatus.installed) {
        logger.info(`[V1 Pipeline] Driver/Product installation already exists: "${driverStatus.queueName}"`);
        this.stateService.updateState({
          step: 'DRIVER_VERIFIED',
          stepMessage: `Driver verified in Windows (${driverStatus.queueName || brand}). Binding to live port ${activeLivePort}...`,
          progressPercent: 65,
          driverInstalled: true,
          queueName: driverStatus.queueName,
        });

        if (os.platform() === 'win32') {
          try {
            const qName = driverStatus.queueName || 'POS58 Printer';
            const psRebind = `powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='SilentlyContinue'; Get-Printer -Name '${qName}' -ErrorAction SilentlyContinue | Get-PrintJob -ErrorAction SilentlyContinue | Remove-PrintJob -ErrorAction SilentlyContinue; Set-Printer -Name '${qName}' -PortName '${activeLivePort}' -ErrorAction SilentlyContinue"`;
            await execPromise(psRebind);
            logger.info(`[V1 Pipeline] Rebound "${qName}" queue to live USB port "${activeLivePort}" ✓`);
          } catch (eRebind: any) {
            logger.warn(`[V1 Pipeline] Port rebind notice: ${eRebind.message}`);
          }
        }
      } else {
        this.stateService.updateState({
          step: 'INSTALLING_DRIVER',
          stepMessage: `Installing official ${brand} driver with Administrator permission...`,
          progressPercent: 55,
          driverInstalled: false,
        });

        const installResult = await this.driverManager.installDriverAutomatically(brand);
        let checkStatus = await this.driverManager.checkDriverInstalled(brand);

        if (!installResult.success && !checkStatus.installed) {
          throw new Error(`Driver installation failed: ${installResult.log}`);
        }

        driverStatus = checkStatus.installed ? checkStatus : await this.driverManager.checkDriverInstalled(brand);

        this.stateService.updateState({
          step: 'DRIVER_VERIFIED',
          stepMessage: `Driver installation completed successfully -> Queue: "${driverStatus.queueName}" on ${activeLivePort}`,
          progressPercent: 65,
          driverInstalled: true,
          queueName: driverStatus.queueName,
        });
      }

      const invalidPnpNames = ['usb printing support', 'usb input device', 'usb composite device', 'generic usb hub', 'unknown printer'];
      let queueName = driverStatus.queueName;
      if (!queueName || invalidPnpNames.includes(queueName.trim().toLowerCase())) {
        queueName = targetHardware.name && !invalidPnpNames.includes(targetHardware.name.trim().toLowerCase()) 
          ? targetHardware.name 
          : (brand === 'JOSH' ? 'DeTong DP27 Label Printer' : 'SZ-80D Printer');
      }

      this.stateService.updateState({
        step: 'DRIVER_VERIFIED',
        stepMessage: `Driver Verified in OS Spooler -> Queue: "${queueName}" on ${activeLivePort}`,
        progressPercent: 65,
        driverInstalled: true,
        queueName,
      });

      // Step 4: Configure Queue
      this.stateService.updateState({
        step: 'CONFIGURING_PRINTER',
        stepMessage: `Configuring printer queue parameters for ${profile.paperWidthMm}mm media...`,
        progressPercent: 60,
      });

      await this.configurationService.configurePrinterQueue(queueName, profile);

      // Step 5: Save Storage
      this.stateService.updateState({
        step: 'SAVING_PRINTER',
        stepMessage: `Saving printer configuration to local storage...`,
        progressPercent: 75,
      });

      const detectedPort = activeLivePort || 'USB001';

      const savedPrinterId = `seznik-${queueName.replace(/\s+/g, '-').toLowerCase()}`;
      const printerType = brand === 'JOSH' ? 'LABEL' : (brand === 'DEV' ? 'RECEIPT_AND_LABEL' : 'RECEIPT');
      await this.appConfig.savePrinter({
        id: savedPrinterId,
        name: queueName,
        driverName: driverStatus.driverName || `${brand} Driver`,
        portName: detectedPort,
        connectionType: 'USB',
        isDefault: true,
        printerType,
      });

      // Step 6: Set Default
      this.stateService.updateState({
        step: 'SETTING_DEFAULT',
        stepMessage: `Setting "${queueName}" as Default Printer automatically...`,
        progressPercent: 90,
      });

      await this.defaultPrinterService.setAsDefaultPrinter(queueName);

      // Step 7: Setup Complete (100% Overall Setup Process Completion!)
      const finalState = this.stateService.updateState({
        step: 'SETUP_COMPLETE',
        stepMessage: `SETUP COMPLETE! Real ${brand} USB printer "${queueName}" configured & ready ✓`,
        progressPercent: 100,
        queueName,
        savedPrinterId,
        isDefault: true,
      });

      // BACKEND AUTOMATED TEST PRINT (Executed strictly AFTER overall 7-step completion complete!)
      logger.info(`================ OVERALL 7-STEP SETUP COMPLETED SUCCESSFULLY ================`);
      logger.info(`[Backend Command] Transmitting 1 single test print receipt to physical printer "${queueName}"...`);
      
      const printResult = await this.testPrintService.executeAutomatedTestPrint(queueName, profile);

      if (!printResult.success) {
        logger.warn(`[Backend Notice] Test print job notice: ${printResult.message}`);
      } else {
        logger.info(`[Backend Notice] Test print delivered 1 single receipt to "${queueName}" post-setup completion ✓`);
      }

      this.stateService.updateState({
        testPrintSuccess: printResult.success,
      });

      this.isSetupRunning = false;
      return finalState;
    } catch (err: any) {
      logger.error(`[V1 Pipeline FAILED] ${err.message}`);
      this.isSetupRunning = false;
      return this.stateService.updateState({
        step: 'ERROR',
        stepMessage: `Setup Failed: ${err.message}`,
        errorDetails: err.message,
      });
    }
  }

  private lastConnectedPnpId: string | null = null;

  /**
   * Initializes USB monitoring to detect insertion / unplugging / device swap dynamically.
   */
  startUsbMonitoring() {
    this.usbDiscovery.startHotplugMonitoring((devices) => {
      if (devices.length === 0) {
        if (this.lastConnectedPnpId !== null || this.getState().usbConnected) {
          logger.warn('[Orchestrator] Physical USB Printer disconnected. Resetting state to NO_USB_CONNECTED.');
          this.lastConnectedPnpId = null;
          this.isSetupRunning = false;
          this.stateService.resetState();
        }
      } else {
        const primaryDevice = devices[0];
        if (primaryDevice.pnpDeviceId !== this.lastConnectedPnpId || !this.getState().usbConnected) {
          logger.info(`[Orchestrator] Physical USB Device state change (Previous: ${this.lastConnectedPnpId} -> Current: ${primaryDevice.pnpDeviceId}). Running automated setup pipeline...`);
          this.lastConnectedPnpId = primaryDevice.pnpDeviceId;
          this.isSetupRunning = false;
          this.runAutomatedV1Pipeline();
        }
      }
    });
  }

  async triggerManualTestPrint(): Promise<JoshTestPrintResult> {
    const currentState = this.getState();
    let queueName = currentState.queueName;
    let brand = currentState.brand;

    if (!queueName || queueName.trim() === '' || queueName.toLowerCase() === 'none') {
      const savedPrinters = await this.appConfig.getSavedPrinters();
      const defaultId = await this.appConfig.getDefaultPrinterId();
      const targetSaved = savedPrinters.find(p => p.id === defaultId) || savedPrinters[0];

      if (targetSaved) {
        queueName = targetSaved.name;
        const isJosh = targetSaved.printerType === 'LABEL' || targetSaved.name.toLowerCase().includes('dp27') || targetSaved.name.toLowerCase().includes('josh') || targetSaved.name.toLowerCase().includes('ld0801') || targetSaved.name.toLowerCase().includes('detong');
        const isDev = targetSaved.printerType === 'RECEIPT_AND_LABEL';
        brand = isJosh ? 'JOSH' : (isDev ? 'DEV' : 'JOSH');
      } else {
        const driverCheckJosh = await this.driverManager.checkDriverInstalled('JOSH');
        /* VEER fallback commented out
        const driverCheckVeer = await this.driverManager.checkDriverInstalled('VEER');
        */

        if (driverCheckJosh.installed) {
          queueName = driverCheckJosh.queueName || 'DeTong DP27 Label Printer';
          brand = 'JOSH';
        /*
        } else if (driverCheckVeer.installed) {
          queueName = driverCheckVeer.queueName || 'POS58 Printer';
          brand = 'VEER';
        } else {
          queueName = 'POS58 Printer';
          brand = 'VEER';
        */
        } else {
          queueName = 'DeTong DP27 Label Printer';
          brand = 'JOSH';
        }
      }
    }

    if (!brand || brand === 'UNSUPPORTED' || brand === 'VEER') {
      brand = 'JOSH';
    }

    logger.info(`[PrinterSetupOrchestrator] Manual test print invoked for target queue "${queueName}" [Brand: ${brand}]`);
    const profile = this.profileService.getProfile(brand);
    return this.testPrintService.executeAutomatedTestPrint(queueName, profile);
  }

  /**
   * Clears all cached hardware endpoint state and forces a fresh V1 pipeline auto-scan
   * to discover and pair a new or different physical USB printer.
   */
  async resetAndScanNewDevice(): Promise<V1OrchestratorState> {
    logger.info('[PrinterSetupOrchestrator] User requested reset & refresh for new physical USB device...');
    this.isSetupRunning = false;
    this.stateService.resetState();
    return await this.runAutomatedV1Pipeline();
  }
}
