import React from 'react';
import { Printer } from 'lucide-react';
import { useTranslation } from '../locales/useTranslation';

export const About: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-white">{t.about.title}</h1>
        <p className="text-xs text-slate-400">{t.about.subtitle}</p>
      </div>

      <div className="p-6 rounded-2xl glass-panel border border-slate-800 space-y-4">
        <div className="flex items-center space-x-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-seznik-600 to-blue-800 flex items-center justify-center shadow-fluent-glow">
            <Printer className="w-7 h-7 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">{t.about.appTitle}</h2>
            <p className="text-xs text-slate-400">{t.about.appVersion}</p>
          </div>
        </div>

        <div className="pt-2 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-1">
            <span className="text-slate-400 font-medium">{t.about.coreStackTitle}</span>
            <p className="text-slate-200 font-semibold">{t.about.coreStackDesc}</p>
          </div>

          <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-1">
            <span className="text-slate-400 font-medium">{t.about.backendTitle}</span>
            <p className="text-slate-200 font-semibold">{t.about.backendDesc}</p>
          </div>
        </div>
      </div>
    </div>
  );
};
