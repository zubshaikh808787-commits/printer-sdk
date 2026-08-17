import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Printer,
  HardDriveDownload,
  Settings as SettingsIcon,
  Terminal,
  Info,
  HelpCircle,
} from 'lucide-react';
import { usePrinterStore } from '../../store/usePrinterStore';
import { useTranslation } from '../../locales/useTranslation';
import { LanguageSelector } from '../LanguageSelector';

interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
  badge?: number;
}

export const Sidebar: React.FC = () => {
  const { osPrinters, savedPrinters, v1State } = usePrinterStore();
  const { t } = useTranslation();

  const usbCount = savedPrinters.filter(p => p.connectionType === 'USB').length || (v1State.usbConnected ? osPrinters.length : 0);
  const totalCount = savedPrinters.length > 0 ? savedPrinters.length : osPrinters.length;

  const primaryItems: NavItem[] = [
    { path: '/', label: t.nav.dashboard, icon: <LayoutDashboard className="w-4 h-4" />, badge: totalCount || undefined },
    { path: '/guide', label: t.guide.title || 'Setup Guide', icon: <HelpCircle className="w-4 h-4 text-blue-500" /> },
    { path: '/detection', label: t.nav.usbPrinters, icon: <Printer className="w-4 h-4" />, badge: usbCount || undefined },
    { path: '/drivers', label: t.nav.driversAndSetup, icon: <HardDriveDownload className="w-4 h-4" /> },
  ];

  const systemItems: NavItem[] = [
    { path: '/settings', label: t.nav.settings, icon: <SettingsIcon className="w-4 h-4" /> },
    { path: '/logs', label: t.nav.activityLogs, icon: <Terminal className="w-4 h-4" /> },
    { path: '/about', label: t.nav.about, icon: <Info className="w-4 h-4" /> },
  ];

  const renderNavGroup = (title: string, items: NavItem[]) => (
    <div className="mb-4">
      <div className="px-3 mb-1 text-[10px] font-extrabold tracking-wider text-slate-400 dark:text-slate-500 uppercase">
        {title}
      </div>
      <nav className="space-y-0.5">
        {items.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `flex items-center justify-between px-3 py-2 text-xs font-semibold rounded-xl transition-all ${
                isActive
                  ? 'bg-blue-600 text-white shadow-xs font-bold'
                  : 'text-slate-700 dark:text-slate-300 hover:text-blue-600 dark:hover:text-sky-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <div className="flex items-center space-x-2.5">
                  {item.icon}
                  <span>{item.label}</span>
                </div>
                {!!item.badge && (
                  <span className={`min-w-[18px] h-[18px] px-1 rounded-md text-[10px] font-black flex items-center justify-center ${
                    isActive ? 'bg-white/20 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                  }`}>
                    {item.badge}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );

  return (
    <aside className="w-56 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col justify-between p-3 select-none overflow-y-auto shrink-0 transition-colors duration-300">
      <div>
        {/* Brand Lockup */}
        <div className="flex items-center space-x-2 px-1 mb-5 mt-1">
          <div className="w-8 h-8 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-xs shrink-0">
            <Printer className="w-4 h-4" />
          </div>
          <span className="text-sm font-black text-slate-900 dark:text-white tracking-wide">SEZNIK</span>
        </div>

        {renderNavGroup(t.nav.devices, primaryItems)}
        {renderNavGroup(t.nav.system, systemItems)}
      </div>

      <div className="space-y-2.5">
        {/* Language Switcher Widget */}
        <LanguageSelector variant="sidebar" />
      </div>
    </aside>
  );
};

export default Sidebar;
