import React, { useState, useEffect } from 'react';
import { HashRouter as Router, Routes, Route } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { AppLayout } from './components/layout/AppLayout';
import { Dashboard } from './pages/Dashboard';
import { PrinterDetection } from './pages/PrinterDetection';
import { DriverInstallation } from './pages/DriverInstallation';
import { SDKInstallation } from './pages/SDKInstallation';
import { FirmwareManager } from './pages/FirmwareManager';
import { Settings } from './pages/Settings';
import { Logs } from './pages/Logs';
import { Downloads } from './pages/Downloads';
import { About } from './pages/About';
import { SetupConnectionGuide } from './pages/SetupConnectionGuide';
import { SplashScreen } from './components/SplashScreen';
import { usePrinterStore } from './store/usePrinterStore';
import { ThemeProvider } from './context/ThemeContext';

export const AppContent: React.FC = () => {
  const { initV1Orchestrator, fetchOsPrinters, fetchSavedPrinters } = usePrinterStore();

  // Show Setup & Connection Guide straight away on first launch / install (no loading screen)
  const [showInitialGuide, setShowInitialGuide] = useState<boolean>(() => {
    const isDismissedPermanent = localStorage.getItem('seznik_initial_guide_dismissed_permanent');
    const isDismissedSession = sessionStorage.getItem('seznik_initial_guide_dismissed');
    return !(isDismissedPermanent || isDismissedSession);
  });

  useEffect(() => {
    // Immediately boot hardware USB discovery orchestrator so guide catches connections live
    initV1Orchestrator();
    fetchOsPrinters();
    fetchSavedPrinters();
  }, [initV1Orchestrator, fetchOsPrinters, fetchSavedPrinters]);

  const handleGuideComplete = () => {
    sessionStorage.setItem('seznik_initial_guide_dismissed', 'true');
    setShowInitialGuide(false);
  };

  return (
    <div className="w-screen h-screen overflow-hidden bg-slate-50 dark:bg-slate-900 transition-colors duration-300">
      <AnimatePresence mode="wait">
        {showInitialGuide ? (
          <motion.div
            key="initial-setup-guide"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="w-full h-full"
          >
            <SetupConnectionGuide
              onComplete={handleGuideComplete}
              onOpenDashboard={handleGuideComplete}
            />
          </motion.div>
        ) : (
          <motion.div
            key="main-app-router"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
            className="w-full h-full"
          >
            <Router>
              <Routes>
                <Route
                  path="/splash"
                  element={
                    <div className="h-screen w-screen">
                      <SplashScreen onProceed={() => (window.location.hash = '#/')} />
                    </div>
                  }
                />
                <Route
                  path="/guide"
                  element={
                    <div className="h-screen w-screen">
                      <SetupConnectionGuide onOpenDashboard={() => (window.location.hash = '#/')} />
                    </div>
                  }
                />
                <Route path="/" element={<AppLayout />}>
                  <Route index element={<Dashboard />} />
                  <Route path="detection" element={<PrinterDetection />} />
                  <Route path="drivers" element={<DriverInstallation />} />
                  <Route path="sdk" element={<SDKInstallation />} />
                  <Route path="firmware" element={<FirmwareManager />} />
                  <Route path="usb" element={<PrinterDetection />} />
                  <Route path="network" element={<PrinterDetection />} />
                  <Route path="settings" element={<Settings />} />
                  <Route path="logs" element={<Logs />} />
                  <Route path="downloads" element={<Downloads />} />
                  <Route path="about" element={<About />} />
                </Route>
              </Routes>
            </Router>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
};

export default App;
