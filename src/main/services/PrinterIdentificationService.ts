import { V1PrinterProfileBrand } from '../../shared/types';
import { DetectedUsbHardware } from './UsbDiscoveryService';
import logger from '../logger';

/**
 * Known Silicon VID:PID → Brand mapping table for thermal printers.
 * 
 * JOSH = 50x50mm Thermal Label Printer (DP27 / DeTong / DTPWeb / LD0801)
 * VEER = 58mm Thermal Receipt Printer (POS58 / XP-58 / ZJ-58 / Olivetti PRT80 / Winbond / STM32)
 * DEV  = Dual mode 80mm Printer (SZ-80D)
 */
const VID_PID_BRAND_MAP: Record<string, V1PrinterProfileBrand> = {
  // JOSH (DP27 / 50x50mm Thermal Label Printer)
  '4B43:2D37': 'JOSH',
  '4B43': 'JOSH',
  '2D37': 'JOSH',
  '3533:5A11': 'JOSH',
  '3533': 'JOSH',

  // VEER (58mm Thermal Receipt Printer)
  '0483': 'VEER',       // STMicroelectronics (Most common POS58 microcontroller)
  '0483:5740': 'VEER',  // POS58 Virtual COM / USB
  '0483:5743': 'VEER',  // POS58 USB Printer
  '0416': 'VEER',       // Winbond / Nuvoton USB POS58
  '0416:5011': 'VEER',  // POS58 Receipt Printer
  '1FC9': 'VEER',       // NXP LPC POS58
  '1FC9:2016': 'VEER',  // POS58
  '6845': 'VEER',       // Xprinter / ZJiang 58mm
  '6845:0005': 'VEER',  // POS58
  '0471': 'VEER',       // Philips POS58
  '0471:0055': 'VEER',
  '1A86': 'VEER',       // WCH CH340 / CH341 USB-to-Parallel/Serial POS58
  '1A86:7523': 'VEER',
  '1A86:5523': 'VEER',
  '10C4': 'VEER',       // Silicon Labs CP210x POS58
  '0403': 'VEER',       // FTDI POS58

  // DEV (Dual mode 80mm)
  '0FE6': 'DEV',        // ITE Tech dual mode 80mm
  '0FE6:811E': 'DEV',
};

export class PrinterIdentificationService {
  /**
   * Automatically identifies the connected USB printer hardware brand.
   * VEER -> VEER (Receipt Printer -> POS58 driver)
   * DEV  -> DEV  (Dual mode -> DEV driver)
   */
  identifyHardware(device: DetectedUsbHardware): V1PrinterProfileBrand {
    const name = device.name.toLowerCase();
    const pnp = device.pnpDeviceId.toLowerCase();
    const svc = (device.service || '').toLowerCase();
    const combined = `${name} ${pnp} ${svc}`;

    logger.info(`[PrinterIdentificationService] Analyzing USB hardware: "${device.name}" [PnP: ${device.pnpDeviceId}] [Service/Driver: ${device.service}]`);

    // =============================================
    // STRATEGY 1: Physical Silicon VID / PID Hardware Lookup (Highest Accuracy)
    // =============================================
    const vidMatch = pnp.match(/vid_([0-9a-f]{4})/i);
    const pidMatch = pnp.match(/pid_([0-9a-f]{4})/i);

    const vid = (device.vendorId || (vidMatch ? `0x${vidMatch[1]}` : '')).replace('0x', '').toUpperCase();
    const pid = (device.productId || (pidMatch ? `0x${pidMatch[1]}` : '')).replace('0x', '').toUpperCase();

    if (vid) {
      const exactKey = pid ? `${vid}:${pid}` : vid;
      if (VID_PID_BRAND_MAP[exactKey]) {
        const brand = VID_PID_BRAND_MAP[exactKey];
        logger.info(`[PrinterIdentificationService] Silicon VID:PID exact match (${exactKey}) → [${brand}]`);
        return brand;
      }

      if (VID_PID_BRAND_MAP[vid]) {
        const brand = VID_PID_BRAND_MAP[vid];
        logger.info(`[PrinterIdentificationService] Silicon VID match (${vid}) → [${brand}]`);
        return brand;
      }
    }

    // =============================================
    // STRATEGY 2: Explicit Keyword Matching
    // =============================================

    // Check JOSH (DP27 / LD0801 / 50x50mm Thermal Label Printer)
    const isJosh = 
      combined.includes('dp27') ||
      combined.includes('josh') ||
      combined.includes('ld0801') ||
      combined.includes('detong') ||
      combined.includes('dtpweb') ||
      combined.includes('tspl') ||
      combined.includes('sticker') ||
      combined.includes('label') ||
      combined.includes('4b43') ||
      combined.includes('2d37') ||
      combined.includes('3533') ||
      combined.includes('5a11');

    if (isJosh) {
      logger.info(`[PrinterIdentificationService] Keyword match → [JOSH] (50x50mm Label Printer)`);
      return 'JOSH';
    }

    // Check DEV (Combo / Dual mode 80mm Printer)
    const isDev = 
      combined.includes('sz-80d') ||
      combined.includes('dev-58') ||
      combined.includes('dev-80') ||
      combined.includes('pos80') ||
      combined.includes('pos-80') ||
      (combined.includes('dev') && !combined.includes('device') && !combined.includes('developer'));

    if (isDev) {
      logger.info(`[PrinterIdentificationService] Keyword match → [DEV] (80mm Dual Mode)`);
      return 'DEV';
    }

    // Check VEER keywords (specific 58mm POS keywords only)
    const isVeer = 
      combined.includes('pos58') ||
      combined.includes('pos-58') ||
      combined.includes('pos 58') ||
      combined.includes('veer') ||
      combined.includes('58mm') ||
      combined.includes('olivetti') ||
      combined.includes('prt80') ||
      combined.includes('xprinter') ||
      combined.includes('zjiang') ||
      combined.includes('gprinter') ||
      combined.includes('yxwl');

    if (isVeer) {
      logger.info(`[PrinterIdentificationService] Keyword match → [VEER] (58mm Receipt Printer)`);
      return 'VEER';
    }

    // =============================================
    // STRATEGY 3: Generic USB Thermal Printer Default (JOSH Label Printer)
    // =============================================
    logger.info(`[PrinterIdentificationService] Defaulting connected USB printer hardware to [JOSH] (50x50mm Label Printer)`);
    return 'JOSH';
  }
}
