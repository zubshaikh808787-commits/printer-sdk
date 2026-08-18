import { exec } from 'child_process';
import util from 'util';
import os from 'os';
import logger from '../logger';

const execPromise = util.promisify(exec);

export interface DetectedUsbHardware {
  name: string;
  vendorId: string | null;
  productId: string | null;
  pnpDeviceId: string;
  service: string;
  isPrinterClass: boolean;
}

export class UsbDiscoveryService {
  private isMonitoring = false;
  private isScanning = false;
  private monitorTimer: NodeJS.Timeout | null = null;

  /**
   * Scans real OS USB controller and PnP entities for physically attached USB printers.
   * NO fake or mock data! Returns empty list if no physical printer is attached.
   */
  async scanPhysicalUsbDevices(): Promise<DetectedUsbHardware[]> {
    if (os.platform() === 'win32') {
      return this.scanWindowsUsbDevices();
    } else {
      return this.scanMacUsbDevices();
    }
  }

  private async scanWindowsUsbDevices(): Promise<DetectedUsbHardware[]> {
    try {
      const detected: DetectedUsbHardware[] = [];
      const seenIds = new Set<string>();

      // ==========================================
      // Physical USB PnP Bus Scan (Targeted Present-Only Query)
      // Only returns hardware that is physically attached and present right now
      // ==========================================
      const psPnpCommand = `powershell -NoProfile -ExecutionPolicy Bypass -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object { ($_.Status -eq 'OK' -or $_.Status -eq 'Degraded') -and ($_.Class -eq 'Printer' -or $_.PNPClass -eq 'Printer' -or $_.InstanceId -like '*USBPRINT*' -or $_.InstanceId -like '*VID_3533*' -or $_.InstanceId -like '*VID_4B43*' -or $_.InstanceId -like '*VID_0416*' -or $_.InstanceId -like '*VID_0483*' -or $_.InstanceId -like '*VID_0FE6*' -or $_.InstanceId -like '*VID_6845*' -or $_.InstanceId -like '*VID_1A86*' -or $_.Service -eq 'usbprint' -or $_.FriendlyName -like '*POS58*' -or $_.FriendlyName -like '*LD0801*' -or $_.FriendlyName -like '*DP27*' -or $_.FriendlyName -like '*Thermal*') } | Select-Object FriendlyName, Name, Caption, InstanceId, PNPDeviceID, Class, PNPClass, Service | ConvertTo-Json"`;
      
      const { stdout: pnpStdout } = await execPromise(psPnpCommand, { maxBuffer: 10 * 1024 * 1024 });
      if (pnpStdout && pnpStdout.trim() !== '') {
        try {
          const parsed = JSON.parse(pnpStdout);
          const list: any[] = Array.isArray(parsed) ? parsed : [parsed];

          for (const item of list) {
            const name = String(item.FriendlyName || item.Name || item.Caption || '').trim();
            const pnpId = String(item.InstanceId || item.PNPDeviceID || '').toUpperCase();
            const pnpClass = String(item.Class || item.PNPClass || '').toLowerCase();
            const service = String(item.Service || '').toLowerCase();
            const lowerName = name.toLowerCase();

            // Ignore internal motherboard system devices, webcams, bluetooth, audio, hid mouse/keyboard
            if (
              lowerName.includes('host controller') ||
              lowerName.includes('root hub') ||
              lowerName.includes('generic usb hub') ||
              lowerName.includes('extensible host') ||
              lowerName.includes('pci standard') ||
              lowerName.includes('bluetooth') ||
              lowerName.includes('camera') ||
              lowerName.includes('audio') ||
              lowerName.includes('mouse') ||
              lowerName.includes('keyboard') ||
              lowerName.includes('input device') ||
              pnpClass === 'hidclass' ||
              lowerName.includes('acpi') ||
              lowerName.includes('thermal zone') ||
              lowerName.includes('unknown usb device') ||
              pnpId.startsWith('ROOT\\') ||
              pnpId.startsWith('SWD\\')
            ) continue;

            if (name === 'Root Print Queue') continue;

            const isPhysicalUsbDevice = pnpId.startsWith('USB\\') || pnpId.startsWith('USBPRINT\\');
            if (!isPhysicalUsbDevice && service !== 'usbprint') continue;

            if (lowerName === 'usb composite device' && service !== 'usbprint' && service !== 'usbser') {
              continue;
            }

            const isPrinterHardware = 
              service === 'usbprint' ||
              service === 'usbser' ||
              service === 'silabser' ||
              service === 'ch341ser' ||
              service === 'ftser2k' ||
              pnpClass === 'printer' ||
              pnpId.startsWith('USBPRINT') ||
              lowerName.includes('printing support') ||
              lowerName.includes('pos') ||
              lowerName.includes('receipt') ||
              lowerName.includes('label') ||
              lowerName.includes('josh') ||
              lowerName.includes('veer') ||
              lowerName.includes('dev') ||
              lowerName.includes('dp27') ||
              lowerName.includes('detong') ||
              lowerName.includes('ld0801') ||
              lowerName.includes('pos58') ||
              lowerName.includes('pos80') ||
              lowerName.includes('sz-80d') ||
              lowerName.includes('xprinter') ||
              lowerName.includes('zjiang') ||
              lowerName.includes('gprinter') ||
              lowerName.includes('dothantech') ||
              lowerName.includes('dtpweb') ||
              lowerName.includes('thermal');

            if (isPrinterHardware) {
              const vidMatch = pnpId.match(/VID_([0-9A-F]{4})/i);
              const pidMatch = pnpId.match(/PID_([0-9A-F]{4})/i);

              const vendorId = vidMatch ? `0x${vidMatch[1]}` : null;
              const productId = pidMatch ? `0x${pidMatch[1]}` : null;

              if (!seenIds.has(pnpId)) {
                seenIds.add(pnpId);
                detected.push({
                  name: name || 'USB Thermal Printer',
                  vendorId,
                  productId,
                  pnpDeviceId: pnpId,
                  service: item.Service || '',
                  isPrinterClass: true,
                });
              }
            }
          }
        } catch (e: any) {
          logger.warn(`[UsbDiscoveryService] Error parsing PnP JSON: ${e.message}`);
        }
      }

      logger.info(`[UsbDiscoveryService] Physical USB printer(s) present: ${detected.length}`);
      return detected;
    } catch (err: any) {
      logger.error(`Error in scanWindowsUsbDevices: ${err.message}`);
      return [];
    }
  }

  private async scanMacUsbDevices(): Promise<DetectedUsbHardware[]> {
    try {
      const { stdout } = await execPromise('system_profiler SPUSBDataType -json');
      if (!stdout || stdout.trim() === '') return [];

      const parsed = JSON.parse(stdout);
      const items: any[] = parsed.SPUSBDataType || [];
      const detected: DetectedUsbHardware[] = [];

      const walkUsbTree = (nodes: any[]) => {
        for (const node of nodes) {
          const name = String(node._name || '').toLowerCase();
          if (name.includes('printer') || name.includes('pos') || name.includes('label') || name.includes('receipt')) {
            detected.push({
              name: node._name || 'USB Printer',
              vendorId: node.vendor_id ? `0x${node.vendor_id}` : null,
              productId: node.product_id ? `0x${node.product_id}` : null,
              pnpDeviceId: node._name,
              service: 'cups',
              isPrinterClass: true,
            });
          }
          if (node._items && Array.isArray(node._items)) {
            walkUsbTree(node._items);
          }
        }
      };

      walkUsbTree(items);
      return detected;
    } catch (err: any) {
      logger.error(`Error in scanMacUsbDevices: ${err.message}`);
      return [];
    }
  }

  startHotplugMonitoring(onChanged: (devices: DetectedUsbHardware[]) => void): void {
    if (this.isMonitoring) return;
    this.isMonitoring = true;
    logger.info('[UsbDiscoveryService] Live USB Hotplug Monitoring active.');

    let lastHash = '';

    this.monitorTimer = setInterval(async () => {
      if (this.isScanning) return;
      this.isScanning = true;
      try {
        const current = await this.scanPhysicalUsbDevices();
        const hash = current.map(d => d.pnpDeviceId).sort().join('|');

        if (hash !== lastHash) {
          lastHash = hash;
          logger.info(`[UsbDiscoveryService] USB PnP topology state change detected! Count: ${current.length}`);
          onChanged(current);
        }
      } catch (err: any) {
        logger.warn(`[UsbDiscoveryService] Hotplug scan notice: ${err.message}`);
      } finally {
        this.isScanning = false;
      }
    }, 4000);
  }

  stopHotplugMonitoring(): void {
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }
    this.isMonitoring = false;
  }
}
