import React, { useEffect, useState } from 'react';
import { Bluetooth, RefreshCw, X, CheckCircle2, AlertTriangle, Printer, Loader2, Image as ImageIcon, FileText, AlignLeft, Receipt, Info, Tag } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePrinterStore } from '../store/usePrinterStore';
import { UploadPrintKind, UploadPrintResult, V1PrinterProfileBrand } from '@shared/types';

interface ConnectBluetoothModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const UPLOAD_ACTIONS: { kind: UploadPrintKind; label: string; icon: React.ElementType }[] = [
  { kind: 'IMAGE', label: 'Upload Image', icon: ImageIcon },
  { kind: 'PDF', label: 'Upload PDF', icon: FileText },
  { kind: 'TEXT', label: 'Upload Text', icon: AlignLeft },
];

export const ConnectBluetoothModal: React.FC<ConnectBluetoothModalProps> = ({ isOpen, onClose }) => {
  const {
    bluetoothState,
    scanBluetoothDevices,
    connectBluetoothDevice,
    triggerBluetoothTestPrint,
    printBluetoothUploadFile,
    checkBluetoothConnection,
  } = usePrinterStore();

  const [uploadingKind, setUploadingKind] = useState<UploadPrintKind | null>(null);
  const [uploadResult, setUploadResult] = useState<UploadPrintResult | null>(null);
  const [isCheckingConnection, setIsCheckingConnection] = useState(false);
  // Per-device brand override — defaults to the name-based guess (device.likelyBrand)
  // but the user can correct it, since a Bluetooth device's advertised name (e.g.
  // "MPT-II") often doesn't say whether it's the JOSH label printer or a VEER receipt printer.
  const [brandOverrides, setBrandOverrides] = useState<Record<string, V1PrinterProfileBrand>>({});

  useEffect(() => {
    if (isOpen) {
      scanBluetoothDevices();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const isBusy = bluetoothState.step === 'SCANNING' || bluetoothState.step === 'CONNECTING' || bluetoothState.step === 'TEST_PRINTING';

  const resolveBrand = (deviceId: string, likelyBrand: V1PrinterProfileBrand): V1PrinterProfileBrand => {
    if (brandOverrides[deviceId]) return brandOverrides[deviceId];
    return likelyBrand !== 'UNSUPPORTED' ? likelyBrand : 'VEER';
  };

  const handleUpload = async (kind: UploadPrintKind) => {
    setUploadingKind(kind);
    setUploadResult(null);
    const res = await printBluetoothUploadFile(kind);
    setUploadResult(res);
    setUploadingKind(null);
  };

  const handleCheckConnection = async () => {
    setIsCheckingConnection(true);
    await checkBluetoothConnection();
    setIsCheckingConnection(false);
  };

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm select-none"
        onMouseDown={(e) => {
          // Click-outside-to-close — only when the mousedown started on the
          // backdrop itself, never when it bubbled up from inside the panel.
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className="w-full max-w-lg max-h-[88vh] bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden text-slate-800 flex flex-col"
        >
          {/* Header — stays pinned above the scrollable body, so it (and the close button) is always fully visible and clickable regardless of content height. */}
          <div className="flex items-start justify-between p-5 border-b border-slate-100 shrink-0">
            <div className="flex items-center space-x-3">
              <div className="p-2.5 rounded-xl bg-blue-50 text-blue-600 border border-blue-200">
                <Bluetooth className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-sm font-black text-slate-900 uppercase tracking-wide">Connect via Bluetooth</h2>
                <p className="text-[11px] text-slate-500 font-medium">Pick a Windows-paired printer to connect wirelessly</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body — the part that scrolls when content exceeds the modal's max height.
              `min-h-0` is required here: without it a flex child ignores the parent's
              max-height and keeps growing instead of triggering overflow-y-auto. */}
          <div className="p-5 space-y-4 overflow-y-auto flex-1 min-h-0">
            {/* Instructions */}
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-[11px] text-slate-600 font-medium leading-relaxed">
              Pair your printer in <strong className="text-slate-800">Windows Settings → Bluetooth & devices</strong> first if it isn't listed
              below. Connecting here installs it as a real <strong className="text-slate-800">Windows printer</strong> — it'll show up in
              any app's Print dialog (Ctrl+P), not just SEZNIK. Pick <strong className="text-slate-800">Receipt</strong> for a VEER 58mm printer
              or <strong className="text-slate-800">Label</strong> for a JOSH 50x50mm label/sticker printer before connecting — SEZNIK guesses
              from the device name, but correct it if it's wrong.
            </div>

            {/* Scan bar */}
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-600">{bluetoothState.stepMessage}</span>
              <button
                onClick={() => scanBluetoothDevices()}
                disabled={isBusy}
                className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-[11px] font-bold flex items-center gap-1 transition-all"
              >
                <RefreshCw className={`w-3 h-3 ${bluetoothState.step === 'SCANNING' ? 'animate-spin' : ''}`} />
                <span>Rescan</span>
              </button>
            </div>

            {/* Device list */}
            <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
              {bluetoothState.devices.length === 0 && bluetoothState.step !== 'SCANNING' && (
                <div className="p-6 text-center border border-dashed border-slate-300 rounded-lg bg-slate-50 space-y-1">
                  <Bluetooth className="w-6 h-6 text-slate-400 mx-auto" />
                  <p className="text-xs font-bold text-slate-600">No paired Bluetooth devices found.</p>
                  <p className="text-[11px] text-slate-400">Pair your printer in Windows Bluetooth settings, then rescan.</p>
                </div>
              )}

              {bluetoothState.devices.map((device) => {
                const isThisConnected = bluetoothState.connectedDeviceId === device.id && bluetoothState.step !== 'ERROR';
                const isThisConnecting = isBusy && bluetoothState.connectedDeviceId === device.id;
                const selectedBrand = isThisConnected ? (bluetoothState.connectedBrand || 'VEER') : resolveBrand(device.id, device.likelyBrand);

                return (
                  <div
                    key={device.id}
                    className={`p-3 rounded-xl border text-xs transition-all ${
                      isThisConnected ? 'bg-emerald-50/60 border-emerald-300' : 'bg-white border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center space-x-2.5 min-w-0">
                        <div className={`p-1.5 rounded-lg shrink-0 ${device.isLikelyPrinter ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-500'}`}>
                          <Printer className="w-3.5 h-3.5" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-extrabold text-slate-900 truncate">{device.name}</p>
                          <p className="text-[10px] text-slate-500 font-medium">
                            {device.comPort ? (
                              <span className="font-mono">{device.comPort}</span>
                            ) : (
                              <span className="text-amber-600 font-bold">No serial port bound</span>
                            )}
                            {device.isLikelyPrinter && <span className="ml-1.5 text-blue-600 font-bold">• Likely printer</span>}
                          </p>
                        </div>
                      </div>

                      {isThisConnected ? (
                        <div className="flex flex-col items-end gap-0.5 shrink-0">
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-black bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                            <CheckCircle2 className="w-3 h-3" /> READY
                          </span>
                          {bluetoothState.connectedQueueName && (
                            <span className="text-[9px] text-slate-400 font-mono truncate max-w-[140px]" title={bluetoothState.connectedQueueName}>
                              {bluetoothState.connectedQueueName}
                            </span>
                          )}
                        </div>
                      ) : (
                        <button
                          onClick={() => connectBluetoothDevice(device.id, selectedBrand)}
                          disabled={isBusy || !device.comPort}
                          className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[11px] font-bold shrink-0 flex items-center gap-1.5 transition-all"
                        >
                          {isThisConnecting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Bluetooth className="w-3 h-3" />}
                          <span>Connect</span>
                        </button>
                      )}
                    </div>

                    {/* Brand picker — corrects the name-based guess before connecting */}
                    <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center gap-2">
                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-wide">Printer Type:</span>
                      <div className="flex rounded-lg border border-slate-200 overflow-hidden">
                        <button
                          onClick={() => setBrandOverrides(prev => ({ ...prev, [device.id]: 'VEER' }))}
                          disabled={isThisConnected}
                          className={`px-2 py-1 text-[10px] font-bold flex items-center gap-1 transition-all ${
                            selectedBrand === 'VEER' ? 'bg-blue-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'
                          } disabled:cursor-not-allowed`}
                        >
                          <Receipt className="w-3 h-3" /> Receipt (VEER)
                        </button>
                        <button
                          onClick={() => setBrandOverrides(prev => ({ ...prev, [device.id]: 'JOSH' }))}
                          disabled={isThisConnected}
                          className={`px-2 py-1 text-[10px] font-bold flex items-center gap-1 border-l border-slate-200 transition-all ${
                            selectedBrand === 'JOSH' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'
                          } disabled:cursor-not-allowed`}
                        >
                          <Tag className="w-3 h-3" /> Label (JOSH)
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Test print real files — same GDI print pipeline any other app (or Ctrl+P) uses */}
            {bluetoothState.connectedQueueName && (
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-black text-slate-700 uppercase tracking-wide">Test Print a File</span>
                  <span className="text-[10px] text-slate-400 font-mono truncate max-w-[160px]" title={bluetoothState.connectedQueueName}>
                    → {bluetoothState.connectedQueueName}
                  </span>
                </div>

                {/* Real hardware reachability check — the actual answer to "is it really
                    connected right now," independent of what Windows Bluetooth settings shows. */}
                <button
                  onClick={handleCheckConnection}
                  disabled={isCheckingConnection}
                  className="w-full px-2.5 py-2 rounded-lg bg-white hover:bg-slate-100 disabled:opacity-60 text-slate-800 text-[11px] font-bold border border-slate-200 flex items-center justify-center gap-1.5 transition-all"
                >
                  {isCheckingConnection ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bluetooth className="w-3.5 h-3.5 text-blue-600" />}
                  <span>{isCheckingConnection ? 'Checking…' : 'Check Connection Right Now'}</span>
                </button>

                {bluetoothState.lastReachabilityCheck && (
                  <div className={`p-2.5 rounded-lg text-[11px] font-semibold flex items-start gap-2 ${
                    bluetoothState.lastReachabilityCheck.reachable ? 'bg-emerald-50 text-emerald-900 border border-emerald-200' : 'bg-amber-50 text-amber-900 border border-amber-200'
                  }`}>
                    {bluetoothState.lastReachabilityCheck.reachable ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" /> : <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
                    <span>{bluetoothState.lastReachabilityCheck.message}</span>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => triggerBluetoothTestPrint()}
                    disabled={isBusy || uploadingKind !== null}
                    className="px-2.5 py-2 rounded-lg bg-white hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed text-slate-800 text-[11px] font-bold border border-slate-200 flex items-center justify-center gap-1.5 transition-all"
                  >
                    {bluetoothState.step === 'TEST_PRINTING' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : bluetoothState.connectedBrand === 'JOSH' ? (
                      <Tag className="w-3.5 h-3.5 text-blue-600" />
                    ) : (
                      <Receipt className="w-3.5 h-3.5 text-blue-600" />
                    )}
                    <span>{bluetoothState.connectedBrand === 'JOSH' ? 'Test Label' : 'Test Receipt'}</span>
                  </button>

                  {UPLOAD_ACTIONS.map(({ kind, label, icon: Icon }) => (
                    <button
                      key={kind}
                      onClick={() => handleUpload(kind)}
                      disabled={isBusy || uploadingKind !== null}
                      className="px-2.5 py-2 rounded-lg bg-white hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed text-slate-800 text-[11px] font-bold border border-slate-200 flex items-center justify-center gap-1.5 transition-all"
                    >
                      {uploadingKind === kind ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5 text-blue-600" />}
                      <span>{label}</span>
                    </button>
                  ))}
                </div>

                {uploadResult && (
                  <div className={`p-2.5 rounded-lg text-[11px] font-semibold flex items-start gap-2 ${
                    uploadResult.success ? 'bg-emerald-50 text-emerald-900 border border-emerald-200' : 'bg-rose-50 text-rose-900 border border-rose-200'
                  }`}>
                    {uploadResult.success ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" /> : <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
                    <span>{uploadResult.message}</span>
                  </div>
                )}

                <div className="flex items-start gap-1.5 text-[10px] text-slate-400 font-medium leading-relaxed pt-0.5">
                  <Info className="w-3 h-3 shrink-0 mt-0.5" />
                  <span>
                    Windows Settings → Bluetooth & devices will keep showing this printer as <strong className="text-slate-500">"Not connected"</strong>,
                    and its LED only lights up mid-print — that's normal for this type of printer and doesn't mean anything is wrong. Windows'
                    Bluetooth panel doesn't actively connect serial-port printers the way it does headphones, so there's no "Connect" button there
                    to click either. Use the buttons above (or Ctrl+P in any app) to actually verify it — that's the real test.
                  </span>
                </div>
              </div>
            )}

            {/* Connection / test print result */}
            {(bluetoothState.step === 'CONNECTED' ||
              bluetoothState.step === 'TEST_PRINTING' ||
              bluetoothState.step === 'TEST_PRINT_SUCCESS' ||
              bluetoothState.step === 'TEST_PRINT_FAILED') && (
              <div
                className={`p-3 rounded-xl border text-xs font-semibold flex items-start gap-2.5 ${
                  bluetoothState.step === 'TEST_PRINT_SUCCESS'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : bluetoothState.step === 'TEST_PRINT_FAILED'
                    ? 'bg-rose-50 border-rose-200 text-rose-900'
                    : 'bg-blue-50 border-blue-200 text-blue-900'
                }`}
              >
                {bluetoothState.step === 'TEST_PRINTING' && <Loader2 className="w-4 h-4 shrink-0 animate-spin mt-0.5" />}
                {bluetoothState.step === 'TEST_PRINT_SUCCESS' && <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />}
                {bluetoothState.step === 'TEST_PRINT_FAILED' && <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
                {bluetoothState.step === 'CONNECTED' && <Bluetooth className="w-4 h-4 shrink-0 mt-0.5" />}
                <div className="flex-1">
                  <p>{bluetoothState.stepMessage}</p>
                  {bluetoothState.step === 'TEST_PRINT_FAILED' && (
                    <button
                      onClick={() => triggerBluetoothTestPrint()}
                      className="mt-2 px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold transition-all"
                    >
                      Retry Test Print
                    </button>
                  )}
                </div>
              </div>
            )}

            {bluetoothState.step === 'ERROR' && (
              <div className="p-3 rounded-xl border bg-rose-50 border-rose-200 text-rose-900 text-xs font-semibold flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{bluetoothState.stepMessage}</span>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
