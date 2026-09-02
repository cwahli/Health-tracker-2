import { describe, it, expect } from 'vitest';
import { buildFoodAnalyzeInstruction } from './dietitianInstructions';
import { buildReceptionistInstruction } from '../src/server/receptionist/instruction';
import { fillTemplateInstruction } from '../src/server/biomarkers/instruction';
import { withScoutLanguage } from '../src/utils/i18n';

describe('agent output language', () => {
  it('dietitian instruction names Bahasa Indonesia for id profiles', () => {
    const text = buildFoodAnalyzeInstruction({ userProfile: { language: 'id' } });
    expect(text).toContain('Bahasa Indonesia');
    expect(text).toContain('code: id');
    expect(text).toContain('JSON keys');
  });

  it('receptionist instruction follows ui language', () => {
    const text = buildReceptionistInstruction('id');
    expect(text).toContain('Bahasa Indonesia');
    expect(text).toContain('userResponse');
  });

  it('medical fill-template insight copy follows ui language', () => {
    const text = fillTemplateInstruction('40-year-old female', 'id');
    expect(text).toContain('Bahasa Indonesia');
    expect(text).toContain('medicalInsight');
  });

  it('scout keeps food identity untranslated', () => {
    const text = withScoutLanguage('SCOUT CORE', 'id');
    expect(text).toContain('Do not translate food names');
    expect(text).toContain('SCOUT CORE');
  });
});
