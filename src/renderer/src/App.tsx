import React, { useEffect } from 'react';
import { HashRouter as Router, Routes, Route } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { Dashboard } from './pages/Dashboard';
import { PrinterDetection } from './pages/PrinterDetection';
import { DriverInstallation } from './pages/DriverInstallation';
import { Settings } from './pages/Settings';
import { Logs } from './pages/Logs';
import { About } from './pages/About';
import { SetupConnectionGuide } from './pages/SetupConnectionGuide';
import { usePrinterStore } from './store/usePrinterStore';
import { ThemeProvider } from './context/ThemeContext';

export const AppContent: React.FC = () => {
  const { initV1Orchestrator, fetchOsPrinters, fetchSavedPrinters } = usePrinterStore();

  useEffect(() => {
    initV1Orchestrator();
    fetchOsPrinters();
    fetchSavedPrinters();
  }, [initV1Orchestrator, fetchOsPrinters, fetchSavedPrinters]);

  return (
    <div className="w-screen h-screen overflow-hidden bg-slate-50 dark:bg-slate-900 transition-colors duration-300">
      <Router>
        <Routes>
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
            <Route path="usb" element={<PrinterDetection />} />
            <Route path="settings" element={<Settings />} />
            <Route path="logs" element={<Logs />} />
            <Route path="about" element={<About />} />
          </Route>
        </Routes>
      </Router>
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
