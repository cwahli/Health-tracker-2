import { describe, it, expect } from 'vitest';
import { localePacks, translations } from './translations';
import {
  REQUIRED_COMPLETE_LOCALES,
  SUPPORTED_LOCALES,
  agentOutputLanguageBlock,
  dictionaryFor,
  normalizeLocale,
  t,
  withAgentLanguage,
} from './i18n';

const enKeys = Object.keys(translations.en).sort();

describe('i18n locales', () => {
  it('lists the supported locale codes', () => {
    expect([...SUPPORTED_LOCALES].sort()).toEqual(['en', 'fr', 'id', 'zh']);
  });

  it('requires English and Indonesian raw packs to have the same keys as en (not English-filled)', () => {
    const sourceKeys = Object.keys(localePacks.en).sort();
    for (const locale of REQUIRED_COMPLETE_LOCALES) {
      const keys = Object.keys(localePacks[locale]).sort();
      const missing = sourceKeys.filter((k) => !keys.includes(k));
      expect(missing, `${locale} missing keys vs en`).toEqual([]);
    }
  });

  it('falls back to English for a missing French/Chinese key', () => {
    expect(t('fr', 'sendToAdmin')).toBeTruthy();
    expect(t('zh', 'sendToAdmin')).toBeTruthy();
  });
});

describe('normalizeLocale', () => {
  it('maps common aliases', () => {
    expect(normalizeLocale('id')).toBe('id');
    expect(normalizeLocale('ID-ID')).toBe('id');
    expect(normalizeLocale('en-US')).toBe('en');
    expect(normalizeLocale('')).toBe('en');
    expect(normalizeLocale(undefined)).toBe('en');
  });
});

describe('dictionaryFor', () => {
  it('returns Indonesian copy for id', () => {
    const dict = dictionaryFor('id');
    expect(dict.sendToAdmin).toBe(translations.id.sendToAdmin);
    expect(dict.sendToAdmin).not.toBe(translations.en.sendToAdmin);
  });
});

describe('agentOutputLanguageBlock', () => {
  it('names Bahasa Indonesia and keeps JSON keys in English', () => {
    const block = agentOutputLanguageBlock('id');
    expect(block).toContain('Bahasa Indonesia');
    expect(block).toContain('code: id');
    expect(block).toContain('JSON keys');
    expect(block).toContain('Do not reply in English');
  });

  it('does not tell English users to avoid English', () => {
    expect(agentOutputLanguageBlock('en')).not.toContain('Do not reply in English');
  });

  it('prepends the block onto an instruction', () => {
    const out = withAgentLanguage('You are the dietitian.', 'id');
    expect(out.startsWith('=== USER OUTPUT LANGUAGE ===')).toBe(true);
    expect(out).toContain('You are the dietitian.');
  });
});
