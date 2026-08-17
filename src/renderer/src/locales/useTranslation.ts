import { useTranslation as useI18nTranslation } from 'react-i18next';
import { useSettingsStore } from '../store/useSettingsStore';
import { en, TranslationType } from './en';
import { hi } from './hi';
import { mr } from './mr';
import { gu } from './gu';
import { ta } from './ta';
import { te } from './te';
import { kn } from './kn';
import { bn } from './bn';
import { ml } from './ml';
import { pa } from './pa';
import { or } from './or';
import { ur } from './ur';
import { as } from './as';

export type LanguageCode =
  | 'en'
  | 'hi'
  | 'mr'
  | 'gu'
  | 'ta'
  | 'te'
  | 'kn'
  | 'bn'
  | 'ml'
  | 'pa'
  | 'or'
  | 'ur'
  | 'as';

export interface LanguageMeta {
  code: LanguageCode;
  label: string;
  nativeName: string;
  flagEmoji?: string;
}

export const languages: LanguageMeta[] = [
  { code: 'hi', label: 'Hindi', nativeName: 'हिन्दी' },
  { code: 'en', label: 'English', nativeName: 'English' },
  { code: 'mr', label: 'Marathi', nativeName: 'मराठी' },
  { code: 'gu', label: 'Gujarati', nativeName: 'ગુજરાતી' },
  { code: 'ta', label: 'Tamil', nativeName: 'தமிழ்' },
  { code: 'te', label: 'Telugu', nativeName: 'తెలుగు' },
  { code: 'kn', label: 'Kannada', nativeName: 'ಕನ್ನಡ' },
  { code: 'bn', label: 'Bengali', nativeName: 'বাংলা' },
  { code: 'ml', label: 'Malayalam', nativeName: 'മലയാളം' },
  { code: 'pa', label: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ' },
  { code: 'or', label: 'Odia', nativeName: 'ଓଡ଼ିଆ' },
  { code: 'ur', label: 'Urdu', nativeName: 'اردو' },
  { code: 'as', label: 'Assamese', nativeName: 'অসমীয়া' },
];

export const dictionaries: Record<LanguageCode, TranslationType> = {
  en,
  hi,
  mr,
  gu,
  ta,
  te,
  kn,
  bn,
  ml,
  pa,
  or,
  ur,
  as,
};

export const useTranslation = () => {
  const { i18n } = useI18nTranslation();
  const { settings, updateSettings } = useSettingsStore();

  const activeLangCode = (i18n.language || settings.language || 'en') as string;
  const currentLang = (languages.some((l) => l.code === activeLangCode) ? activeLangCode : 'en') as LanguageCode;
  const t = dictionaries[currentLang] || en;

  const setLanguage = async (lang: LanguageCode) => {
    await i18n.changeLanguage(lang);
    localStorage.setItem('seznik_language', lang);
    await updateSettings({ language: lang });
  };

  const currentLanguageInfo = languages.find((l) => l.code === currentLang) || languages[0];

  return {
    language: currentLang,
    currentLanguageInfo,
    t,
    setLanguage,
    languages,
  };
};
