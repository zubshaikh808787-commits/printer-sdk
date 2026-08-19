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

/**
 * Lets the user pick a real file (photo, PDF, or plain text) from disk and
 * prints it directly to Bluetooth thermal printers via TSPL/ESC-POS bitmap rasterization,
 * or to Windows Spooler for USB printers.
 */
export class FileTestPrintService {
  private btTransport = new BluetoothPrinterTransport();

  async pickAndPrint(
    kind: UploadPrintKind,
    queueName: string,
    parentWindow: BrowserWindow | null,
    macAddress?: string,
    comPort?: string,
    brand?: string
  ): Promise<UploadPrintResult> {
    if (!queueName) {
      return { success: false, message: 'No connected printer selected. Connect a Bluetooth printer first.' };
    }

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

    const filePath = pickResult.filePaths[0];
    const fileName = path.basename(filePath);

    try {
      // If queue is registered in Windows, use native Windows GDI spooler pipeline
      if (os.platform() === 'win32' && queueName) {
        if (kind === 'PDF') {
          return await this.printLocalFileUrl(filePath, queueName, fileName, true);
        }
        if (kind === 'IMAGE') {
          const html = this.buildImageHtml(this.toDataUri(filePath));
          return await this.printHtmlContent(html, queueName, fileName);
        }
        const text = fs.readFileSync(filePath, 'utf-8');
        const html = this.buildTextHtml(text);
        return await this.printHtmlContent(html, queueName, fileName);
      }

      // Fallback: Direct wireless raster transport (for direct wireless connections without Windows queue)
      if (macAddress || brand === 'JOSH') {
        logger.info(`[FileTestPrintService] Printing ${kind} "${fileName}" via Bluetooth wireless raster transport...`);
        return await this.printViaBluetooth(filePath, kind, queueName, fileName, macAddress, comPort, brand);
      }

      if (kind === 'PDF') {
        return await this.printLocalFileUrl(filePath, queueName, fileName, true);
      }
      if (kind === 'IMAGE') {
        const html = this.buildImageHtml(this.toDataUri(filePath));
        return await this.printHtmlContent(html, queueName, fileName);
      }
      const text = fs.readFileSync(filePath, 'utf-8');
      const html = this.buildTextHtml(text);
      return await this.printHtmlContent(html, queueName, fileName);
    } catch (err: any) {
      logger.error(`[FileTestPrintService] Error printing ${kind} file "${filePath}": ${err.message}`);
      return { success: false, message: `Could not print "${fileName}": ${err.message}`, fileName };
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
    brand?: string
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

  private buildImageHtml(dataUri: string): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>SEZNIK Test Print — Image</title>
  <style>
    @page { margin: 4mm; }
    html, body { margin: 0; padding: 0; height: 100%; display: flex; align-items: center; justify-content: center; background: #fff; }
    img { max-width: 100%; max-height: 100vh; object-fit: contain; }
  </style>
</head>
<body><img src="${dataUri}" /></body>
</html>`;
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

  private printHtmlContent(html: string, queueName: string, fileName: string): Promise<UploadPrintResult> {
    const tempHtmlPath = path.join(os.tmpdir(), `seznik_upload_print_${Date.now()}.html`);
    fs.writeFileSync(tempHtmlPath, html, 'utf-8');

    return new Promise((resolve) => {
      const printWin = new BrowserWindow({
        show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true },
      });

      printWin.loadFile(tempHtmlPath).then(() => {
        printWin.webContents.print(
          { silent: true, printBackground: true, deviceName: queueName, margins: { marginType: 'none' } },
          (success, failureReason) => {
            printWin.close();
            try { fs.unlinkSync(tempHtmlPath); } catch (e) {}
            if (success) {
              logger.info(`[FileTestPrintService] Printed "${fileName}" to "${queueName}" ✓`);
              resolve({ success: true, message: `"${fileName}" sent to "${queueName}" ✓ Check the physical printout.`, fileName });
            } else {
              logger.warn(`[FileTestPrintService] Print notice for "${fileName}": ${failureReason}`);
              resolve({ success: false, message: `Print failed: ${failureReason}`, fileName });
            }
          }
        );
      }).catch((err: any) => {
        try { printWin.close(); } catch (e) {}
        try { fs.unlinkSync(tempHtmlPath); } catch (e) {}
        resolve({ success: false, message: `Could not render "${fileName}": ${err.message}`, fileName });
      });
    });
  }

  /** Used for PDFs — loads the file directly so Chromium's built-in PDF viewer renders it, then prints that. */
  private printLocalFileUrl(filePath: string, queueName: string, fileName: string, isPdf: boolean): Promise<UploadPrintResult> {
    return new Promise((resolve) => {
      const printWin = new BrowserWindow({
        show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true, plugins: isPdf },
      });

      const fileUrl = 'file:///' + filePath.replace(/\\/g, '/');
      printWin.loadURL(fileUrl).then(() => {
        setTimeout(() => {
          printWin.webContents.print(
            { silent: true, printBackground: true, deviceName: queueName, margins: { marginType: 'none' } },
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
