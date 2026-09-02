import { translations, type TranslationKey } from './translations';

export const SUPPORTED_LOCALES = ['en', 'id', 'fr', 'zh'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** Locales that must have every English key. Add a code here when a language is no longer English-fallback. */
export const REQUIRED_COMPLETE_LOCALES = ['en', 'id'] as const;
export type RequiredCompleteLocale = (typeof REQUIRED_COMPLETE_LOCALES)[number];

const LOCALE_NAMES: Record<SupportedLocale, string> = {
  en: 'English',
  id: 'Bahasa Indonesia',
  fr: 'French',
  zh: 'Chinese',
};

export function normalizeLocale(raw: unknown): SupportedLocale {
  const s = String(raw || '').trim().toLowerCase().replace('_', '-');
  if (s === 'id' || s.startsWith('id-')) return 'id';
  if (s === 'fr' || s.startsWith('fr-')) return 'fr';
  if (s === 'zh' || s.startsWith('zh-')) return 'zh';
  return 'en';
}

export function localeDisplayName(lang: unknown): string {
  return LOCALE_NAMES[normalizeLocale(lang)];
}

/** UI chrome: missing keys in a locale fall back to English. */
export function t(lang: unknown, key: TranslationKey): string {
  const locale = normalizeLocale(lang);
  const dict = translations[locale] as Partial<Record<TranslationKey, string>>;
  return dict[key] || translations.en[key] || String(key);
}

/** Same fallback as t(), for existing `const t = translations[lang]` call sites. */
export function dictionaryFor(lang: unknown) {
  const locale = normalizeLocale(lang);
  if (locale === 'en') return translations.en;
  return translations[locale];
}

/**
 * Prepend to agent system instructions. User-visible prose follows the UI language;
 * JSON keys, nutrient codes, biomarker keys, and enums stay English.
 */
export function agentOutputLanguageBlock(lang: unknown): string {
  const locale = normalizeLocale(lang);
  const name = localeDisplayName(locale);
  const lines = [
    '=== USER OUTPUT LANGUAGE ===',
    `The patient's UI language is ${name} (code: ${locale}).`,
    `Write every user-visible string you generate (verdicts, summaries, chat replies, dietitian lines, card titles, explanations, medicalInsight) in ${name}.`,
    'Keep JSON keys, nutrient codes, biomarker keys, enum values, and schema field names in English.',
    'Keep numbers, units (g, kcal, mg/dL), and scientific abbreviations as-is.',
  ];
  if (locale !== 'en') {
    lines.push(`Do not reply in English unless the user wrote this turn in English and is clearly asking for English.`);
  }
  return lines.join('\n');
}

export function withAgentLanguage(instruction: string, lang: unknown): string {
  const block = agentOutputLanguageBlock(lang);
  if (!instruction) return block;
  return `${block}\n\n${instruction}`;
}

/** Scout JSON is for DB matching: keep food names as seen / culinary, not translated. */
export function scoutIdentityLanguageBlock(lang: unknown): string {
  const locale = normalizeLocale(lang);
  const name = localeDisplayName(locale);
  return [
    agentOutputLanguageBlock(locale),
    `Food identity fields (keyword, originalName, dish names, brand names) stay as observed on labels or common culinary names used for database matching. Do not translate food names into ${name}.`,
  ].join('\n');
}

export function withScoutLanguage(instruction: string, lang: unknown): string {
  const block = scoutIdentityLanguageBlock(lang);
  if (!instruction) return block;
  return `${block}\n\n${instruction}`;
}

