import { dialog, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import os from 'os';
import logger from '../logger';

export type UploadPrintKind = 'IMAGE' | 'PDF' | 'TEXT';

export interface UploadPrintResult {
  success: boolean;
  message: string;
  fileName?: string;
}

/**
 * Lets the user pick a real file (photo, PDF, or plain text) from disk and
 * send it to an installed Windows printer queue through the exact same GDI
 * print pipeline Ctrl+P uses (BrowserWindow.webContents.print targeting the
 * queue by name). This is deliberately NOT a raw ESC/POS write — the point
 * is to prove the printer works the same way it will for any other app on
 * the system, not just SEZNIK's own byte-level test receipt.
 */
export class FileTestPrintService {
  async pickAndPrint(kind: UploadPrintKind, queueName: string, parentWindow: BrowserWindow | null): Promise<UploadPrintResult> {
    if (!queueName) {
      return { success: false, message: 'No connected printer selected. Connect a Bluetooth printer first.' };
    }
    if (os.platform() !== 'win32') {
      return { success: false, message: 'File printing is only supported on Windows.' };
    }

    const filters =
      kind === 'IMAGE'
        ? [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp'] }]
        : kind === 'PDF'
        ? [{ name: 'PDF Documents', extensions: ['pdf'] }]
        : [{ name: 'Text Files', extensions: ['txt', 'log', 'csv', 'md'] }];

    const dialogOpts: Electron.OpenDialogOptions = { title: `Select a ${kind.toLowerCase()} file to test print`, properties: ['openFile'], filters };
    const pickResult = parentWindow
      ? await dialog.showOpenDialog(parentWindow, dialogOpts)
      : await dialog.showOpenDialog(dialogOpts);

    if (pickResult.canceled || pickResult.filePaths.length === 0) {
      return { success: false, message: 'File selection cancelled.' };
    }

    const filePath = pickResult.filePaths[0];
    const fileName = path.basename(filePath);

    try {
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
        // Give the built-in PDF viewer a beat to finish laying out pages before printing.
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
