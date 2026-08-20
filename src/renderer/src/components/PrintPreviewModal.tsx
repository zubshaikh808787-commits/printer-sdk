import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ZoomIn, ZoomOut, Printer, Loader2, CheckCircle2, AlertTriangle, ScanLine, Move } from 'lucide-react';
import { usePrinterStore } from '../store/usePrinterStore';
import { UploadPrintKind, LabelPrintParams } from '@shared/types';
import { LABEL_SIZES, DEFAULT_LABEL_SIZE_ID, mmToPx, PRINTER_DPI } from '../utils/labelUtils';

interface PrintPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  kind: UploadPrintKind;
  fileData: {
    base64: string;
    mimeType: string;
    fileName: string;
    filePath: string;
  };
}

export const PrintPreviewModal: React.FC<PrintPreviewModalProps> = ({
  isOpen, onClose, kind, fileData,
}) => {
  const { printBluetoothFileWithParams } = usePrinterStore();

  const [selectedSizeId, setSelectedSizeId] = useState(DEFAULT_LABEL_SIZE_ID);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPrinting, setIsPrinting] = useState(false);
  const [printResult, setPrintResult] = useState<{ success: boolean; message: string } | null>(null);

  const isDragging = useRef(false);
  const dragStart = useRef({ mx: 0, my: 0, ox: 0, oy: 0 });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const selectedSize = LABEL_SIZES.find(s => s.id === selectedSizeId) || LABEL_SIZES[0];

  const MAX_PREVIEW_PX = 340;
  const previewScale = Math.min(
    MAX_PREVIEW_PX / mmToPx(selectedSize.widthMm, PRINTER_DPI),
    MAX_PREVIEW_PX / mmToPx(selectedSize.heightMm, PRINTER_DPI),
    1
  );
  const previewW = Math.round(mmToPx(selectedSize.widthMm, PRINTER_DPI) * previewScale);
  const previewH = Math.round(mmToPx(selectedSize.heightMm, PRINTER_DPI) * previewScale);

  const dataUri = kind === 'IMAGE' ? ('data:' + fileData.mimeType + ';base64,' + fileData.base64) : null;

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const img = imgRef.current;
    if (!img || !img.complete) return;

    if (selectedSize.twoUp) {
      const gapPx = Math.round(((selectedSize.twoUpGapMm || 3) / 25.4) * PRINTER_DPI * previewScale);
      const singleW = Math.round((previewW - gapPx) / 2);
      const scaledW = Math.round(singleW * scale);
      const scaledH = Math.round(previewH * scale);
      const ox = Math.round(offset.x * previewScale);
      const oy = Math.round(offset.y * previewScale);
      ctx.drawImage(img, ox, oy, scaledW, scaledH);
      ctx.drawImage(img, singleW + gapPx + ox, oy, scaledW, scaledH);
      ctx.fillStyle = 'rgba(100,116,139,0.3)';
      ctx.fillRect(singleW, 0, gapPx, previewH);
    } else {
      const scaledW = Math.round(previewW * scale);
      const scaledH = Math.round(previewH * scale);
      const ox = Math.round(offset.x * previewScale);
      const oy = Math.round(offset.y * previewScale);
      ctx.drawImage(img, ox, oy, scaledW, scaledH);
    }

    ctx.strokeStyle = '#3B82F6';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(0.75, 0.75, previewW - 1.5, previewH - 1.5);
  }, [selectedSize, scale, offset, previewW, previewH, previewScale]);

  useEffect(() => {
    if (kind !== 'IMAGE' || !dataUri) return;
    const img = new Image();
    img.onload = () => { imgRef.current = img; drawCanvas(); };
    img.src = dataUri;
  }, [dataUri, kind]);

  useEffect(() => { drawCanvas(); }, [drawCanvas]);

  useEffect(() => {
    if (isOpen) {
      setSelectedSizeId(DEFAULT_LABEL_SIZE_ID);
      setScale(1);
      setOffset({ x: 0, y: 0 });
      setPrintResult(null);
    }
  }, [isOpen]);

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    isDragging.current = true;
    dragStart.current = { mx: e.clientX, my: e.clientY, ox: offset.x, oy: offset.y };
  };
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging.current) return;
    const dx = (e.clientX - dragStart.current.mx) / previewScale;
    const dy = (e.clientY - dragStart.current.my) / previewScale;
    setOffset({ x: dragStart.current.ox + dx, y: dragStart.current.oy + dy });
  };
  const handleMouseUp = () => { isDragging.current = false; };

  const handlePrint = async () => {
    setIsPrinting(true);
    setPrintResult(null);
    const params: LabelPrintParams = {
      filePath: fileData.filePath,
      labelSizeId: selectedSizeId,
      scale,
      offsetX: offset.x,
      offsetY: offset.y,
    };
    const res = await printBluetoothFileWithParams(kind, params);
    setIsPrinting(false);
    setPrintResult(res);
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm select-none"
        onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className="w-full max-w-2xl max-h-[92vh] bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden flex flex-col text-slate-800"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-blue-50 text-blue-600 border border-blue-200">
                <ScanLine className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-black text-slate-900 uppercase tracking-wide">Preview &amp; Label Size</h2>
                <p className="text-[11px] text-slate-500 font-medium truncate max-w-[320px]">{fileData.fileName}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors shrink-0">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* Left: Canvas preview */}
            <div className="flex-1 flex flex-col items-center justify-center bg-slate-100 p-4 gap-3 min-w-0">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                Preview &mdash; {selectedSize.label}
              </p>
              <div
                className="relative rounded-lg shadow-inner overflow-hidden border border-slate-300"
                style={{ width: previewW, height: previewH, background: '#f8fafc' }}
              >
                {kind === 'IMAGE' ? (
                  <canvas
                    ref={canvasRef}
                    width={previewW}
                    height={previewH}
                    className="cursor-grab active:cursor-grabbing"
                    style={{ display: 'block', touchAction: 'none' }}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-slate-400">
                    <div className="text-3xl">&#x1F4C4;</div>
                    <p className="text-[11px] font-bold text-center px-2 text-slate-500">
                      PDF Preview<br />
                      <span className="font-normal text-[10px]">Actual print uses Chromium PDF renderer</span>
                    </p>
                  </div>
                )}
              </div>

              {kind === 'IMAGE' && (
                <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                  <Move className="w-3 h-3" />
                  <span>Drag canvas to reposition image</span>
                </div>
              )}

              {/* Zoom slider */}
              <div className="flex items-center gap-2 w-full max-w-[200px]">
                <button
                  onClick={() => setScale(s => Math.max(0.2, parseFloat((s - 0.1).toFixed(1))))}
                  className="p-1 rounded-lg hover:bg-slate-200 text-slate-600 transition-colors"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <div className="flex-1">
                  <input
                    type="range"
                    min={20} max={200} step={5}
                    value={Math.round(scale * 100)}
                    onChange={e => { setScale(parseInt(e.target.value) / 100); setOffset({ x: 0, y: 0 }); }}
                    className="w-full h-1 rounded-full appearance-none bg-slate-300 accent-blue-600 cursor-pointer"
                  />
                </div>
                <button
                  onClick={() => setScale(s => Math.min(2, parseFloat((s + 0.1).toFixed(1))))}
                  className="p-1 rounded-lg hover:bg-slate-200 text-slate-600 transition-colors"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
                <span className="text-[10px] font-mono text-slate-500 w-8 text-right">{Math.round(scale * 100)}%</span>
              </div>
            </div>

            {/* Right: Label size selector + Print button */}
            <div className="w-56 shrink-0 flex flex-col border-l border-slate-100 overflow-y-auto">
              <div className="p-4 space-y-4 flex-1">
                <div>
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-wide mb-2">Label Size</p>
                  <div className="space-y-1.5">
                    {LABEL_SIZES.map(size => (
                      <button
                        key={size.id}
                        onClick={() => { setSelectedSizeId(size.id); setOffset({ x: 0, y: 0 }); setScale(1); }}
                        className={
                          'w-full text-left px-3 py-2.5 rounded-xl border text-[11px] font-bold transition-all ' +
                          (selectedSizeId === size.id
                            ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                            : 'bg-white text-slate-700 border-slate-200 hover:border-blue-300 hover:bg-blue-50')
                        }
                      >
                        <span className="block">{size.label}</span>
                        <span className={'text-[9px] font-normal ' + (selectedSizeId === size.id ? 'text-blue-100' : 'text-slate-400')}>
                          {size.widthMm}mm x {size.heightMm}mm{size.twoUp ? (' (+' + size.twoUpGapMm + 'mm gap)') : ''}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Print area */}
              <div className="p-4 border-t border-slate-100 space-y-2 shrink-0">
                {printResult && (
                  <div className={
                    'p-2.5 rounded-lg text-[11px] font-semibold flex items-start gap-1.5 ' +
                    (printResult.success
                      ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                      : 'bg-rose-50 text-rose-900 border border-rose-200')
                  }>
                    {printResult.success
                      ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      : <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
                    <span className="leading-tight">{printResult.message}</span>
                  </div>
                )}
                <button
                  onClick={handlePrint}
                  disabled={isPrinting}
                  className="w-full px-4 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-[12px] font-black flex items-center justify-center gap-2 transition-all shadow-sm"
                >
                  {isPrinting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
                  {isPrinting ? 'Printing...' : 'Print'}
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};