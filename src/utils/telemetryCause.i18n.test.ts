import { describe, it, expect } from 'vitest';
import { diagnoseTelemetryIssue } from './biomarkers';

describe('diagnoseTelemetryIssue language', () => {
  it('keeps English preciseCause by default', () => {
    const d = diagnoseTelemetryIssue('wbc', 'White Blood Cell (WBC)', 100, '10^9/L', '4.0 - 11.0');
    expect(d.preciseCause).toContain('Logged value');
  });

  it('writes preciseCause in Indonesian for id profiles', () => {
    const d = diagnoseTelemetryIssue('wbc', 'White Blood Cell (WBC)', 100, '10^9/L', '4.0 - 11.0', undefined, 'id');
    expect(d.preciseCause).toContain('Nilai tercatat');
    expect(d.preciseCause).not.toContain('Logged value');
  });

  it('localizes the generic fallback in Indonesian', () => {
    const d = diagnoseTelemetryIssue('hba1c', 'HbA1c', 5.4, '%', '4.0 - 5.6', undefined, 'id');
    expect(d.preciseCause).toContain('menyimpang signifikan');
  });

  it('localizes issueTitle/suggestedFix/badgeLabel in Indonesian', () => {
    const d = diagnoseTelemetryIssue('basophils', 'Basophils', 100, '10^9/L', '0.0 - 0.1', undefined, 'id');
    expect(d.issueTitle).toContain('Kesalahan Skala Unit');
    expect(d.suggestedFix).toContain('Perbarui nilai menjadi 0.10');
    expect(d.badgeLabel).toContain('Skala:');
    expect(d.issueTitle).not.toContain('Unit Scale Error');
  });

  it('keeps English issueTitle/suggestedFix/badgeLabel by default', () => {
    const d = diagnoseTelemetryIssue('basophils', 'Basophils', 100, '10^9/L', '0.0 - 0.1');
    expect(d.issueTitle).toContain('Unit Scale Error');
    expect(d.suggestedFix).toContain('Update value to 0.10');
    expect(d.badgeLabel).toContain('Scale:');
  });
});
