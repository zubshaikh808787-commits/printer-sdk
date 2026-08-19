import { exec } from 'child_process';
import util from 'util';
import os from 'os';
import path from 'path';
import fs from 'fs';
import logger from '../logger';
import { BluetoothAdapterStatus, BluetoothPairedDevice, V1PrinterProfileBrand } from '../../shared/types';

const execPromise = util.promisify(exec);

// Brand-specific keyword sets, mirroring PrinterIdentificationService's USB
// heuristics. All thermal Bluetooth printers default to VEER (58mm ESC/POS).
const JOSH_KEYWORDS = ['josh', 'dp27', 'ld0801', 'detong', 'dtpweb', 'tspl', 'sticker', 'label', 'dothantech'];
const VEER_KEYWORDS = [
  'veer', 'pos58', 'pos-58', 'pos 58', '58mm', 'receipt', 'olivetti', 'prt80', 'xprinter',
  'zjiang', 'gprinter', 'mpt', 'mtp', 'rpp', 'pt-', 'pt2', 'zj-', 'zj', '58hb', 'innerprinter',
  'sp-pos', 'pos', 'thermal'
];
const DEV_KEYWORDS = ['sz-80d', 'pos80', 'pos-80', 'dev-58', 'dev-80'];

// Any of these means "this is plausibly some kind of printer"
const GENERIC_PRINTER_KEYWORDS = [
  'printer', 'print', 'pos', 'thermal', 'esc/pos', 'escpos', 'bt-', 'spp',
  'mtp', 'mpt', 'goojprt', 'rpp', 'zj', 'pt', '58', 'receipt',
];

// Devices that are never printers — filtered out so the picker isn't cluttered
// with phones, headsets, watches, etc.
const NON_PRINTER_KEYWORDS = [
  'headphone', 'headset', 'earbud', 'earphone', 'airpod', 'speaker', 'mouse',
  'keyboard', 'watch', 'band', 'phone', 'iphone', 'galaxy', 'tv', 'display',
  'monitor', 'controller', 'gamepad', 'buds', 'car', 'audio',
];

export interface BluetoothDiscoveryResult {
  adapterStatus: BluetoothAdapterStatus;
  devices: BluetoothPairedDevice[];
}

export class BluetoothDiscoveryService {
  /**
   * Extracts a 12-hex-digit Bluetooth MAC address from a Windows PnP
   * InstanceId. The classic SPP service UUID (00001101-...-00805f9b34fb)
   * appears in almost every Bluetooth InstanceId and must NOT be mistaken
   * for the address, so we only accept a token that is a clean 12-hex run
   * with no hyphens (the UUID's segments all contain hyphens).
   */
  private extractMacAddress(instanceId: string): string | null {
    if (!instanceId) return null;
    const tokens = instanceId.split(/[\\&_]/);
    for (let i = tokens.length - 1; i >= 0; i--) {
      const t = tokens[i].trim();
      if (/^[0-9A-Fa-f]{12}$/.test(t)) {
        return t.toUpperCase();
      }
    }
    return null;
  }

  /** Best-guess hardware profile from the device's advertised Bluetooth name. */
  private guessBrand(name: string): V1PrinterProfileBrand {
    const lower = name.toLowerCase();
    if (NON_PRINTER_KEYWORDS.some(k => lower.includes(k))) return 'UNSUPPORTED';
    if (JOSH_KEYWORDS.some(k => lower.includes(k))) return 'JOSH';
    if (DEV_KEYWORDS.some(k => lower.includes(k))) return 'DEV';
    if (VEER_KEYWORDS.some(k => lower.includes(k))) return 'VEER';
    // Any Bluetooth device that passes the non-printer filter and matches
    // generic printer keywords defaults to VEER (58mm ESC/POS receipt printer)
    if (GENERIC_PRINTER_KEYWORDS.some(k => lower.includes(k))) return 'VEER';
    return 'UNSUPPORTED';
  }

  private isLikelyPrinter(name: string, brand: V1PrinterProfileBrand): boolean {
    if (brand !== 'UNSUPPORTED') return true;
    const lower = name.toLowerCase();
    if (NON_PRINTER_KEYWORDS.some(k => lower.includes(k))) return false;
    return GENERIC_PRINTER_KEYWORDS.some(k => lower.includes(k));
  }

  private resolveScriptPath(filename: string): string {
    const candidates = [
      path.join(__dirname, '..', 'scripts', filename),
      path.join(__dirname, '..', '..', 'src', 'main', 'scripts', filename),
      path.resolve(process.cwd(), 'src', 'main', 'scripts', filename),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return candidates[0]; // fallback
  }

  /**
   * Returns every paired Bluetooth device, with its bound SPP COM port
   * resolved where Windows has one (correlated by shared MAC address).
   * Devices are sorted with likely-printer matches first.
   * Also returns Bluetooth adapter status for the UI to distinguish
   * "no adapter" from "adapter off" from "no devices found".
   */
  async getPairedDevices(): Promise<BluetoothDiscoveryResult> {
    if (os.platform() !== 'win32') {
      logger.warn('[BT:DISCOVERY] Bluetooth SPP pairing is only implemented for Windows.');
      return { adapterStatus: 'UNKNOWN', devices: [] };
    }

    try {
      const scriptPath = this.resolveScriptPath('bt_discovery.ps1');
      const psCmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`;
      const { stdout } = await execPromise(psCmd, { maxBuffer: 10 * 1024 * 1024, timeout: 15000 });
      if (!stdout || stdout.trim() === '') {
        logger.warn('[BT:DISCOVERY] bt_discovery.ps1 returned empty output.');
        return { adapterStatus: 'UNKNOWN', devices: [] };
      }

      const parsed = JSON.parse(stdout.trim());

      // New envelope format: { AdapterStatus: "...", Devices: [...] }
      const adapterStatus: BluetoothAdapterStatus = parsed.AdapterStatus || 'UNKNOWN';
      const rawDevices: any[] = Array.isArray(parsed.Devices) ? parsed.Devices : (Array.isArray(parsed) ? parsed : []);

      logger.info(`[BT:ADAPTER] Bluetooth adapter state: ${adapterStatus}`);

      if (adapterStatus === 'NOT_PRESENT') {
        logger.warn('[BT:ADAPTER] No Bluetooth adapter detected on this machine.');
        return { adapterStatus, devices: [] };
      }
      if (adapterStatus === 'PRESENT_BUT_DISABLED') {
        logger.warn('[BT:ADAPTER] Bluetooth adapter found but is disabled.');
        return { adapterStatus, devices: [] };
      }

      const devices: BluetoothPairedDevice[] = rawDevices.map(item => {
        const name = String(item.Name || '').trim();
        const address = item.Address ? String(item.Address).toUpperCase() : null;
        const brand = this.guessBrand(name);
        const comPort = item.ComPort ? String(item.ComPort).toUpperCase() : null;

        return {
          id: address || `bt-${name.replace(/\s+/g, '-').toLowerCase()}`,
          name,
          address,
          comPort,
          isLikelyPrinter: this.isLikelyPrinter(name, brand),
          likelyBrand: brand,
        };
      });

      devices.sort((a, b) => {
        if (a.isLikelyPrinter !== b.isLikelyPrinter) return a.isLikelyPrinter ? -1 : 1;
        if (!!a.comPort !== !!b.comPort) return a.comPort ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      logger.info(`[BT:DISCOVERY] Discovered ${devices.length} Bluetooth device(s): ${devices.map(d => `${d.name}(${d.comPort || 'no-port'})`).join(', ')}`);
      return { adapterStatus, devices };
    } catch (err: any) {
      logger.error(`[BT:DISCOVERY] Discovery error: ${err.message}`);
      return { adapterStatus: 'UNKNOWN', devices: [] };
    }
  }

  /**
   * Attempts to ensure a COM port exists for a paired Bluetooth device.
   * Calls bt_ensure_com_port.ps1 which tries multiple strategies:
   * 1. Find an existing COM port by MAC correlation
   * 2. Walk parent devices in the registry
   * 3. Trigger a PnP rescan to prompt Windows to create the port
   *
   * Returns the COM port name (e.g. "COM5") if successful, or null with
   * an error detail if it couldn't create one.
   */
  async ensureComPort(macAddress: string): Promise<{ comPort: string | null; hasRfcomm: boolean; error: string | null }> {
    if (!macAddress || os.platform() !== 'win32') {
      return { comPort: null, hasRfcomm: false, error: 'Not on Windows or no MAC address provided.' };
    }

    try {
      const scriptPath = this.resolveScriptPath('bt_ensure_com_port.ps1');
      const cleanMac = macAddress.replace(/[^A-Fa-f0-9]/g, '').toUpperCase();
      const psCmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -MacAddress "${cleanMac}"`;
      const { stdout } = await execPromise(psCmd, { timeout: 20000 });
      const result = JSON.parse((stdout || '').trim());

      if (result.Success && result.ComPort) {
        logger.info(`[BT:COM_PORT] Resolved COM port for ${cleanMac}: ${result.ComPort} (method: ${result.Method})`);
        return { comPort: result.ComPort, hasRfcomm: true, error: null };
      }

      if (result.Error === 'NO_COM_PORT_BUT_RFCOMM_OK') {
        logger.info(`[BT:COM_PORT] No COM port for ${cleanMac} but RFCOMM is available — direct transport will work.`);
        return { comPort: null, hasRfcomm: true, error: null };
      }

      logger.warn(`[BT:COM_PORT] Could not resolve COM port for ${cleanMac}: ${result.Error} — ${result.Message}`);
      return { comPort: null, hasRfcomm: false, error: result.Message || result.Error };
    } catch (err: any) {
      logger.error(`[BT:COM_PORT] ensureComPort error for ${macAddress}: ${err.message}`);
      return { comPort: null, hasRfcomm: false, error: err.message };
    }
  }
}
