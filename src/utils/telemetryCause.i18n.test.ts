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
});
