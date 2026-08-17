import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Usb,
  Bluetooth,
  CheckCircle2,
  ArrowRight,
  RefreshCw,
  Globe,
  Check,
  ChevronDown,
  Printer,
  FileText,
  Power,
  Sun,
  Moon,
  Info,
  ExternalLink,
  ShieldCheck,
  Sparkles,
  Cable,
  CheckCheck,
} from 'lucide-react';
import { usePrinterStore } from '../store/usePrinterStore';
import { useTranslation, languages, LanguageCode } from '../locales/useTranslation';
import { useTheme } from '../context/ThemeContext';
import { Ripple } from '../components/Ripple';

export interface SetupConnectionGuideProps {
  onComplete?: () => void;
  onOpenDashboard?: () => void;
}

export const SetupConnectionGuide: React.FC<SetupConnectionGuideProps> = ({
  onComplete,
  onOpenDashboard,
}) => {
  const { t, language, setLanguage, currentLanguageInfo } = useTranslation();
  const { isDark, toggleTheme } = useTheme();
  const {
    v1State,
    startV1Pipeline,
    triggerV1TestPrint,
    bluetoothState,
    initBluetooth,
    connectBluetoothDevice,
    triggerBluetoothTestPrint,
    isScanning,
  } = usePrinterStore();

  const [isLangDropdownOpen, setIsLangDropdownOpen] = useState(false);
  const [testPrintFeedback, setTestPrintFeedback] = useState<string | null>(null);
  const [btFeedback, setBtFeedback] = useState<string | null>(null);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  // USB Real-time Connection State
  const isUsbConnected = Boolean(v1State.usbConnected);
  const isUsbMatched = isUsbConnected && Boolean(v1State.brand) && v1State.brand !== 'UNSUPPORTED';
  const isDriverReady =
    Boolean(v1State.driverInstalled) ||
    Boolean(v1State.queueName) ||
    v1State.step === 'DRIVER_VERIFIED' ||
    v1State.step === 'CONFIGURING_PRINTER' ||
    v1State.step === 'SETUP_COMPLETE';

  useEffect(() => {
    initBluetooth();
  }, [initBluetooth]);

  const handleRunUsbTestPrint = async () => {
    setTestPrintFeedback(t.dashboard.printing || 'Printing test page...');
    const res = await triggerV1TestPrint();
    setTestPrintFeedback(res?.message || t.guide.step4Desc || 'Test page printed! ✓');
    setTimeout(() => setTestPrintFeedback(null), 4000);
  };

  const handleRunBtTestPrint = async () => {
    setBtFeedback(t.dashboard.printing || 'Printing test receipt...');
    await triggerBluetoothTestPrint();
    setBtFeedback(t.guide.stepB5Desc || 'Receipt printed! ✓');
    setTimeout(() => setBtFeedback(null), 4000);
  };

  const handleOpenWindowsBt = () => {
    try {
      window.open('ms-settings:bluetooth', '_blank');
    } catch {
      // Fallback
    }
  };

  const handleFinishGuide = () => {
    if (dontShowAgain) {
      localStorage.setItem('seznik_initial_guide_dismissed_permanent', 'true');
    }
    sessionStorage.setItem('seznik_initial_guide_dismissed', 'true');
    if (onComplete) onComplete();
    if (onOpenDashboard) onOpenDashboard();
  };

  return (
    <div className="relative w-full h-full min-h-screen bg-slate-50 dark:bg-[#070D1E] text-slate-900 dark:text-white flex flex-col overflow-y-auto transition-colors duration-300">
      {/* TOP HEADER */}
      <header className="sticky top-0 z-40 bg-white/95 dark:bg-[#0B132B]/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-4 md:px-8 py-3 flex items-center justify-between shadow-xs transition-colors">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-blue-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
            <Printer className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-sm md:text-base font-black tracking-tight text-slate-900 dark:text-white">
              {t.guide.title}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium hidden sm:block">
              {t.guide.subtitle}
            </p>
          </div>
        </div>

        {/* RIGHT CONTROLS: THEME & LANGUAGE */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={toggleTheme}
            className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-all cursor-pointer shadow-xs"
            title={isDark ? 'Light Mode' : 'Dark Mode'}
            aria-label="Toggle Theme"
          >
            {isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-600" />}
          </button>

          {/* Language Selector Dropdown */}
          <div className="relative">
            <button
              onClick={() => setIsLangDropdownOpen(!isLangDropdownOpen)}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-white border border-slate-200 dark:border-slate-700 text-xs font-black shadow-xs transition-all cursor-pointer"
            >
              <Globe className="w-4 h-4 text-blue-600 dark:text-sky-400" />
              <span className="font-bold">{currentLanguageInfo.nativeName}</span>
              <ChevronDown className={`w-3.5 h-3.5 text-slate-500 transition-transform ${isLangDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            <AnimatePresence>
              {isLangDropdownOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.96 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 mt-2 w-64 max-h-80 overflow-y-auto rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl p-2 z-50 space-y-1"
                >
                  <div className="px-3 py-1.5 text-[10px] font-extrabold uppercase text-slate-400 tracking-wider border-b border-slate-100 dark:border-slate-800">
                    Select Language / भाषा चुनें
                  </div>
                  {languages.map((l) => {
                    const isSelected = language === l.code;
                    return (
                      <button
                        key={l.code}
                        onClick={() => {
                          setLanguage(l.code);
                          setIsLangDropdownOpen(false);
                        }}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-left text-xs font-bold transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-blue-600 text-white shadow-xs'
                            : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        <div className="flex flex-col">
                          <span className="font-extrabold">{l.nativeName}</span>
                          <span className={`text-[10px] ${isSelected ? 'text-blue-100' : 'text-slate-400'}`}>
                            {l.label}
                          </span>
                        </div>
                        {isSelected && <Check className="w-4 h-4 text-white shrink-0" />}
                      </button>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>

      {/* MAIN EASY VISUAL ONBOARDING CONTENT */}
      <main className="flex-1 max-w-4xl w-full mx-auto p-4 md:p-8 space-y-6">
        {/* HERO RADAR LIVE DETECTION CARD */}
        <div className="relative rounded-3xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 md:p-8 shadow-sm transition-colors">
          <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="space-y-3 text-center md:text-left">
              <div className={`inline-flex items-center gap-2 px-3.5 py-1 rounded-full text-xs font-extrabold uppercase tracking-wide border ${
                isUsbConnected
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30'
                  : 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/30'
              }`}>
                <span className={`w-2.5 h-2.5 rounded-full ${isUsbConnected ? 'bg-emerald-500' : 'bg-blue-500 animate-ping'}`} />
                <span>{isUsbConnected ? t.guide.usbStatusConnected : t.guide.usbStatusWaiting}</span>
              </div>

              <h2 className="text-2xl md:text-3xl font-black text-slate-900 dark:text-white tracking-tight">
                {isUsbMatched
                  ? `${v1State.brand} ${t.guide.usbStatusConnected} ✓`
                  : t.guide.usbStatusWaiting}
              </h2>

              <p className="text-xs md:text-sm text-slate-600 dark:text-slate-300 max-w-md font-medium leading-relaxed">
                {isUsbMatched
                  ? t.guide.step4Desc
                  : t.guide.step2Desc}
              </p>

              {/* ACTION BUTTONS */}
              <div className="pt-2 flex flex-wrap items-center justify-center md:justify-start gap-3">
                {isUsbConnected && (
                  <button
                    onClick={handleRunUsbTestPrint}
                    className="px-5 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-sm shadow-md shadow-emerald-600/20 transition-all flex items-center gap-2 cursor-pointer"
                  >
                    <FileText className="w-5 h-5" />
                    <span>{t.dashboard.testPrint}</span>
                  </button>
                )}

                <button
                  onClick={handleFinishGuide}
                  className="px-5 py-3 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-black text-sm shadow-md shadow-blue-600/20 transition-all flex items-center gap-2 cursor-pointer"
                >
                  <span>{t.guide.openDashboardBtn}</span>
                  <ArrowRight className="w-5 h-5" />
                </button>
              </div>

              {testPrintFeedback && (
                <p className="text-xs font-bold text-emerald-600 dark:text-emerald-300 animate-pulse pt-1">
                  {testPrintFeedback}
                </p>
              )}
            </div>

            {/* MagicUI Ripple Radar Visual Anchor */}
            <div className="relative w-36 h-36 md:w-44 md:h-44 shrink-0 flex items-center justify-center">
              <Ripple
                numCircles={4}
                mainCircleSize={75}
                variant={isUsbMatched ? 'matched' : isUsbConnected ? 'unmatched' : 'idle'}
                duration={1.8}
                rippleColor={isDark ? undefined : isUsbMatched ? '#16A34A' : isUsbConnected ? '#DC2626' : '#0284C7'}
              />
              <div
                className={`relative z-10 w-16 h-16 md:w-20 md:h-20 rounded-2xl flex items-center justify-center shadow-lg border transition-all duration-500 ${
                  isUsbMatched
                    ? 'bg-emerald-600 border-emerald-400 text-white shadow-emerald-500/30'
                    : isUsbConnected
                    ? 'bg-rose-600 border-rose-400 text-white shadow-rose-500/30'
                    : 'bg-blue-600 border-blue-400 text-white shadow-blue-500/30'
                }`}
              >
                <Usb className="w-8 h-8 md:w-10 md:h-10 drop-shadow" />
              </div>
            </div>
          </div>
        </div>

        {/* 3 SIMPLE PICTORIAL STEP CARDS (EASY FOR ANY USER) */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-blue-600 dark:text-sky-400" />
            <h3 className="text-base md:text-lg font-black text-slate-900 dark:text-white">
              {t.guide.sectionATitle}
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
            {/* STEP 1: POWER */}
            <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3 shadow-xs">
              <div className="w-12 h-12 rounded-2xl bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center shadow-xs">
                <Power className="w-6 h-6" />
              </div>
              <div>
                <span className="text-[11px] font-black text-amber-600 dark:text-amber-400 uppercase tracking-wider">
                  Step 1
                </span>
                <h4 className="text-sm md:text-base font-black text-slate-900 dark:text-white mt-0.5">
                  {t.guide.step1Title}
                </h4>
                <p className="text-xs text-slate-600 dark:text-slate-400 font-medium mt-1 leading-relaxed">
                  {t.guide.step1Desc}
                </p>
              </div>
            </div>

            {/* STEP 2: USB CABLE */}
            <div className={`p-5 rounded-2xl border transition-all space-y-3 shadow-xs ${
              isUsbConnected
                ? 'border-emerald-300 dark:border-emerald-500/40 bg-emerald-50/50 dark:bg-emerald-950/20'
                : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
            }`}>
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-xs ${
                isUsbConnected
                  ? 'bg-emerald-600 text-white shadow-emerald-600/20'
                  : 'bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400'
              }`}>
                {isUsbConnected ? <Check className="w-6 h-6 stroke-[3]" /> : <Cable className="w-6 h-6" />}
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <span className={`text-[11px] font-black uppercase tracking-wider ${
                    isUsbConnected ? 'text-emerald-600 dark:text-emerald-400' : 'text-blue-600 dark:text-blue-400'
                  }`}>
                    Step 2
                  </span>
                  {isUsbConnected && (
                    <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
                      {t.nav.usbConnected} ✓
                    </span>
                  )}
                </div>
                <h4 className="text-sm md:text-base font-black text-slate-900 dark:text-white mt-0.5">
                  {t.guide.step2Title}
                </h4>
                <p className="text-xs text-slate-600 dark:text-slate-400 font-medium mt-1 leading-relaxed">
                  {t.guide.step2Desc}
                </p>
              </div>
            </div>

            {/* STEP 3: TEST PRINT */}
            <div className={`p-5 rounded-2xl border transition-all space-y-3 shadow-xs ${
              isDriverReady
                ? 'border-emerald-300 dark:border-emerald-500/40 bg-emerald-50/50 dark:bg-emerald-950/20'
                : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
            }`}>
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-xs ${
                isDriverReady
                  ? 'bg-emerald-600 text-white shadow-emerald-600/20'
                  : 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400'
              }`}>
                <Printer className="w-6 h-6" />
              </div>
              <div>
                <span className="text-[11px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
                  Step 3
                </span>
                <h4 className="text-sm md:text-base font-black text-slate-900 dark:text-white mt-0.5">
                  {t.guide.step4Title}
                </h4>
                <p className="text-xs text-slate-600 dark:text-slate-400 font-medium mt-1 leading-relaxed">
                  {t.guide.step4Desc}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* BLUETOOTH WIRELESS SETUP (FOR VEER 58mm) */}
        <section className="p-5 md:p-6 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4 shadow-xs transition-colors">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shadow-xs">
                <Bluetooth className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm md:text-base font-black text-slate-900 dark:text-white">
                  {t.guide.sectionBTitle}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                  {t.guide.sectionBSubtitle}
                </p>
              </div>
            </div>

            <button
              onClick={handleOpenWindowsBt}
              className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-xs"
            >
              <ExternalLink className="w-4 h-4 text-blue-600 dark:text-sky-400" />
              <span>{t.guide.openBtSettingsBtn}</span>
            </button>
          </div>

          {/* Simple Bluetooth Action Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 space-y-1">
              <span className="font-extrabold text-indigo-700 dark:text-indigo-300">1. {t.guide.stepB3Title}</span>
              <p className="text-slate-600 dark:text-slate-300 text-[11px] leading-relaxed">
                {t.guide.stepB3Desc}
              </p>
            </div>
            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 space-y-1">
              <span className="font-extrabold text-indigo-700 dark:text-indigo-300">2. {t.guide.stepB4Title}</span>
              <p className="text-slate-600 dark:text-slate-300 text-[11px] leading-relaxed">
                {t.guide.stepB4Desc}
              </p>
            </div>
            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 space-y-1">
              <span className="font-extrabold text-indigo-700 dark:text-indigo-300">3. {t.guide.stepB5Title}</span>
              <p className="text-slate-600 dark:text-slate-300 text-[11px] leading-relaxed">
                {t.guide.stepB5Desc}
              </p>
            </div>
          </div>

          {/* Bluetooth Buttons & Discovery */}
          <div className="pt-2 flex flex-wrap items-center gap-3">
            <button
              onClick={() => initBluetooth()}
              disabled={bluetoothState.isScanning}
              className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black transition-all flex items-center gap-2 shadow-xs cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${bluetoothState.isScanning ? 'animate-spin' : ''}`} />
              <span>{bluetoothState.isScanning ? t.guide.scanningBt : t.guide.scanBtBtn}</span>
            </button>

            {Boolean(bluetoothState.connectedDeviceId) && (
              <button
                onClick={handleRunBtTestPrint}
                className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black transition-all flex items-center gap-2 shadow-xs cursor-pointer"
              >
                <FileText className="w-4 h-4" />
                <span>{t.dashboard.testPrint}</span>
              </button>
            )}

            {btFeedback && (
              <span className="text-xs font-bold text-emerald-600 dark:text-emerald-300 animate-pulse">
                {btFeedback}
              </span>
            )}
          </div>

          {/* Discovered Paired Devices */}
          {bluetoothState.devices.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              {bluetoothState.devices.map((device, idx) => {
                const devId = device.address || device.name || `bt-${idx}`;
                const isConnected = bluetoothState.connectedDeviceId === devId || bluetoothState.connectedDeviceId === device.address;
                return (
                  <div
                    key={devId}
                    className={`p-3.5 rounded-2xl border flex items-center justify-between gap-2 ${
                      isConnected
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-500 text-emerald-800 dark:text-emerald-300'
                        : 'bg-slate-50 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-black truncate">{device.name}</p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">{device.address || 'Paired'}</p>
                    </div>
                    <button
                      onClick={() => connectBluetoothDevice(devId)}
                      disabled={isConnected}
                      className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                        isConnected
                          ? 'bg-emerald-600 text-white'
                          : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                      }`}
                    >
                      {isConnected ? `${t.dashboard.ready} ✓` : t.dashboard.connectBluetooth}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* BOTTOM ACTION BAR */}
        <div className="p-5 md:p-6 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xs transition-colors">
          <label className="flex items-center gap-2.5 text-xs text-slate-600 dark:text-slate-400 cursor-pointer font-semibold">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
            />
            <span>{t.guide.stepB6Desc}</span>
          </label>

          <button
            onClick={handleFinishGuide}
            className="w-full sm:w-auto px-6 py-3 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-black text-sm shadow-md shadow-blue-600/20 transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <span>{t.guide.openDashboardBtn}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </main>

      {/* PERSISTENT CTRL+P FOOTER */}
      <footer className="sticky bottom-0 z-40 bg-white/95 dark:bg-[#060B19]/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 px-4 md:px-8 py-3 text-center shadow-xs transition-colors">
        <div className="max-w-4xl mx-auto flex items-center justify-center gap-2 text-xs md:text-sm font-bold text-blue-700 dark:text-sky-300">
          <Info className="w-4 h-4 text-blue-600 dark:text-sky-400 shrink-0" />
          <span>{t.guide.ctrlPNote}</span>
        </div>
      </footer>
    </div>
  );
};

export default SetupConnectionGuide;
