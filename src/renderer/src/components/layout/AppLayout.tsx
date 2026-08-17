import React, { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { useSettingsStore } from '../../store/useSettingsStore';
import { SplashScreen } from '../SplashScreen';

export const AppLayout: React.FC = () => {
  const { fetchSettings } = useSettingsStore();
  const [isSplashOpen, setIsSplashOpen] = useState(false);

  useEffect(() => {
    fetchSettings();

    // Listen for custom open splash events (e.g. from Header or Dashboard)
    const handleOpenSplash = () => setIsSplashOpen(true);
    window.addEventListener('open-splash-screen', handleOpenSplash);
    return () => window.removeEventListener('open-splash-screen', handleOpenSplash);
  }, [fetchSettings]);

  return (
    <div className="h-screen w-screen flex flex-col bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 overflow-hidden select-none relative transition-colors duration-300">
      {/* Top Application Titlebar */}
      <Header onOpenSplash={() => setIsSplashOpen(true)} />

      {/* Main Window Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Navigation Sidebar */}
        <Sidebar />

        {/* Desktop Viewport Content Area */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 bg-slate-100/70 dark:bg-slate-950/70 transition-colors">
          <Outlet />
        </main>
      </div>

      {/* Full-Screen Landing / Splash Screen Overlay Modal */}
      <AnimatePresence>
        {isSplashOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="fixed inset-0 z-50 flex flex-col bg-slate-950/90 backdrop-blur-md"
          >
            {/* Top Close Control */}
            <div className="absolute top-4 right-4 z-50 flex items-center gap-2">
              <button
                onClick={() => setIsSplashOpen(false)}
                className="px-3.5 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold transition-all flex items-center gap-1.5 shadow-lg cursor-pointer"
              >
                <span>Back to Dashboard</span>
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Embedded Responsive Splash Component */}
            <div className="flex-1 w-full h-full">
              <SplashScreen
                onProceed={() => setIsSplashOpen(false)}
                autoDismissOnConnect={false}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AppLayout;
