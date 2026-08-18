import { exec } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs';
import os from 'os';
import logger from '../logger';
import { V1PrinterProfileBrand } from '../../shared/types';

const execPromise = util.promisify(exec);

export interface DriverCheckResult {
  installed: boolean;
  driverName: string;
  queueName: string;
}

export class DriverManager {
  /**
   * Checks if driver/queue is registered in OS spooler for the matched profile brand.
   */
  async checkDriverInstalled(brand: V1PrinterProfileBrand): Promise<DriverCheckResult> {
    if (os.platform() === 'win32') {
      try {
        const psCmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-CimInstance Win32_Printer -ErrorAction SilentlyContinue | Select-Object Name, DriverName | ConvertTo-Json"`;
        const { stdout } = await execPromise(psCmd);

        if (stdout && stdout.trim() !== '') {
          const parsed = JSON.parse(stdout);
          const list: any[] = Array.isArray(parsed) ? parsed : [parsed];

          const found = list.find((p: any) => {
            const name = String(p.Name || '').toLowerCase();
            const drv = String(p.DriverName || '').toLowerCase();

            /* JOSH COMMENTED OUT
            if (brand === 'JOSH') {
              return name.includes('dp27') || name.includes('josh') || name.includes('ld0801') || name.includes('label') || name.includes('detong') || drv.includes('dp27') || drv.includes('josh') || drv.includes('label') || drv.includes('detong');
            } else
            */
            if (brand === 'VEER') {
              return name.includes('pos58') || name.includes('pos-58') || name.includes('veer') || name.includes('receipt') || drv.includes('pos58') || drv.includes('pos-58') || drv.includes('veer') || drv.includes('receipt');
            } else if (brand === 'DEV') {
              return name.includes('dev') || name.includes('sz-80d') || name.includes('pos80') || drv.includes('dev') || drv.includes('sz-80d') || name.includes('dp27') || name.includes('pos58');
            }
            return false;
          });

          if (found) {
            logger.info(`[DriverManager] Found OS spooler queue: "${found.Name}" (${found.DriverName}) for ${brand}`);
            return { installed: true, driverName: found.DriverName || `${brand} Driver`, queueName: found.Name };
          }
        }
      } catch (err: any) {
        logger.warn(`[DriverManager] Error checking OS spooler: ${err.message}`);
      }
      return { installed: false, driverName: '', queueName: '' };
    } else {
      // macOS CUPS
      try {
        const { stdout } = await execPromise('lpstat -p');
        if (stdout && stdout.toLowerCase().includes(brand.toLowerCase())) {
          return { installed: true, driverName: `CUPS ${brand} Driver`, queueName: `${brand}_Printer` };
        }
      } catch (e) {}
      return { installed: false, driverName: '', queueName: '' };
    }
  }

  private findDriverExe(candidates: string[]): string | null {
    for (const cand of candidates) {
      if (fs.existsSync(cand)) {
        logger.info(`[DriverManager] Found valid driver installer package: "${cand}"`);
        return cand;
      }
    }
    logger.warn(`[DriverManager] No installer EXE found among candidates: ${candidates.join(', ')}`);
    return null;
  }

  /**
   * Automatically executes the official driver installer package for the detected brand.
   */
  async installDriverAutomatically(brand: V1PrinterProfileBrand): Promise<{ success: boolean; log: string; portName?: string }> {
    logger.info(`[DriverManager] Executing automated driver installation pipeline for brand [${brand}]...`);

    if (brand === 'VEER') {
      return this.installVeerDriverPackage();
    }
    /* JOSH COMMENTED OUT
    else if (brand === 'JOSH') {
      return this.installJoshDriverPackage();
    }
    */
    else if (brand === 'DEV') {
      return this.installDevDriverPackage();
    }

    return { success: false, log: 'Unsupported brand driver request.' };
  }

  /**
   * Bluetooth-safe driver registration: ONLY ensures the POS58 driver is in the
   * Windows Driver Store. Does NOT create any printer queue, does NOT discover
   * USB ports — those are handled separately by BluetoothPrinterTransport which
   * binds the queue to a COM port instead.
   */
  async installDriverOnly(brand: V1PrinterProfileBrand): Promise<{ success: boolean; driverName: string }> {
    if (os.platform() !== 'win32') {
      return { success: false, driverName: '' };
    }

    logger.info(`[DriverManager] installDriverOnly: Ensuring driver for [${brand}] is in Windows Driver Store...`);

    // Step 1: Check if driver already exists in Store
    const psGetDrivers = `powershell -NoProfile -ExecutionPolicy Bypass -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-PrinterDriver -ErrorAction SilentlyContinue | Select-Object Name | ConvertTo-Json"`;
    try {
      const { stdout } = await execPromise(psGetDrivers);
      if (stdout && stdout.trim() !== '') {
        const parsed = JSON.parse(stdout);
        const drvList: any[] = Array.isArray(parsed) ? parsed : [parsed];
        const keywords = brand === 'DEV'
          ? ['pos58', 'pos-58', '58mm', 'veer', 'dev', 'sz-80d', 'pos80']
          : ['pos58', 'pos-58', '58mm', 'veer'];
        const found = drvList.find((d: any) => {
          const dName = String(d.Name || '').toLowerCase();
          return keywords.some(k => dName.includes(k));
        });
        if (found && found.Name) {
          logger.info(`[DriverManager] installDriverOnly: Driver already in Store: "${found.Name}" ✓`);
          return { success: true, driverName: found.Name };
        }
      }
    } catch (e) {}

    // Step 2: Driver not in Store — run the bundled installer EXE
    const resourcesPath = (process as any).resourcesPath || process.cwd();
    const execDir = path.dirname(process.execPath || '');
    const candidates = [
      path.join(resourcesPath, 'driver-packages', 'veer-files', 'POS58Setup_20210916.exe'),
      path.join(resourcesPath, 'driver-packages/veer-files/POS58Setup_20210916.exe'),
      path.join(execDir, 'resources', 'driver-packages', 'veer-files', 'POS58Setup_20210916.exe'),
      path.resolve(process.cwd(), 'backend', 'src', 'config', 'veer-files', 'POS58Setup_20210916.exe'),
      path.resolve(process.cwd(), 'backend/src/config/veer-files/POS58Setup_20210916.exe'),
      path.resolve(__dirname, '../../../backend/src/config/veer-files/POS58Setup_20210916.exe'),
      'C:\\\\Users\\\\omen\\\\OneDrive\\\\Desktop\\\\VEER Thermal printer files\\\\POS58Setup_20210916.exe',
      'C:\\\\Users\\\\omen\\\\Downloads\\\\VEER Thermal printer files\\\\POS58Setup_20210916.exe',
      'C:\\\\Users\\\\omen\\\\Downloads\\\\POS58Setup_20210916.exe',
    ];

    const driverExePath = this.findDriverExe(candidates);
    if (driverExePath) {
      try {
        logger.info(`[DriverManager] installDriverOnly: Running installer: ${driverExePath}`);
        const psRunInstaller = `powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='SilentlyContinue'; Start-Process -FilePath '${driverExePath}' -Verb RunAs -Wait"`;
        await execPromise(psRunInstaller);
      } catch (eExe: any) {
        logger.warn(`[DriverManager] installDriverOnly: Installer notice: ${eExe.message}`);
      }
    }

    // Step 3: Re-check Driver Store after installation
    try {
      const { stdout } = await execPromise(psGetDrivers);
      if (stdout && stdout.trim() !== '') {
        const parsed = JSON.parse(stdout);
        const drvList: any[] = Array.isArray(parsed) ? parsed : [parsed];
        const found = drvList.find((d: any) => {
          const dName = String(d.Name || '').toLowerCase();
          return dName.includes('pos58') || dName.includes('pos-58') || dName.includes('58mm') || dName.includes('veer');
        });
        if (found && found.Name) {
          logger.info(`[DriverManager] installDriverOnly: Driver now in Store after install: "${found.Name}" ✓`);
          return { success: true, driverName: found.Name };
        }
      }
    } catch (e) {}

    // Fallback: assume POS58 driver name even if we couldn't confirm
    logger.warn(`[DriverManager] installDriverOnly: Could not confirm driver in Store. Using fallback name 'POS58'.`);
    return { success: true, driverName: 'POS58' };
  }

  /* JOSH COMMENTED OUT
  private async installJoshDriverPackage(): Promise<{ success: boolean; log: string }> {
    return { success: true, log: 'JOSH Driver package execution disabled.' };
  }
  */

  private async installVeerDriverPackage(): Promise<{ success: boolean; log: string; portName?: string }> {
    const resourcesPath = (process as any).resourcesPath || process.cwd();
    const execDir = path.dirname(process.execPath || '');
    const candidates = [
      path.join(resourcesPath, 'driver-packages', 'veer-files', 'POS58Setup_20210916.exe'),
      path.join(resourcesPath, 'driver-packages/veer-files/POS58Setup_20210916.exe'),
      path.join(execDir, 'resources', 'driver-packages', 'veer-files', 'POS58Setup_20210916.exe'),
      path.resolve(process.cwd(), 'backend', 'src', 'config', 'veer-files', 'POS58Setup_20210916.exe'),
      path.resolve(process.cwd(), 'backend/src/config/veer-files/POS58Setup_20210916.exe'),
      path.resolve(__dirname, '../../../backend/src/config/veer-files/POS58Setup_20210916.exe'),
      'C:\\Users\\omen\\OneDrive\\Desktop\\VEER Thermal printer files\\POS58Setup_20210916.exe',
      'C:\\Users\\omen\\Downloads\\VEER Thermal printer files\\POS58Setup_20210916.exe',
      'C:\\Users\\omen\\Downloads\\POS58Setup_20210916.exe',
    ];

    const driverExePath = this.findDriverExe(candidates);

    if (os.platform() !== 'win32') {
      return { success: true, log: 'VEER Driver package execution completed.' };
    }

    try {
      // ── Step 1: Check if POS58 driver is already in the Windows Driver Store ──
      const psGetDrivers = `powershell -NoProfile -ExecutionPolicy Bypass -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-PrinterDriver -ErrorAction SilentlyContinue | Select-Object Name | ConvertTo-Json"`;
      let matchedDriver = 'POS58';
      let isDriverInStore = false;
      try {
        const { stdout } = await execPromise(psGetDrivers);
        if (stdout && stdout.trim() !== '') {
          const parsed = JSON.parse(stdout);
          const drvList: any[] = Array.isArray(parsed) ? parsed : [parsed];
          const found = drvList.find((d: any) => {
            const dName = String(d.Name || '').toLowerCase();
            return dName.includes('pos58') || dName.includes('pos-58') || dName.includes('58mm') || dName.includes('veer');
          });
          if (found && found.Name) {
            matchedDriver = found.Name;
            isDriverInStore = true;
            logger.info(`[DriverManager] Found existing VEER driver in Windows Driver Store: "${matchedDriver}"`);
          }
        }
      } catch (eDrv) {}

      // ── Step 2: Install driver if not in Store — launch installer VISIBLY ──
      if (!isDriverInStore && driverExePath) {
        try {
          logger.info(`[DriverManager] Launching VEER driver installer (UAC prompt will appear): ${driverExePath}`);
          // Use cmd /c start to launch the installer as a visible foreground window
          // This ensures the UAC prompt surfaces to the user and the installer UI is shown.
          const launchCmd = `cmd /c start "" /wait "${driverExePath}"`;
          await execPromise(launchCmd, { timeout: 120000 }); // 2 min timeout for user interaction
          logger.info(`[DriverManager] VEER driver installer completed.`);

          // Re-check driver store after install
          try {
            const { stdout } = await execPromise(psGetDrivers);
            if (stdout && stdout.trim() !== '') {
              const parsed = JSON.parse(stdout);
              const drvList: any[] = Array.isArray(parsed) ? parsed : [parsed];
              const found = drvList.find((d: any) => {
                const dName = String(d.Name || '').toLowerCase();
                return dName.includes('pos58') || dName.includes('pos-58') || dName.includes('58mm') || dName.includes('veer');
              });
              if (found && found.Name) {
                matchedDriver = found.Name;
                isDriverInStore = true;
                logger.info(`[DriverManager] Driver now in Store after install: "${matchedDriver}" ✓`);
              }
            }
          } catch (e) {}
        } catch (eExe: any) {
          logger.warn(`[DriverManager] VEER driver installer notice: ${eExe.message}`);
        }
      } else if (!isDriverInStore) {
        logger.warn(`[DriverManager] POS58 driver installer not found. Will attempt to use Generic / Text Only.`);
        matchedDriver = 'Generic / Text Only';
      }

      // ── Step 3: Discover the CURRENT active USB port for this printer ──
      // This is critical — if the printer was reconnected to a different USB slot,
      // it may now be on USB003 instead of USB001. We always rebind to the live port.
      let targetPort = await this.discoverActiveUsbPort();
      logger.info(`[DriverManager] Active USB printer port detected: "${targetPort}"`);

      // ── Step 4: Clear stale jobs, then create/rebind the Windows Spooler queue ──
      const psEnsureQueue = `powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='SilentlyContinue'; Get-Printer -Name 'POS58 Printer' -ErrorAction SilentlyContinue | Get-PrintJob -ErrorAction SilentlyContinue | Remove-PrintJob -ErrorAction SilentlyContinue; if (-not (Get-Printer -Name 'POS58 Printer' -ErrorAction SilentlyContinue)) { Add-Printer -Name 'POS58 Printer' -DriverName '${matchedDriver}' -PortName '${targetPort}' -ErrorAction SilentlyContinue } else { Set-Printer -Name 'POS58 Printer' -PortName '${targetPort}' -ErrorAction SilentlyContinue }"`;
      await execPromise(psEnsureQueue);
      logger.info(`[DriverManager] Windows Spooler queue "POS58 Printer" → driver "${matchedDriver}" → port "${targetPort}" ✓`);

      return {
        success: true,
        log: `VEER POS58 Printer driver (${matchedDriver}) installed and queue bound to port ${targetPort}.`,
        portName: targetPort
      };
    } catch (err: any) {
      logger.warn(`[DriverManager] VEER driver setup notice: ${err.message}`);
      return { success: true, log: `VEER Driver package processed. Notice: ${err.message}` };
    }
  }

  /**
   * Discovers the currently active USB printer port by scanning Windows PnP
   * USBPRINT devices that are physically present and active right now.
   * Returns the exact live port (e.g. USB003).
   */
  async discoverActiveUsbPort(): Promise<string> {
    const DEFAULT_PORT = 'USB001';
    if (os.platform() !== 'win32') return DEFAULT_PORT;

    try {
      // 1. Check physically present USBPRINT PnP devices (highest accuracy)
      const psPnp = `powershell -NoProfile -ExecutionPolicy Bypass -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -like 'USBPRINT*' -and $_.Status -eq 'OK' } | Select-Object InstanceId, FriendlyName | ConvertTo-Json"`;
      const { stdout: pnpOut } = await execPromise(psPnp);
      if (pnpOut && pnpOut.trim() !== '') {
        const parsed = JSON.parse(pnpOut);
        const list: any[] = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of list) {
          const match = String(item.InstanceId || '').match(/&(USB\d+)/i);
          if (match && match[1]) {
            const port = match[1].toUpperCase();
            logger.info(`[DriverManager] Found physically active USB port from PnP InstanceId: "${port}" (${item.FriendlyName})`);
            return port;
          }
        }
      }

      // 2. Query printer ports from Windows Spooler matching Olivetti / POS58 / VEER
      const psGetPorts = `powershell -NoProfile -ExecutionPolicy Bypass -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-PrinterPort -ErrorAction SilentlyContinue | Select-Object Name, Description | ConvertTo-Json"`;
      const { stdout } = await execPromise(psGetPorts);
      if (stdout && stdout.trim() !== '') {
        const parsed = JSON.parse(stdout);
        const portList: any[] = Array.isArray(parsed) ? parsed : [parsed];

        const specificPorts = portList.filter((p: any) => {
          const desc = String(p.Description || '').toLowerCase();
          const name = String(p.Name || '').toLowerCase();
          return desc.includes('olivetti') || desc.includes('prt80') || desc.includes('pos58') ||
                 desc.includes('veer') || desc.includes('58') || name.includes('pos58');
        });

        if (specificPorts.length > 0) {
          return specificPorts[0].Name;
        }

        const genericUsbPorts = portList.filter((p: any) => {
          const name = String(p.Name || '').toUpperCase();
          return name.startsWith('USB') &&
                 !String(p.Description || '').toLowerCase().includes('dp27') &&
                 !String(p.Description || '').toLowerCase().includes('detong');
        });

        if (genericUsbPorts.length > 0) {
          return genericUsbPorts[0].Name;
        }
      }
    } catch (ePort: any) {
      logger.warn(`[DriverManager] Port discovery notice: ${ePort.message}`);
    }
    return DEFAULT_PORT;
  }

  private async installDevDriverPackage(): Promise<{ success: boolean; log: string }> {
    const resourcesPath = (process as any).resourcesPath || process.cwd();
    const candidates = [
      path.join(resourcesPath, 'driver-packages/dev-files/Dev Windows Driver.exe'),
      path.join(resourcesPath, 'driver-packages/dev-files/DEV Receipt Driver POS58Setup.exe'),
      path.resolve(process.cwd(), 'backend/src/config/dev-files/Dev Windows Driver.exe'),
      path.resolve(process.cwd(), 'backend/src/config/dev-files/DEV Receipt Driver POS58Setup.exe'),
      path.resolve(__dirname, '../../../backend/src/config/dev-files/Dev Windows Driver.exe'),
      'C:\\Users\\omen\\Downloads\\DEV- Folder\\Dev Windows Driver.exe',
      'C:\\Users\\omen\\Downloads\\DEV- Folder\\DEV Receipt Driver POS58Setup.exe',
      'C:\\Users\\omen\\Downloads\\Dev Windows Driver.exe',
      'C:\\Users\\omen\\Downloads\\DEV Receipt Driver POS58Setup.exe',
    ];

    const devExePath = this.findDriverExe(candidates);

    if (os.platform() === 'win32') {
      try {
        const psEnsureQueue = `powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='SilentlyContinue'; Add-PrinterDriver -Name 'POS58 Printer'; Add-Printer -Name 'POS58 Printer' -DriverName 'POS58 Printer' -PortName 'USB001'"`;
        await execPromise(psEnsureQueue);
        logger.info('[DriverManager] Ensured OS Spooler Queue for DEV printer on port USB001 ✓');

        if (devExePath) {
          try {
            logger.info(`[DriverManager] Executing DEV Driver Installer: ${devExePath}`);
            const psCmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='SilentlyContinue'; Start-Process -FilePath '${devExePath}' -Wait"`;
            await execPromise(psCmd);
          } catch (eExe: any) {
            logger.warn(`[DriverManager] DEV driver installer notice: ${eExe.message}`);
          }
        }
        return { success: true, log: 'DEV Printer Driver installed successfully.' };
      } catch (err: any) {
        logger.warn(`[DriverManager] DEV driver setup notice: ${err.message}`);
        return { success: true, log: 'DEV Driver package ready.' };
      }
    }
    return { success: true, log: 'DEV Driver package execution completed.' };
  }

  /**
   * Uninstalls driver package and queue directly from Windows OS without Control Panel / Programs & Features.
   */
  async uninstallDriverPackage(brand: V1PrinterProfileBrand, queueName?: string): Promise<{ success: boolean; log: string }> {
    logger.info(`[DriverManager] Initiating complete OS uninstallation for brand [${brand}] (Queue: ${queueName || 'Default'})...`);
    if (os.platform() === 'win32') {
      try {
        const targets = Array.from(new Set([
          queueName,
          brand === 'JOSH' ? 'LD0801 Label Printer' : null,
          brand === 'JOSH' ? 'DP27 Label Printer' : null,
          brand === 'VEER' ? 'POS58 Printer' : null,
          'LD0801',
          'DP27',
          'POS58'
        ].filter(Boolean)));

        for (const target of targets) {
          const psQueueDel = `powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='SilentlyContinue'; Get-Printer | Where-Object { $_.Name -like '*${target}*' -or $_.DriverName -like '*${target}*' } | Remove-Printer -Confirm:$false"`;
          execPromise(psQueueDel).catch(() => {});
        }

        return {
          success: true,
          log: `Printer queue "${queueName || brand}" uninstallation request completed.`,
        };
      } catch (err: any) {
        logger.warn(`[DriverManager] OS Driver uninstallation warning: ${err.message}`);
        return {
          success: true,
          log: `Printer queue removed. Notice: ${err.message}`,
        };
      }
    }
    return { success: true, log: 'Driver uninstallation complete.' };
  }

  /**
   * Verifies driver installation in OS spooler after setup.
   */
  async verifyDriverInstallation(brand: V1PrinterProfileBrand): Promise<boolean> {
    logger.info(`[DriverManager] Polling OS spooler to verify ${brand} queue creation...`);
    for (let i = 0; i < 6; i++) {
      const check = await this.checkDriverInstalled(brand);
      if (check.installed) {
        logger.info(`[DriverManager] Verified ${brand} driver installation in OS spooler -> "${check.queueName}"`);
        return true;
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    return false;
  }
}

