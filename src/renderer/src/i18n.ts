import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { en } from './locales/en';
import { hi } from './locales/hi';
import { mr } from './locales/mr';
import { gu } from './locales/gu';
import { ta } from './locales/ta';
import { te } from './locales/te';
import { kn } from './locales/kn';
import { bn } from './locales/bn';
import { ml } from './locales/ml';
import { pa } from './locales/pa';
import { or } from './locales/or';
import { ur } from './locales/ur';
import { as } from './locales/as';

export const resources = {
  en: { translation: en },
  hi: { translation: hi },
  mr: { translation: mr },
  gu: { translation: gu },
  ta: { translation: ta },
  te: { translation: te },
  kn: { translation: kn },
  bn: { translation: bn },
  ml: { translation: ml },
  pa: { translation: pa },
  or: { translation: or },
  ur: { translation: ur },
  as: { translation: as },
};

const savedLang = localStorage.getItem('seznik_language') || 'en';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    lng: savedLang,
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'seznik_language',
      caches: ['localStorage'],
    },
  });

export default i18n;
