import { dialog, BrowserWindow, nativeImage } from 'electron';
import fs from 'fs';
import path from 'path';
import os from 'os';
import logger from '../logger';
import { BluetoothPrinterTransport } from './transport/BluetoothPrinterTransport';

export type UploadPrintKind = 'IMAGE' | 'PDF' | 'TEXT';

export interface UploadPrintResult {
  success: boolean;
  message: string;
  fileName?: string;
}

export interface PickFileResult {
  success: boolean;
  message: string;
  base64?: string;
  mimeType?: string;
  fileName?: string;
  filePath?: string;
}

export interface LabelPrintParams {
  filePath: string;
  labelSizeId: string;
  scale: number;
  offsetX: number;
  offsetY: number;
}

/** mm dimensions for each preset id (must stay in sync with renderer labelUtils.ts). */
const LABEL_SIZE_MAP: Record<string, { widthMm: number; heightMm: number; twoUp?: boolean; twoUpGapMm?: number }> = {
  '50x50':     { widthMm: 50,  heightMm: 50  },
  '50x25':     { widthMm: 50,  heightMm: 25  },
  '50x15':     { widthMm: 50,  heightMm: 15  },
  'two-up':    { widthMm: 103, heightMm: 50, twoUp: true, twoUpGapMm: 3 },
  'jewellery': { widthMm: 30,  heightMm: 10  },
};

const DEFAULT_LABEL_SIZE_ID = '50x50';
const PRINTER_DPI = 203;

function mmToPx(mm: number): number {
  return Math.round((mm / 25.4) * PRINTER_DPI);
}

/**
 * Lets the user pick a real file (photo, PDF, or plain text) from disk and
 * prints it directly to Bluetooth thermal printers via TSPL/ESC-POS bitmap rasterization,
 * or to Windows Spooler for USB printers.
 */
export class FileTestPrintService {
  private btTransport = new BluetoothPrinterTransport();

  /**
   * Opens a file picker dialog and returns the selected file's data to the renderer
   * for preview — does NOT print. The renderer shows the preview modal, and if
   * the user confirms, calls pickAndPrint() with the already-resolved filePath.
   */
  async pickFile(kind: UploadPrintKind, parentWindow: BrowserWindow | null): Promise<PickFileResult> {
    const filters =
      kind === 'IMAGE'
        ? [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp'] }]
        : kind === 'PDF'
        ? [{ name: 'PDF Documents', extensions: ['pdf'] }]
        : [{ name: 'Text Files', extensions: ['txt', 'log', 'csv', 'md'] }];

    const dialogOpts: Electron.OpenDialogOptions = {
      title: `Select a ${kind.toLowerCase()} file to preview`,
      properties: ['openFile'],
      filters,
    };

    const pickResult = parentWindow
      ? await dialog.showOpenDialog(parentWindow, dialogOpts)
      : await dialog.showOpenDialog(dialogOpts);

    if (pickResult.canceled || pickResult.filePaths.length === 0) {
      return { success: false, message: 'File selection cancelled.' };
    }

    const filePath = pickResult.filePaths[0];
    const fileName = path.basename(filePath);

    try {
      const ext = path.extname(fileName).slice(1).toLowerCase();
      const mimeType = kind === 'PDF' ? 'application/pdf'
        : ext === 'jpg' ? 'image/jpeg'
        : `image/${ext}`;
      const base64 = fs.readFileSync(filePath).toString('base64');
      return { success: true, message: 'File selected.', base64, mimeType, fileName, filePath };
    } catch (err: any) {
      logger.error(`[FileTestPrintService] pickFile error: ${err.message}`);
      return { success: false, message: `Could not read file: ${err.message}` };
    }
  }

  async pickAndPrint(
    kind: UploadPrintKind,
    queueName: string,
    parentWindow: BrowserWindow | null,
    macAddress?: string,
    comPort?: string,
    brand?: string,
    labelParams?: LabelPrintParams
  ): Promise<UploadPrintResult> {
    if (!queueName) {
      return { success: false, message: 'No connected printer selected. Connect a Bluetooth printer first.' };
    }

    let filePath: string;
    let fileName: string;

    if (labelParams?.filePath) {
      // File already picked in the preview step — skip the dialog
      filePath = labelParams.filePath;
      fileName = path.basename(filePath);
    } else {
      const filters =
        kind === 'IMAGE'
          ? [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp'] }]
          : kind === 'PDF'
          ? [{ name: 'PDF Documents', extensions: ['pdf'] }]
          : [{ name: 'Text Files', extensions: ['txt', 'log', 'csv', 'md'] }];

      const dialogOpts: Electron.OpenDialogOptions = { title: `Select a ${kind.toLowerCase()} file to print`, properties: ['openFile'], filters };
      const pickResult = parentWindow
        ? await dialog.showOpenDialog(parentWindow, dialogOpts)
        : await dialog.showOpenDialog(dialogOpts);

      if (pickResult.canceled || pickResult.filePaths.length === 0) {
        return { success: false, message: 'File selection cancelled.' };
      }

      filePath = pickResult.filePaths[0];
      fileName = path.basename(filePath);
    }

    // Resolve label size for page-size-aware printing
    const sizeId = labelParams?.labelSizeId || DEFAULT_LABEL_SIZE_ID;
    const sizeSpec = LABEL_SIZE_MAP[sizeId] || LABEL_SIZE_MAP[DEFAULT_LABEL_SIZE_ID];
    const pxWidth  = mmToPx(sizeSpec.widthMm);
    const pxHeight = mmToPx(sizeSpec.heightMm);
    // webContents.print pageSize is in microns (1mm = 1000um)
    const pageSizeMicrons = { width: sizeSpec.widthMm * 1000, height: sizeSpec.heightMm * 1000 };

    try {
      // If queue is registered in Windows, use native Windows GDI spooler pipeline
      if (os.platform() === 'win32' && queueName) {
        if (kind === 'PDF') {
          return await this.printLocalFileUrl(filePath, queueName, fileName, true, pageSizeMicrons);
        }
        if (kind === 'IMAGE') {
          const html = this.buildImageHtml(this.toDataUri(filePath), labelParams?.scale, labelParams?.offsetX, labelParams?.offsetY, pxWidth, pxHeight, sizeSpec.twoUp, sizeSpec.twoUpGapMm);
          return await this.printHtmlContent(html, queueName, fileName, pageSizeMicrons);
        }
        const text = fs.readFileSync(filePath, 'utf-8');
        const html = this.buildTextHtml(text);
        return await this.printHtmlContent(html, queueName, fileName, pageSizeMicrons);
      }

      // Fallback: Direct wireless raster transport (for direct wireless connections without Windows queue)
      if (macAddress || brand === 'JOSH') {
        logger.info(`[FileTestPrintService] Printing ${kind} "${fileName}" via Bluetooth wireless raster transport...`);
        return await this.printViaBluetooth(filePath, kind, queueName, fileName, macAddress, comPort, brand, pxWidth, pxHeight, sizeSpec.twoUp, sizeSpec.twoUpGapMm);
      }

      if (kind === 'PDF') {
        return await this.printLocalFileUrl(filePath, queueName, fileName, true, pageSizeMicrons);
      }
      if (kind === 'IMAGE') {
        const html = this.buildImageHtml(this.toDataUri(filePath), labelParams?.scale, labelParams?.offsetX, labelParams?.offsetY, pxWidth, pxHeight, sizeSpec.twoUp, sizeSpec.twoUpGapMm);
        return await this.printHtmlContent(html, queueName, fileName, pageSizeMicrons);
      }
      const text = fs.readFileSync(filePath, 'utf-8');
      const html = this.buildTextHtml(text);
      return await this.printHtmlContent(html, queueName, fileName, pageSizeMicrons);
    } catch (err: any) {
      logger.error(`[FileTestPrintService] Error printing ${kind} file "${filePath!}": ${err.message}`);
      return { success: false, message: `Could not print "${fileName!}": ${err.message}`, fileName };
    }
  }

  /** Converts an image/document into a TSPL monochrome bitmap and transmits via Bluetooth BLE GATT */
  private async printViaBluetooth(
    filePath: string,
    kind: UploadPrintKind,
    queueName: string,
    fileName: string,
    macAddress?: string,
    comPort?: string,
    brand?: string,
    targetWidth = 384,
    targetHeight = 384,
    twoUp?: boolean,
    twoUpGapMm?: number
  ): Promise<UploadPrintResult> {
    let payload: Buffer;

    if (kind === 'TEXT') {
      const text = fs.readFileSync(filePath, 'utf-8').trim();
      const lines = text.split('\n').slice(0, 15);
      let tspl = "SIZE 50 mm, 50 mm\r\nGAP 3 mm, 0 mm\r\nDIRECTION 1\r\nREFERENCE 0,0\r\nSET TEAR ON\r\nCLS\r\n";
      let y = 30;
      for (const line of lines) {
        const clean = line.replace(/[\r\n"]/g, ' ').slice(0, 30);
        tspl += `TEXT 30,${y},"2",0,1,1,"${clean}"\r\n`;
        y += 24;
      }
      tspl += "PRINT 1,1\r\n";
      payload = Buffer.from(tspl, 'ascii');
    } else {
      // IMAGE or PDF: Rasterize via nativeImage to 384x384 (standard 48mm thermal width at 203 DPI)
      let nImg: Electron.NativeImage;
      if (kind === 'PDF') {
        nImg = await this.renderPdfToNativeImage(filePath);
      } else {
        nImg = nativeImage.createFromPath(filePath);
      }

      if (nImg.isEmpty()) {
        throw new Error(`Failed to decode image file "${fileName}"`);
      }

      // Scale to fit 384x384 max dots (50x50mm thermal label size)
      const origSize = nImg.getSize();
      const targetWidth = 384;
      const targetHeight = Math.min(384, Math.max(64, Math.round((origSize.height / (origSize.width || 1)) * targetWidth)));
      const resized = nImg.resize({ width: targetWidth, height: targetHeight, quality: 'better' });
      const rgba = resized.toBitmap();

      const widthBytes = Math.ceil(targetWidth / 8); // 48 bytes per row
      const bitmapBuffer = Buffer.alloc(widthBytes * targetHeight, 0xff); // 0xff is white in TSPL mode 0

      for (let y = 0; y < targetHeight; y++) {
        for (let x = 0; x < targetWidth; x++) {
          const idx = (y * targetWidth + x) * 4;
          const r = rgba[idx];
          const g = rgba[idx + 1];
          const b = rgba[idx + 2];
          const a = rgba[idx + 3];

          // Threshold: if pixel is opaque and dark, mark bit as 0 (black in TSPL mode 0)
          const isDark = a > 64 && (0.299 * r + 0.587 * g + 0.114 * b) < 160;
          if (isDark) {
            const byteIdx = y * widthBytes + Math.floor(x / 8);
            const bit = 7 - (x % 8);
            bitmapBuffer[byteIdx] &= ~(1 << bit);
          }
        }
      }

      const mmHeight = Math.max(30, Math.round(targetHeight / 8));
      const header = Buffer.from(
        `SIZE 50 mm, ${mmHeight} mm\r\n` +
        `GAP 3 mm, 0 mm\r\n` +
        `DIRECTION 1\r\n` +
        `REFERENCE 0,0\r\n` +
        `SET TEAR ON\r\n` +
        `CLS\r\n` +
        `BITMAP 0,0,${widthBytes},${targetHeight},0,`,
        'ascii'
      );
      const footer = Buffer.from(`\r\nPRINT 1,1\r\n`, 'ascii');
      payload = Buffer.concat([header, bitmapBuffer, footer]);
    }

    logger.info(`[FileTestPrintService] Generated ${payload.length} bytes TSPL raster payload for "${fileName}". Delivering via Bluetooth...`);
    const printRes = await this.btTransport.write(queueName, payload, comPort, macAddress);

    if (printRes.success) {
      return {
        success: true,
        message: `"${fileName}" transmitted to "${queueName}" via ${printRes.portName} (${printRes.bytesSent} bytes) ✓ Check the physical printout.`,
        fileName,
      };
    }

    return {
      success: false,
      message: `Bluetooth transmission failed: ${printRes.errorMessage}`,
      fileName,
    };
  }

  private async renderPdfToNativeImage(filePath: string): Promise<Electron.NativeImage> {
    const win = new BrowserWindow({
      show: false,
      width: 800,
      height: 800,
      webPreferences: { nodeIntegration: false, contextIsolation: true, plugins: true },
    });
    const fileUrl = 'file:///' + filePath.replace(/\\/g, '/');
    await win.loadURL(fileUrl);
    await new Promise((r) => setTimeout(r, 600));
    const captured = await win.webContents.capturePage();
    win.close();
    return captured;
  }

  private toDataUri(filePath: string): string {
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const mime = ext === 'jpg' ? 'jpeg' : ext;
    const base64 = fs.readFileSync(filePath).toString('base64');
    return `data:image/${mime};base64,${base64}`;
  }

  private buildImageHtml(
    dataUri: string,
    scale = 1,
    offsetX = 0,
    offsetY = 0,
    pxWidth = 400,
    pxHeight = 400,
    twoUp?: boolean,
    twoUpGapMm?: number
  ): string {
    const gapPx = twoUp ? Math.round(((twoUpGapMm || 3) / 25.4) * 203) : 0;
    const singleW = twoUp ? Math.round((pxWidth - gapPx) / 2) : pxWidth;
    const imgStyle = `
      position: absolute;
      width: ${Math.round(singleW * scale)}px;
      height: ${Math.round(pxHeight * scale)}px;
      object-fit: contain;
      transform-origin: top left;
    `;
    const containerStyle = `
      width: ${pxWidth}px;
      height: ${pxHeight}px;
      position: relative;
      overflow: hidden;
      background: #fff;
    `;
    const imgTag = `<img src="${dataUri}" style="${imgStyle} left: ${offsetX}px; top: ${offsetY}px;" />`;
    const twoUpTag = twoUp
      ? `<img src="${dataUri}" style="${imgStyle} left: ${singleW + gapPx + offsetX}px; top: ${offsetY}px;" />`
      : '';
    return `<!DOCTYPE html>
<html><head>
  <meta charset="utf-8" />
  <title>SEZNIK Print — Image</title>
  <style>
    @page { margin: 0; size: ${pxWidth}px ${pxHeight}px; }
    html, body { margin: 0; padding: 0; width: ${pxWidth}px; height: ${pxHeight}px; overflow: hidden; background: #fff; }
  </style>
</head><body>
  <div style="${containerStyle}">${imgTag}${twoUpTag}</div>
</body></html>`;
  }

  private buildTextHtml(text: string): string {
    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>SEZNIK Test Print — Text</title>
  <style>
    @page { margin: 6mm; }
    body { margin: 0; font-family: 'Courier New', monospace; font-size: 11px; white-space: pre-wrap; word-break: break-word; color: #000; }
  </style>
</head>
<body>${escaped}</body>
</html>`;
  }

  private printHtmlContent(
    html: string,
    queueName: string,
    fileName: string,
    pageSize?: { width: number; height: number }
  ): Promise<UploadPrintResult> {
    const tempHtmlPath = path.join(os.tmpdir(), `seznik_upload_print_${Date.now()}.html`);
    fs.writeFileSync(tempHtmlPath, html, 'utf-8');

    return new Promise((resolve) => {
      const printWin = new BrowserWindow({
        show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true },
      });

      printWin.loadFile(tempHtmlPath).then(() => {
        const printOpts: Electron.WebContentsPrintOptions = {
          silent: true,
          printBackground: true,
          deviceName: queueName,
          margins: { marginType: 'none' },
          ...(pageSize ? { pageSize: { width: pageSize.width, height: pageSize.height } } : {}),
        };
        printWin.webContents.print(printOpts, (success, failureReason) => {
          printWin.close();
          try { fs.unlinkSync(tempHtmlPath); } catch (e) {}
          if (success) {
            logger.info(`[FileTestPrintService] Printed "${fileName}" to "${queueName}" ✓`);
            resolve({ success: true, message: `"${fileName}" sent to "${queueName}" ✓ Check the physical printout.`, fileName });
          } else {
            logger.warn(`[FileTestPrintService] Print notice for "${fileName}": ${failureReason}`);
            resolve({ success: false, message: `Print failed: ${failureReason}`, fileName });
          }
        });
      }).catch((err: any) => {
        try { printWin.close(); } catch (e) {}
        try { fs.unlinkSync(tempHtmlPath); } catch (e) {}
        resolve({ success: false, message: `Could not render "${fileName}": ${err.message}`, fileName });
      });
    });
  }

  /** Used for PDFs — loads the file directly so Chromium's built-in PDF viewer renders it, then prints that. */
  private printLocalFileUrl(
    filePath: string,
    queueName: string,
    fileName: string,
    isPdf: boolean,
    pageSize?: { width: number; height: number }
  ): Promise<UploadPrintResult> {
    return new Promise((resolve) => {
      const printWin = new BrowserWindow({
        show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true, plugins: isPdf },
      });

      const fileUrl = 'file:///' + filePath.replace(/\\/g, '/');
      printWin.loadURL(fileUrl).then(() => {
        setTimeout(() => {
          printWin.webContents.print(
            {
              silent: true,
              printBackground: true,
              deviceName: queueName,
              margins: { marginType: 'none' },
              ...(pageSize ? { pageSize: { width: pageSize.width, height: pageSize.height } } : {}),
            },
            (success, failureReason) => {
              printWin.close();
              if (success) {
                logger.info(`[FileTestPrintService] Printed "${fileName}" to "${queueName}" ✓`);
                resolve({ success: true, message: `"${fileName}" sent to "${queueName}" ✓ Check the physical printout.`, fileName });
              } else {
                logger.warn(`[FileTestPrintService] Print notice for "${fileName}": ${failureReason}`);
                resolve({ success: false, message: `Print failed: ${failureReason}`, fileName });
              }
            }
          );
        }, 600);
      }).catch((err: any) => {
        try { printWin.close(); } catch (e) {}
        resolve({ success: false, message: `Could not open "${fileName}": ${err.message}`, fileName });
      });
    });
  }
}
