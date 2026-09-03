import { describe, it, expect } from 'vitest';
import { getDemoReport } from './demoData';
import { getLocalFallbackReport } from './fallbackReport';

describe('seed narratives language', () => {
  it('keeps English narratives by default', () => {
    const r = getDemoReport('empty');
    expect(r.mostImportantNextStep).toContain('Welcome!');
    expect(r.healthRiskForecast?.year5).toContain('No historical biomarkers');
    expect(r.nutrientRankingRationale).toContain('clinical test datasets');
  });

  it('writes demo narratives in Indonesian for id', () => {
    for (const type of ['empty', 'complex', 'average'] as const) {
      const r = getDemoReport(type, 'id');
      expect(r.mostImportantNextStep).not.toContain('Welcome!');
      expect(r.nutrientRankingRationale).not.toContain('Focusing on Saturated Fat');
      expect(r.healthRiskForecast?.year5).toBeTruthy();
    }
    const empty = getDemoReport('empty', 'id');
    expect(empty.mostImportantNextStep).toContain('Selamat datang');
    expect(empty.healthRiskForecast?.year5).toContain('Belum ada biomarker');
    const complex = getDemoReport('complex', 'id');
    expect(complex.mostImportantNextStep).toContain('Batasi natrium');
    expect(complex.nutrientRankingRationale).toContain('Pembatasan natrium');
    const avg = getDemoReport('average', 'id');
    expect(avg.mostImportantNextStep).toContain('Optimalkan panel lipid');
  });

  it('writes fallback narratives in Indonesian for id profiles', () => {
    const idSpecial = { email: 'chiwah.liu@gmail.com', language: 'id' } as any;
    const r = getLocalFallbackReport(idSpecial);
    expect(r.mostImportantNextStep).toContain('dokter umum');
    expect(r.healthRiskForecast?.year5).toContain('Aterosklerosis');
    expect(r.nutrientRankingRationale).toContain('Lemak Jenuh');
    const idGeneric = { email: 'test@example.com', language: 'id' } as any;
    const g = getLocalFallbackReport(idGeneric);
    expect(g.mostImportantNextStep).toContain('Batasi lemak jenuh');
  });

  it('keeps English fallback narratives for en profiles', () => {
    const enProfile = { email: 'test@example.com', language: 'en' } as any;
    const r = getLocalFallbackReport(enProfile);
    expect(r.mostImportantNextStep).toContain('Reduce saturated fat');
    expect(r.healthRiskForecast?.year5).toContain('vascular stiffness');
  });
});
