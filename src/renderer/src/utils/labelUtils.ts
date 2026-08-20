/**
 * labelUtils.ts
 * Single source of truth for label-size definitions and mm→pixel conversion.
 * Used by both the PrintPreviewModal (canvas sizing) and FileTestPrintService
 * (raster payload dimensions).
 */

/** Convert millimetres to pixels at a given DPI. */
export function mmToPx(mm: number, dpi: number): number {
  return Math.round((mm / 25.4) * dpi);
}

export interface LabelSize {
  id: string;
  label: string;
  widthMm: number;
  heightMm: number;
  /** For "two-up": true = render the image twice side-by-side with a gap */
  twoUp?: boolean;
  twoUpGapMm?: number;
}

/**
 * Fixed presets available in the label size selector.
 * The printer DPI used throughout the codebase is 203 dpi.
 */
export const LABEL_SIZES: LabelSize[] = [
  { id: '50x50',     label: '50mm x 50mm',       widthMm: 50,  heightMm: 50  },
  { id: '50x25',     label: '50mm x 25mm',       widthMm: 50,  heightMm: 25  },
  { id: '50x15',     label: '50mm x 15mm',       widthMm: 50,  heightMm: 15  },
  { id: 'two-up',    label: 'Two-up (2 x 50mm)', widthMm: 103, heightMm: 50, twoUp: true, twoUpGapMm: 3 },
  { id: 'jewellery', label: 'Jewellery (30x10mm)', widthMm: 30, heightMm: 10 },
];

export const DEFAULT_LABEL_SIZE_ID = '50x50';
export const PRINTER_DPI = 203;
