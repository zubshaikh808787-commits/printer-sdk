import React, { useState, useRef, useEffect } from 'react';
import { Globe, Check, ChevronDown } from 'lucide-react';
import { useTranslation, languages, LanguageCode } from '../locales/useTranslation';

interface LanguageSelectorProps {
  variant?: 'header' | 'sidebar' | 'settings';
}

export const LanguageSelector: React.FC<LanguageSelectorProps> = ({ variant = 'header' }) => {
  const { language, currentLanguageInfo, setLanguage } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (variant === 'settings') {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {languages.map((l) => {
          const isSelected = language === l.code;
          return (
            <button
              key={l.code}
              onClick={() => setLanguage(l.code)}
              className={`p-2.5 rounded-xl border text-left transition-all flex flex-col justify-between gap-1 ${
                isSelected
                  ? 'bg-blue-50/80 border-blue-500 shadow-sm ring-1 ring-blue-500'
                  : 'bg-white hover:bg-slate-50 border-slate-200'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className={`text-xs font-black ${isSelected ? 'text-blue-700' : 'text-slate-800'}`}>
                  {l.nativeName}
                </span>
                {isSelected && <Check className="w-3.5 h-3.5 text-blue-600" />}
              </div>
              <span className="text-[10px] text-slate-500 font-medium font-sans">
                {l.label} ({l.code.toUpperCase()})
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  if (variant === 'sidebar') {
    return (
      <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2 shadow-xs">
        <div className="flex items-center justify-between text-[11px] font-extrabold text-slate-700">
          <span className="flex items-center gap-1.5">
            <Globe className="w-3.5 h-3.5 text-blue-600" />
            <span>Language / भाषा</span>
          </span>
          <span className="text-[10px] uppercase font-mono font-bold bg-blue-600 text-white px-1.5 py-0.5 rounded">
            {language.toUpperCase()}
          </span>
        </div>
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value as LanguageCode)}
          className="w-full bg-white border border-slate-300 text-slate-800 font-bold text-xs py-1.5 px-2 rounded-lg focus:outline-none focus:border-blue-600 cursor-pointer shadow-xs"
        >
          {languages.map((l) => (
            <option key={l.code} value={l.code}>
              {l.nativeName} — {l.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  // Default: Header compact dropdown
  return (
    <div className="relative titlebar-no-drag" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-800/90 hover:bg-slate-700/80 border border-slate-700 rounded-lg text-slate-200 hover:text-white transition-all shadow-xs text-[11px] font-extrabold"
        title="Select Application Language"
      >
        <Globe className="w-3.5 h-3.5 text-blue-400 shrink-0" />
        <span className="tracking-wide">{currentLanguageInfo.nativeName}</span>
        <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-1.5 w-48 bg-slate-900 border border-slate-700/90 rounded-xl shadow-2xl z-50 py-1.5 text-xs overflow-hidden backdrop-blur-md">
          <div className="px-3 py-1 text-[10px] font-black uppercase tracking-wider text-slate-400 border-b border-slate-800 mb-1 flex items-center justify-between">
            <span>Select Language</span>
            <span>भारतीय भाषाएं</span>
          </div>
          <div className="max-h-60 overflow-y-auto space-y-0.5 px-1">
            {languages.map((l) => {
              const isSelected = language === l.code;
              return (
                <button
                  key={l.code}
                  onClick={() => {
                    setLanguage(l.code);
                    setIsOpen(false);
                  }}
                  className={`w-full px-2.5 py-1.5 rounded-lg text-left flex items-center justify-between transition-colors ${
                    isSelected
                      ? 'bg-blue-600 text-white font-bold'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <div className="flex flex-col">
                    <span className="font-bold text-[11px]">{l.nativeName}</span>
                    <span className={`text-[9px] ${isSelected ? 'text-blue-100' : 'text-slate-500'}`}>
                      {l.label}
                    </span>
                  </div>
                  {isSelected && <Check className="w-3.5 h-3.5 text-white" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
