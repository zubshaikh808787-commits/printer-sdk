import React, { useEffect, useState } from 'react';
import { Printer, RefreshCw, Sun, Moon } from 'lucide-react';
import { WindowControls } from './WindowControls';
import { usePrinterStore } from '../../store/usePrinterStore';
import { useTranslation } from '../../locales/useTranslation';
import { useTheme } from '../../context/ThemeContext';
import { LanguageSelector } from '../LanguageSelector';

export interface HeaderProps {
  onOpenSplash?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onOpenSplash }) => {
  const { v1State, fetchOsPrinters, fetchSavedPrinters } = usePrinterStore();
  const { t } = useTranslation();
  const { isDark, toggleTheme } = useTheme();
  const [platform, setPlatform] = useState<string>('win32');

  useEffect(() => {
    if (window.seznikApi) {
      window.seznikApi.getSystemInfo().then(info => setPlatform(info.platform));
    }
  }, []);

  const isUsbConnected = v1State.usbConnected;

  return (
    <header className="h-[42px] bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-3.5 flex items-center justify-between select-none titlebar-drag shrink-0 z-50 text-slate-700 dark:text-slate-300 transition-colors">
      {/* Left Branding */}
      <div className="flex items-center space-x-2.5 titlebar-no-drag">
        <div className="w-6 h-6 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-xs">
          <Printer className="w-3.5 h-3.5 text-white" />
        </div>
        <div className="flex items-center space-x-2">
          <span className="text-xs font-black tracking-wider text-slate-900 dark:text-slate-100 uppercase">
            {t.header.title}
          </span>
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-mono font-bold border border-slate-200 dark:border-slate-700">
            v1.0
          </span>
        </div>
      </div>

      {/* Center Status Pill */}
      <div className="hidden md:flex items-center space-x-3 titlebar-no-drag">
        {isUsbConnected ? (
          <button
            onClick={onOpenSplash}
            title="Click to view USB Hardware Radar Splash Animation"
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase bg-emerald-50 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 transition-all cursor-pointer shadow-xs"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            {t.header.usbConnectedBadge}
          </button>
        ) : (
          <button
            onClick={onOpenSplash}
            title="Click to view USB Hardware Radar Splash Animation"
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 transition-all cursor-pointer shadow-xs"
          >
            <span className="w-2 h-2 rounded-full bg-slate-400"></span>
            {t.header.noUsbConnectedBadge}
          </button>
        )}

        <button
          onClick={() => { fetchOsPrinters(); fetchSavedPrinters(); }}
          className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors cursor-pointer"
          title={t.header.refreshScanning}
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Right Controls (Theme Toggle + Language Selector + Window Controls) */}
      <div className="flex items-center space-x-2 titlebar-no-drag">
        {/* Global Theme Toggle */}
        <button
          onClick={toggleTheme}
          className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition-all cursor-pointer"
          title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          aria-label="Toggle theme"
        >
          {isDark ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5 text-slate-600" />}
        </button>

        <LanguageSelector variant="header" />
        <WindowControls />
      </div>
    </header>
  );
};

export default Header;
