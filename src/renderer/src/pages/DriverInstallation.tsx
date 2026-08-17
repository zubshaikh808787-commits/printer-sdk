import React from 'react';
import { HardDriveDownload, ShieldCheck } from 'lucide-react';
import { usePrinterStore } from '../store/usePrinterStore';
import { useTranslation } from '../locales/useTranslation';

export const DriverInstallation: React.FC = () => {
  const { installJoshDriver, installVeerDriver, installDevDriver, fetchOsPrinters } = usePrinterStore();
  const { t } = useTranslation();
  const [isInstalling, setIsInstalling] = React.useState(false);
  const [logMessage, setLogMessage] = React.useState<string | null>(null);

  const handleInstallJosh = async () => {
    setIsInstalling(true);
    setLogMessage('Launching JOSH Driver Installer (Win Driver Driver JOSH Label Printer.exe / DTPWeb)...');
    const res = await installJoshDriver();
    setLogMessage(res.log);
    await fetchOsPrinters();
    setIsInstalling(false);
  };

  const handleInstallVeer = async () => {
    setIsInstalling(true);
    setLogMessage('Launching VEER Driver Installer (POS58Setup_20210916.exe)...');
    const res = await installVeerDriver();
    setLogMessage(res.log);
    await fetchOsPrinters();
    setIsInstalling(false);
  };

  const handleInstallDev = async () => {
    setIsInstalling(true);
    setLogMessage('Launching DEV Driver Installer (Dev Windows Driver.exe / DEV Receipt POS58Setup.exe)...');
    if (installDevDriver) {
      const res = await installDevDriver();
      setLogMessage(res.log);
    }
    await fetchOsPrinters();
    setIsInstalling(false);
  };

  return (
    <div className="space-y-4 max-w-6xl mx-auto select-none text-slate-800">
      <div className="flex items-center justify-between bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div>
          <h1 className="text-sm font-black uppercase text-slate-900 tracking-wider">{t.drivers.title}</h1>
          <p className="text-xs text-slate-500 font-medium">{t.drivers.subtitle}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* JOSH Driver Box */}
        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <div className="p-2 rounded-lg bg-blue-50 text-blue-600 border border-blue-200">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-xs font-black uppercase text-slate-900">{t.drivers.joshTitle}</h3>
                <p className="text-[11px] text-slate-500 font-medium">{t.drivers.joshSubtitle}</p>
              </div>
            </div>
          </div>

          <p className="text-[11px] text-slate-600 font-medium leading-relaxed">
            {t.drivers.joshDesc}
          </p>

          <button
            onClick={handleInstallJosh}
            disabled={isInstalling}
            className="w-full py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold shadow-xs transition-all flex items-center justify-center gap-1.5"
          >
            <HardDriveDownload className={`w-3.5 h-3.5 ${isInstalling ? 'animate-spin' : ''}`} />
            <span>{t.drivers.launchJosh}</span>
          </button>
        </div>

        {/* VEER Driver Box */}
        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600 border border-emerald-200">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-xs font-black uppercase text-slate-900">{t.drivers.veerTitle}</h3>
                <p className="text-[11px] text-slate-500 font-medium">{t.drivers.veerSubtitle}</p>
              </div>
            </div>
          </div>

          <p className="text-[11px] text-slate-600 font-medium leading-relaxed">
            {t.drivers.veerDesc}
          </p>

          <button
            onClick={handleInstallVeer}
            disabled={isInstalling}
            className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold shadow-xs transition-all flex items-center justify-center gap-1.5"
          >
            <HardDriveDownload className={`w-3.5 h-3.5 ${isInstalling ? 'animate-spin' : ''}`} />
            <span>{t.drivers.launchVeer}</span>
          </button>
        </div>

        {/* DEV Driver Box */}
        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-200">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-xs font-black uppercase text-slate-900">{t.drivers.devTitle}</h3>
                <p className="text-[11px] text-slate-500 font-medium">{t.drivers.devSubtitle}</p>
              </div>
            </div>
          </div>

          <p className="text-[11px] text-slate-600 font-medium leading-relaxed">
            {t.drivers.devDesc}
          </p>

          <button
            onClick={handleInstallDev}
            disabled={isInstalling}
            className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold shadow-xs transition-all flex items-center justify-center gap-1.5"
          >
            <HardDriveDownload className={`w-3.5 h-3.5 ${isInstalling ? 'animate-spin' : ''}`} />
            <span>{t.drivers.launchDev}</span>
          </button>
        </div>
      </div>

      {logMessage && (
        <div className="p-3 bg-slate-900 rounded-xl border border-slate-800 text-xs text-emerald-400 font-mono">
          {logMessage}
        </div>
      )}
    </div>
  );
};
