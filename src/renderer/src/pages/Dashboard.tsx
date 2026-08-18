import React, { useEffect, useState } from 'react';
import {
  Printer,
  CheckCircle2,
  RefreshCw,
  Usb,
  Bluetooth,
  FileText,
  Trash2,
  Info,
  Check,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePrinterStore } from '../store/usePrinterStore';
import { RemovePrinterModal } from '../components/RemovePrinterModal';
import { ConnectBluetoothModal } from '../components/ConnectBluetoothModal';
import { ConnectionType } from '@shared/types';
import { useTranslation } from '../locales/useTranslation';
import { useTheme } from '../context/ThemeContext';

export const Dashboard: React.FC = () => {
  const { t } = useTranslation();
  const { isDark } = useTheme();

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
    disconnectBluetoothDevice,
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
  const isUsbMatched = isUsbConnected && Boolean(v1State.brand) && v1State.brand !== 'UNSUPPORTED';
  const isBtConnected = Boolean(bluetoothState.connectedQueueName || bluetoothState.connectedDeviceId);

  const activePrinterName =
    v1State.queueName ||
    (isUsbConnected ? `${v1State.brand} USB Printer` : null) ||
    (osPrinters.length > 0 ? osPrinters[0].name : null);

  const handleRunTestPrint = async () => {
    setStatusMessage(t.dashboard.printing || 'Printing test page...');
    const res = await triggerV1TestPrint();
    setStatusMessage(res?.message || t.guide.step4Desc || 'Test page sent to printer! ✓');
    setTimeout(() => setStatusMessage(null), 4000);
  };

  const handleRunBtTestPrint = async () => {
    setStatusMessage(t.dashboard.printing || 'Printing wireless Bluetooth receipt...');
    await triggerBluetoothTestPrint();
    setStatusMessage(t.guide.stepB5Desc || 'Wireless test receipt printed successfully! ✓');
    setTimeout(() => setStatusMessage(null), 4000);
  };

  const handleConfirmRemove = async () => {
    const { id: targetId, name: targetName, connectionType: targetConnType, rawDeviceId } = removeModalState;
    setRemoveModalState({ isOpen: false, id: '', name: '', isDefault: false, connectionType: 'USB', rawDeviceId: '' });

    if (!targetId) return;

    if (targetConnType === 'BLUETOOTH') {
      await forgetBluetoothDevice(rawDeviceId || targetId);
      setStatusMessage(`${t.dashboard.savedPrinters}: "${targetName}" removed ✓`);
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
      setStatusMessage(`${t.dashboard.savedPrinters}: "${targetName}" removed ✓`);
    } catch {
      setStatusMessage(`Failed to remove printer.`);
    } finally {
      setIsRemovingPrinter(false);
      setTimeout(() => setStatusMessage(null), 3000);
    }
  };

  return (
    <div className="space-y-6">
      {/* ACTION STATUS TOAST NOTIFICATION */}
      <AnimatePresence>
        {statusMessage && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="p-4 rounded-2xl bg-emerald-600 text-white font-black text-xs md:text-sm flex items-center justify-between shadow-lg shadow-emerald-600/20"
          >
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-5 h-5 shrink-0" />
              <span>{statusMessage}</span>
            </div>
            <button
              onClick={() => setStatusMessage(null)}
              className="text-xs bg-emerald-700 hover:bg-emerald-800 px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
            >
              ✕
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* TOP BIG PROMINENT ACTION BAR (FOR NON-TECHNICAL USERS) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* ACTION 1: PRINT TEST PAGE */}
        <button
          onClick={handleRunTestPrint}
          className="p-5 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-600/20 transition-all flex flex-col justify-between gap-3 text-left cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
              <FileText className="w-5 h-5 text-white" />
            </div>
            <span className="text-[11px] font-extrabold uppercase bg-white/20 px-2 py-0.5 rounded-full">
              {t.dashboard.actions}
            </span>
          </div>
          <div>
            <h3 className="text-base font-black tracking-tight">{t.dashboard.testPrint}</h3>
            <p className="text-xs text-emerald-100 font-medium mt-0.5">
              {t.guide.step4Desc}
            </p>
          </div>
        </button>

        {/* ACTION 2: SCAN USB PRINTER */}
        <button
          onClick={() => startV1Pipeline()}
          disabled={isScanning}
          className="p-5 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-600/20 transition-all flex flex-col justify-between gap-3 text-left cursor-pointer disabled:opacity-50 group"
        >
          <div className="flex items-center justify-between">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
              <RefreshCw className={`w-5 h-5 text-white ${isScanning ? 'animate-spin' : ''}`} />
            </div>
            <span className="text-[11px] font-extrabold uppercase bg-white/20 px-2 py-0.5 rounded-full">
              {isScanning ? t.dashboard.scanning : t.dashboard.reScanUsb}
            </span>
          </div>
          <div>
            <h3 className="text-base font-black tracking-tight">{t.dashboard.reScanUsb}</h3>
            <p className="text-xs text-blue-100 font-medium mt-0.5">
              {t.dashboard.scanPrinters}
            </p>
          </div>
        </button>

        {/* ACTION 3: PAIR BLUETOOTH (VEER) */}
        <button
          onClick={() => setIsBluetoothModalOpen(true)}
          className="p-5 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/20 transition-all flex flex-col justify-between gap-3 text-left cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
              <Bluetooth className="w-5 h-5 text-white" />
            </div>
            <span className="text-[11px] font-extrabold uppercase bg-white/20 px-2 py-0.5 rounded-full">
              {t.guide.sectionBTitle}
            </span>
          </div>
          <div>
            <h3 className="text-base font-black tracking-tight">{t.dashboard.connectBluetooth}</h3>
            <p className="text-xs text-indigo-100 font-medium mt-0.5">
              {t.guide.stepB4Desc}
            </p>
          </div>
        </button>

        {/* ACTION 4: REFRESH ALL */}
        <button
          onClick={async () => {
            await fetchOsPrinters();
            await fetchSavedPrinters();
            setStatusMessage('Refreshed printer list ✓');
            setTimeout(() => setStatusMessage(null), 2500);
          }}
          className="p-5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-white shadow-md transition-all flex flex-col justify-between gap-3 text-left cursor-pointer border border-slate-700 group"
        >
          <div className="flex items-center justify-between">
            <div className="w-10 h-10 rounded-xl bg-slate-700 flex items-center justify-center">
              <RefreshCw className="w-5 h-5 text-sky-400" />
            </div>
            <span className="text-[11px] font-extrabold uppercase bg-slate-700 px-2 py-0.5 rounded-full text-slate-300">
              {t.nav.system}
            </span>
          </div>
          <div>
            <h3 className="text-base font-black tracking-tight">Refresh</h3>
            <p className="text-xs text-slate-400 font-medium mt-0.5">
              Reload all printer status
            </p>
          </div>
        </button>
      </div>

      {/* AT-A-GLANCE PRINTER STATUS CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* USB PRINTER STATUS CARD */}
        <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs transition-colors space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                isUsbConnected
                  ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-400'
              }`}>
                <Usb className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-black text-slate-900 dark:text-white">
                  {t.nav.usbConnected}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                  {t.guide.sectionATitle}
                </p>
              </div>
            </div>

            <span className={`px-3 py-1 rounded-full text-xs font-black uppercase flex items-center gap-1.5 ${
              isUsbConnected
                ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
            }`}>
              <span className={`w-2 h-2 rounded-full ${isUsbConnected ? 'bg-emerald-500' : 'bg-slate-400'}`} />
              <span>{isUsbConnected ? t.guide.usbStatusConnected : t.dashboard.disconnected}</span>
            </span>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700/60 flex items-center justify-between text-xs">
            <div>
              <span className="text-slate-400 font-bold">{t.dashboard.autoHardwareBrand}: </span>
              <strong className="text-slate-800 dark:text-white font-extrabold">
                {isUsbConnected ? v1State.brand : t.dashboard.none}
              </strong>
            </div>
            <div>
              <span className="text-slate-400 font-bold">{t.dashboard.spoolerQueue}: </span>
              <span className="font-mono text-slate-700 dark:text-slate-300 font-bold">
                {v1State.queueName || t.dashboard.defaultBadge}
              </span>
            </div>
          </div>
        </div>

        {/* BLUETOOTH WIRELESS STATUS CARD (VEER) */}
        <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs transition-colors space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                isBtConnected
                  ? 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-400'
              }`}>
                <Bluetooth className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-black text-slate-900 dark:text-white">
                  {t.guide.sectionBTitle}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                  {t.guide.sectionBSubtitle}
                </p>
              </div>
            </div>

            <span className={`px-3 py-1 rounded-full text-xs font-black uppercase flex items-center gap-1.5 ${
              isBtConnected
                ? 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-500/30'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
            }`}>
              <span className={`w-2 h-2 rounded-full ${isBtConnected ? 'bg-indigo-500' : 'bg-slate-400'}`} />
              <span>{isBtConnected ? t.dashboard.installedInWindows : t.dashboard.disconnected}</span>
            </span>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700/60 flex items-center justify-between text-xs">
            <div>
              <span className="text-slate-400 font-bold">{t.dashboard.spoolerQueue}: </span>
              <strong className="text-slate-800 dark:text-white font-extrabold">
                {bluetoothState.connectedQueueName || 'VEER Bluetooth'}
              </strong>
            </div>
            {isBtConnected && (
              <button
                onClick={handleRunBtTestPrint}
                className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[11px] transition-all cursor-pointer"
              >
                {t.dashboard.testPrint}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ALL CONFIGURED PRINTERS LIST */}
      <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4 transition-colors">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <Printer className="w-5 h-5 text-blue-600 dark:text-sky-400" />
            <h3 className="text-sm md:text-base font-black text-slate-900 dark:text-white">
              {t.dashboard.allConfiguredPrinters}
            </h3>
          </div>

          <span className="text-xs text-slate-500 dark:text-slate-400 font-semibold">
            {savedPrinters.length || osPrinters.length} {t.dashboard.activePrinters}
          </span>
        </div>

        {/* PRINTERS LIST */}
        {savedPrinters.length > 0 || osPrinters.length > 0 ? (
          <div className="grid grid-cols-1 gap-2.5">
            {(savedPrinters.length > 0 ? savedPrinters : osPrinters).map((prt: any) => {
              const prtId = prt.id || prt.name;
              const isDefault = prt.isDefault || defaultPrinterId === prtId;

              return (
                <div
                  key={prtId}
                  className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center justify-center font-bold text-sm shadow-xs">
                      <Printer className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-black text-slate-900 dark:text-white">{prt.name}</h4>
                        {isDefault && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-500/30 flex items-center gap-1">
                            <Check className="w-3 h-3 stroke-[3]" /> {t.dashboard.defaultBadge}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                        {t.dashboard.portInterface}: {prt.portName || 'USB001'} | {t.dashboard.status}: {t.dashboard.ready}
                      </p>
                    </div>
                  </div>

                  {/* ACTION CONTROLS */}
                  <div className="flex items-center gap-2 self-end sm:self-center">
                    <button
                      onClick={handleRunTestPrint}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>{t.dashboard.testPrint}</span>
                    </button>

                    {!isDefault && (
                      <button
                        onClick={() => setSavedDefaultPrinter(prtId)}
                        className="px-3 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-700 hover:bg-blue-600 hover:text-white text-slate-800 dark:text-slate-200 font-bold text-xs transition-all cursor-pointer"
                      >
                        {t.dashboard.setDefault}
                      </button>
                    )}

                    <button
                      onClick={() =>
                        setRemoveModalState({
                          isOpen: true,
                          id: prtId,
                          name: prt.name,
                          isDefault,
                          connectionType: prt.connectionType || 'USB',
                          rawDeviceId: prt.macAddress || prtId,
                        })
                      }
                      className="p-1.5 rounded-lg bg-rose-100 dark:bg-rose-900/30 hover:bg-rose-600 text-rose-700 hover:text-white transition-all cursor-pointer"
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
            <h4 className="text-sm font-black text-slate-800 dark:text-white">{t.dashboard.noPrintersConfigured}</h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
              {t.dashboard.noPrintersDesc}
            </p>
          </div>
        )}
      </div>

      {/* FOOTER SHORTCUT REMINDER */}
      <div className="p-4 rounded-2xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-500/30 flex items-center gap-2 text-xs text-blue-800 dark:text-sky-300 font-bold">
        <Info className="w-4 h-4 text-blue-600 dark:text-sky-400 shrink-0" />
        <span>{t.guide.ctrlPNote}</span>
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
