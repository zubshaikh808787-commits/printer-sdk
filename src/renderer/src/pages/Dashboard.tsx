import React, { useEffect, useState } from 'react';
import {
  Printer,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Usb,
  Bluetooth,
  FileText,
  Trash2,
  Info,
  Check,
  Loader2,
  Wifi,
  WifiOff,
  Star,
  ChevronRight,
  Zap,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePrinterStore } from '../store/usePrinterStore';
import { RemovePrinterModal } from '../components/RemovePrinterModal';
import { ConnectBluetoothModal } from '../components/ConnectBluetoothModal';
import { ConnectionType } from '@shared/types';
import { useTranslation } from '../locales/useTranslation';

// Maps v1 pipeline steps to user-friendly labels and icons
const USB_STEPS = [
  { key: 'detecting',  label: 'Detecting USB Printer',   steps: ['NO_USB_CONNECTED', 'USB_DETECTED'] },
  { key: 'driver',     label: 'Installing Driver',       steps: ['IDENTIFYING', 'PROFILE_MATCHED', 'CHECKING_DRIVER', 'INSTALLING_DRIVER', 'DRIVER_VERIFIED'] },
  { key: 'configuring',label: 'Configuring & Saving',   steps: ['CONFIGURING_PRINTER', 'SAVING_PRINTER', 'SETTING_DEFAULT'] },
  { key: 'done',       label: 'Test Print & Done',       steps: ['SETUP_COMPLETE'] },
];

function getUsbStepIndex(step: string): number {
  for (let i = 0; i < USB_STEPS.length; i++) {
    if (USB_STEPS[i].steps.includes(step)) return i;
  }
  return -1;
}

export const Dashboard: React.FC = () => {
  const { t } = useTranslation();

  const {
    v1State,
    osPrinters,
    savedPrinters,
    defaultPrinterId,
    initV1Orchestrator,
    startV1Pipeline,
    triggerV1TestPrint,
    fetchOsPrinters,
    fetchSavedPrinters,
    setSavedDefaultPrinter,
    isScanning,
    bluetoothState,
    initBluetooth,
    triggerBluetoothTestPrint,
    forgetBluetoothDevice,
  } = usePrinterStore();

  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isBluetoothModalOpen, setIsBluetoothModalOpen] = useState(false);
  const [isRemovingPrinter, setIsRemovingPrinter] = useState(false);
  const [removeModalState, setRemoveModalState] = useState<{
    isOpen: boolean;
    id: string;
    name: string;
    isDefault: boolean;
    connectionType: ConnectionType;
    rawDeviceId: string;
  }>({
    isOpen: false,
    id: '',
    name: '',
    isDefault: false,
    connectionType: 'USB',
    rawDeviceId: '',
  });

  useEffect(() => {
    initV1Orchestrator();
    initBluetooth();
    fetchOsPrinters();
    fetchSavedPrinters();
  }, [initV1Orchestrator, initBluetooth, fetchOsPrinters, fetchSavedPrinters]);

  const isUsbConnected = Boolean(v1State.usbConnected);
  const isSetupComplete = v1State.step === 'SETUP_COMPLETE';
  const isSetupError = v1State.step === 'ERROR';
  const isSetupRunning = !['NO_USB_CONNECTED', 'SETUP_COMPLETE', 'ERROR', 'UNSUPPORTED_PRINTER'].includes(v1State.step);
  const isBtConnected = Boolean(bluetoothState.connectedQueueName);
  const activeStepIndex = getUsbStepIndex(v1State.step);

  const handleRunTestPrint = async () => {
    const isJosh = v1State.brand === 'JOSH' || savedPrinters.some(p => p.printerType === 'LABEL');
    setStatusMessage(isJosh ? 'Printing test label...' : 'Printing test receipt...');
    const res = await triggerV1TestPrint();
    setStatusMessage(res?.success ? (isJosh ? 'Test label sent to printer ✓' : 'Test receipt sent to printer ✓') : (res?.message || 'Test print attempted.'));
    setTimeout(() => setStatusMessage(null), 4000);
  };

  const handleRunBtTestPrint = async () => {
    const isJosh = bluetoothState.connectedBrand === 'JOSH';
    setStatusMessage(isJosh ? 'Printing Bluetooth test label...' : 'Printing Bluetooth test receipt...');
    await triggerBluetoothTestPrint();
    setStatusMessage(isJosh ? 'Wireless test label sent ✓' : 'Wireless test receipt sent ✓');
    setTimeout(() => setStatusMessage(null), 4000);
  };

  const handleConfirmRemove = async () => {
    const { id: targetId, name: targetName, connectionType: targetConnType, rawDeviceId } = removeModalState;
    setRemoveModalState({ isOpen: false, id: '', name: '', isDefault: false, connectionType: 'USB', rawDeviceId: '' });
    if (!targetId) return;

    if (targetConnType === 'BLUETOOTH') {
      await forgetBluetoothDevice(rawDeviceId || targetId);
      setStatusMessage(`"${targetName}" removed ✓`);
      setTimeout(() => setStatusMessage(null), 3000);
      return;
    }

    try {
      setIsRemovingPrinter(true);
      await usePrinterStore.getState().removeSavedPrinter(targetId);
      if (window.seznikApi?.uninstallDriver && targetName) {
        await window.seznikApi.uninstallDriver(targetName);
      }
      await fetchSavedPrinters();
      await fetchOsPrinters();
      setStatusMessage(`"${targetName}" removed ✓`);
    } catch {
      setStatusMessage('Failed to remove printer.');
    } finally {
      setIsRemovingPrinter(false);
      setTimeout(() => setStatusMessage(null), 3000);
    }
  };

  return (
    <div className="space-y-5">
      {/* TOAST NOTIFICATION */}
      <AnimatePresence>
        {statusMessage && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="p-4 rounded-2xl bg-emerald-600 text-white font-black text-xs flex items-center justify-between shadow-lg shadow-emerald-600/20"
          >
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-5 h-5 shrink-0" />
              <span>{statusMessage}</span>
            </div>
            <button onClick={() => setStatusMessage(null)} className="text-xs bg-emerald-700 hover:bg-emerald-800 px-2.5 py-1 rounded-lg transition-colors">✕</button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ================================================================
          USB SETUP FLOW CARD — shows live pipeline steps
          ================================================================ */}
      <div className={`rounded-2xl border overflow-hidden transition-all ${
        isSetupComplete
          ? 'border-emerald-300 dark:border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/30'
          : isSetupError
          ? 'border-rose-300 dark:border-rose-500/40 bg-rose-50 dark:bg-rose-950/30'
          : isSetupRunning
          ? 'border-blue-300 dark:border-blue-500/40 bg-blue-50 dark:bg-blue-950/30'
          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
      }`}>
        {/* Header */}
        <div className="p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              isSetupComplete ? 'bg-emerald-500 text-white' :
              isSetupError ? 'bg-rose-500 text-white' :
              isSetupRunning ? 'bg-blue-500 text-white' :
              'bg-slate-100 dark:bg-slate-800 text-slate-400'
            }`}>
              {isSetupRunning ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : isSetupComplete ? (
                <CheckCircle2 className="w-5 h-5" />
              ) : isSetupError ? (
                <AlertCircle className="w-5 h-5" />
              ) : (
                <Usb className="w-5 h-5" />
              )}
            </div>
            <div>
              <h2 className="text-sm font-black text-slate-900 dark:text-white">USB Printer Setup</h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                {isUsbConnected ? `Connected: ${v1State.detectedHardwareName || 'USB Printer'}` : 'Connect USB cable to start automatic setup'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isSetupComplete && v1State.queueName && (
              <button
                onClick={handleRunTestPrint}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 transition-all"
              >
                <FileText className="w-3.5 h-3.5" />
                Test Print
              </button>
            )}
            <button
              onClick={() => startV1Pipeline()}
              disabled={isSetupRunning}
              className="px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 dark:hover:bg-slate-600 disabled:opacity-40 text-white font-bold text-xs flex items-center gap-1.5 transition-all"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSetupRunning ? 'animate-spin' : ''}`} />
              {isSetupRunning ? 'Running...' : 'Scan USB'}
            </button>
          </div>
        </div>

        {/* STEP PROGRESS — only show when USB is actually physically connected or actively setting up */}
        {(isUsbConnected && (isSetupComplete || isSetupRunning)) || isSetupError ? (
          <div className="px-5 pb-4">
            {/* 4-step progress bar */}
            <div className="flex items-center gap-1 mb-3">
              {USB_STEPS.map((s, idx) => {
                const isDone = isSetupComplete || activeStepIndex > idx;
                const isActive = activeStepIndex === idx && !isSetupComplete;
                const isFailed = isSetupError && activeStepIndex <= idx;
                return (
                  <React.Fragment key={s.key}>
                    <div className={`flex-1 h-1.5 rounded-full transition-all ${
                      isDone ? 'bg-emerald-500' :
                      isActive ? 'bg-blue-500 animate-pulse' :
                      isFailed ? 'bg-rose-400' :
                      'bg-slate-200 dark:bg-slate-700'
                    }`} />
                    {idx < USB_STEPS.length - 1 && (
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center text-[8px] font-black transition-all ${
                        isDone ? 'border-emerald-500 bg-emerald-500 text-white' :
                        isActive ? 'border-blue-500 bg-blue-500 text-white animate-pulse' :
                        'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-400'
                      }`}>
                        {isDone ? '✓' : idx + 1}
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>

            {/* Step labels */}
            <div className="flex items-start gap-1">
              {USB_STEPS.map((s, idx) => {
                const isDone = isSetupComplete || activeStepIndex > idx;
                const isActive = activeStepIndex === idx && !isSetupComplete;
                return (
                  <div key={s.key} className="flex-1 text-center">
                    <p className={`text-[9px] font-bold leading-tight ${
                      isDone ? 'text-emerald-600 dark:text-emerald-400' :
                      isActive ? 'text-blue-600 dark:text-blue-400' :
                      'text-slate-400 dark:text-slate-500'
                    }`}>{s.label}</p>
                  </div>
                );
              })}
            </div>

            {/* Live status message */}
            <div className={`mt-3 p-2.5 rounded-lg text-[11px] font-semibold ${
              isSetupComplete ? 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-300' :
              isSetupError ? 'bg-rose-100 dark:bg-rose-500/10 text-rose-800 dark:text-rose-300' :
              'bg-blue-100 dark:bg-blue-500/10 text-blue-800 dark:text-blue-300'
            }`}>
              {v1State.stepMessage}
            </div>
          </div>
        ) : (
          /* Not connected idle state */
          <div className="px-5 pb-5">
            <div className="p-4 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/30 text-center space-y-2">
              <Usb className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto" />
              <p className="text-xs font-bold text-slate-600 dark:text-slate-300">No USB printer detected</p>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">Connect your VEER 58mm printer via USB cable — setup will start automatically.</p>
            </div>
          </div>
        )}
      </div>

      {/* ================================================================
          BLUETOOTH SETUP CARD
          ================================================================ */}
      <div className={`p-5 rounded-2xl border transition-all ${
        isBtConnected
          ? 'border-indigo-300 dark:border-indigo-500/40 bg-indigo-50 dark:bg-indigo-950/30'
          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              isBtConnected
                ? 'bg-indigo-500 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-400'
            }`}>
              <Bluetooth className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-black text-slate-900 dark:text-white">Bluetooth Printer</h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                {isBtConnected
                  ? `${bluetoothState.connectedQueueName} — System Default ✓`
                  : 'Pair printer in Windows Bluetooth settings, then connect here'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isBtConnected && (
              <button
                onClick={handleRunBtTestPrint}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center gap-1.5 transition-all"
              >
                <FileText className="w-3.5 h-3.5" />
                Test Print
              </button>
            )}
            <button
              onClick={() => setIsBluetoothModalOpen(true)}
              className={`px-3 py-1.5 rounded-lg font-bold text-xs flex items-center gap-1.5 transition-all ${
                isBtConnected
                  ? 'bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-white hover:bg-slate-300 dark:hover:bg-slate-600'
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white'
              }`}
            >
              <Bluetooth className="w-3.5 h-3.5" />
              {isBtConnected ? 'Manage' : 'Connect Bluetooth'}
            </button>
          </div>
        </div>

        {isBtConnected && (
          <div className="mt-3 p-2.5 rounded-lg bg-indigo-100 dark:bg-indigo-500/10 text-[11px] font-semibold text-indigo-800 dark:text-indigo-300 flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            <span>Queue: <strong>{bluetoothState.connectedQueueName}</strong> on <strong>{bluetoothState.connectedComPort}</strong> — ready in Ctrl+P</span>
          </div>
        )}
      </div>

      {/* ================================================================
          CONFIGURED PRINTERS LIST
          ================================================================ */}
      <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4 transition-colors">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <Printer className="w-5 h-5 text-blue-600 dark:text-sky-400" />
            <h3 className="text-sm font-black text-slate-900 dark:text-white">Configured Printers</h3>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 dark:text-slate-400 font-semibold">
              {savedPrinters.length} printer{savedPrinters.length !== 1 ? 's' : ''}
            </span>
            <button
              onClick={async () => { await fetchOsPrinters(); await fetchSavedPrinters(); }}
              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
              title="Refresh list"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {savedPrinters.length > 0 ? (
          <div className="grid grid-cols-1 gap-2.5">
            {savedPrinters.map((prt: any) => {
              const prtId = prt.id || prt.name;
              const isDefault = prt.isDefault || defaultPrinterId === prtId;
              const isBt = prt.connectionType === 'BLUETOOTH';

              // Real physical connectivity check:
              // USB printer is connected ONLY when v1State.usbConnected is true
              // Bluetooth printer is connected ONLY when bluetoothState has active connected queue
              const isCurrentlyConnected = isBt
                ? (isBtConnected && bluetoothState.connectedQueueName === prt.name)
                : (isUsbConnected && (v1State.queueName === prt.name || isSetupComplete || prt.name.toLowerCase().includes('pos58')));

              return (
                <div
                  key={prtId}
                  className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
                    isCurrentlyConnected
                      ? 'border-emerald-200 dark:border-emerald-800/40 bg-emerald-50/40 dark:bg-emerald-950/20'
                      : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 opacity-80'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm shadow-xs ${
                      isCurrentlyConnected
                        ? (isBt ? 'bg-indigo-500 text-white' : 'bg-emerald-500 text-white')
                        : 'bg-slate-200 dark:bg-slate-700 text-slate-400'
                    }`}>
                      {isBt ? <Bluetooth className="w-4 h-4" /> : <Printer className="w-4 h-4" />}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-sm font-black text-slate-900 dark:text-white">{prt.name}</h4>
                        {isDefault && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-500/30 flex items-center gap-1">
                            <Check className="w-3 h-3 stroke-[3]" /> Default
                          </span>
                        )}
                        {isBt && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-500/30">
                            Bluetooth
                          </span>
                        )}
                        {isCurrentlyConnected ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> Connected
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span> Disconnected (Unplugged)
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                        Port: {prt.portName || 'USB001'} | {isCurrentlyConnected ? 'Ready for printing' : 'Connect cable to use'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-center">
                    {isCurrentlyConnected ? (
                      <button
                        onClick={isBt ? handleRunBtTestPrint : handleRunTestPrint}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-xs transition-all flex items-center gap-1.5"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        Test Print
                      </button>
                    ) : (
                      <button
                        disabled
                        className="px-3 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500 font-bold text-xs cursor-not-allowed flex items-center gap-1.5"
                        title="Connect printer via USB cable to enable test printing"
                      >
                        <Usb className="w-3.5 h-3.5" />
                        Unplugged
                      </button>
                    )}

                    {!isDefault && (
                      <button
                        onClick={() => setSavedDefaultPrinter(prtId)}
                        className="px-3 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-700 hover:bg-blue-600 hover:text-white text-slate-800 dark:text-slate-200 font-bold text-xs transition-all"
                      >
                        Set Default
                      </button>
                    )}

                    <button
                      onClick={() => setRemoveModalState({ isOpen: true, id: prtId, name: prt.name, isDefault, connectionType: prt.connectionType || 'USB', rawDeviceId: prt.macAddress || prtId })}
                      className="p-1.5 rounded-lg bg-rose-100 dark:bg-rose-900/30 hover:bg-rose-600 text-rose-700 hover:text-white transition-all"
                      title="Remove printer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-8 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50 dark:bg-slate-800/30 space-y-2">
            <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400 flex items-center justify-center mx-auto">
              <Printer className="w-5 h-5" />
            </div>
            <h4 className="text-sm font-black text-slate-800 dark:text-white">No printers connected yet</h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
              Connect your VEER USB printer or pair via Bluetooth — detection and setup will run automatically.
            </p>
          </div>
        )}
      </div>

      {/* CTRL+P TIP */}
      <div className="p-4 rounded-2xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-500/30 flex items-center gap-2 text-xs text-blue-800 dark:text-sky-300 font-bold">
        <Info className="w-4 h-4 text-blue-600 dark:text-sky-400 shrink-0" />
        <span>Once set up, your printer works in any app via Ctrl+P — not just SEZNIK.</span>
      </div>

      {/* MODALS */}
      <RemovePrinterModal
        isOpen={removeModalState.isOpen}
        printerName={removeModalState.name}
        isDefault={removeModalState.isDefault}
        onClose={() => setRemoveModalState({ isOpen: false, id: '', name: '', isDefault: false, connectionType: 'USB', rawDeviceId: '' })}
        onConfirm={handleConfirmRemove}
      />

      <ConnectBluetoothModal
        isOpen={isBluetoothModalOpen}
        onClose={() => setIsBluetoothModalOpen(false)}
      />
    </div>
  );
};

export default Dashboard;
