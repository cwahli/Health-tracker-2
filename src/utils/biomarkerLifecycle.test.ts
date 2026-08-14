import { describe, it, expect } from 'vitest';
import {
  applyModificationCommands,
  enrichReviewModificationCommands,
  buildReviewCommandsFromHistory,
  convertViaTable,
  overlayAgeBand,
  overlayFingerprint,
  shouldRunCalibrator,
  getRangeVariesBy,
  resolveAgentDestination,
  filterHistoryForUse,
  attachObservationMeta,
  getObservationUnit,
} from './biomarkerLifecycle';
import { isValEmpty, sanitizeBiomarkerHistoryOnLoad } from './biomarkers';

describe('convertViaTable', () => {
  it('converts HDL mg/dL → mmol/L', () => {
    const r = convertViaTable('hdl', 50, 'mg/dL', 'mmol/L');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeCloseTo(1.293, 2);
  });
  it('refuses unknown analyte', () => {
    const r = convertViaTable('made_up_marker', 10, 'mg/dL', 'mmol/L');
    expect(r.ok).toBe(false);
  });
  it('refuses incomparable units', () => {
    const r = convertViaTable('hdl', 50, 'mg/dL', 'umol/L');
    expect(r.ok).toBe(false);
  });
});

describe('buildReviewCommandsFromHistory', () => {
  const history = [
    { date: '14-08-2026', biomarkers: { hdl: 50, triglycerides: 125, ldl: 130, creatinine: 0.9, total_bilirubin: 0.8 } },
    { date: '02-08-2026', biomarkers: { hdl: 1.43, triglycerides: 1.07, ldl: 4.2, creatinine: 100, total_bilirubin: 16 } },
    { date: '05-06-2026', biomarkers: { hdl: 1.43, triglycerides: 1.07, ldl: 4.2, creatinine: 100, total_bilirubin: 16 } },
    { date: '03-04-2024', biomarkers: { hdl: 1.43, triglycerides: 1.07, creatinine: 72, total_bilirubin: 13 } },
  ];

  it('synthesizes SI convert commands when Review omits modificationCommand', () => {
    const cmds = enrichReviewModificationCommands([], history, {
      hdl: 'mmol/L',
      triglycerides: 'mmol/L',
      ldl: 'mmol/L',
      creatinine: 'umol/L',
      total_bilirubin: 'umol/L',
    });
    const byKey = Object.fromEntries(cmds.map((c) => [c.keyName, c]));
    expect(Number(byKey.hdl.newValue)).toBeCloseTo(1.293, 2);
    expect(Number(byKey.triglycerides.newValue)).toBeCloseTo(1.411, 2);
    expect(Number(byKey.ldl.newValue)).toBeCloseTo(3.362, 2);
    expect(Number(byKey.creatinine.newValue)).toBeCloseTo(79.56, 1);
    expect(Number(byKey.total_bilirubin.newValue)).toBeCloseTo(13.68, 1);
    expect(cmds.filter((c) => c.keyName === 'total_bilirubin')).toHaveLength(1);
    expect(cmds.every((c) => c.date === '14-08-2026')).toBe(true);
  });

  it('does not invent commands when history is already one scale', () => {
    const cmds = buildReviewCommandsFromHistory(
      [
        { date: '02-08-2026', biomarkers: { hdl: 1.43 } },
        { date: '05-06-2026', biomarkers: { hdl: 1.5 } },
      ],
      { hdl: 'mmol/L' }
    );
    expect(cmds).toHaveLength(0);
  });
});

describe('applyModificationCommands', () => {
  it('fills omitted newValue via convert table (HDL 50 mg/dL → mmol/L)', () => {
    const cmds = enrichReviewModificationCommands(
      [{ action: 'update_biomarker', keyName: 'hdl', date: '13-08-2026', oldValue: '50' }],
      [
        { date: '13-08-2026', biomarkers: { hdl: 50 } },
        { date: '02-08-2026', biomarkers: { hdl: 1.43 } },
      ],
      { hdl: 'mmol/L' }
    );
    expect(Number(cmds[0].newValue)).toBeCloseTo(1.293, 2);
  });

  it('updates a DD-MM-YYYY row from ISO command date', () => {
    const { history, applied } = applyModificationCommands(
      [{ id: '1', date: '13-08-2026', biomarkers: { hdl: 50 } }],
      [{ action: 'update_biomarker', keyName: 'hdl', date: '2026-08-13', newValue: '1.3' }]
    );
    expect(applied).toBe(1);
    expect(Number(history[0].biomarkers.hdl)).toBeCloseTo(1.3);
  });
});

describe('overlay fingerprint / calibrator gate', () => {
  it('bands age', () => {
    expect(overlayAgeBand(28)).toBe('20-29');
    expect(overlayAgeBand(30)).toBe('30-39');
  });
  it('skips sodium (no rangeVariesBy)', () => {
    expect(getRangeVariesBy('serum_sodium').length).toBe(0);
    expect(shouldRunCalibrator('serum_sodium', { age: 28, gender: 'Male', ethnicity: 'Chinese' })).toBe(false);
  });
  it('runs HDL when overlay fingerprint missing', () => {
    expect(shouldRunCalibrator('hdl', { age: 28, gender: 'Male', ethnicity: 'Chinese' })).toBe(true);
  });
  it('skips HDL when fingerprint matches', () => {
    const fp = overlayFingerprint({ age: 28, gender: 'Male', ethnicity: 'Chinese' });
    expect(shouldRunCalibrator('hdl', { age: 28, gender: 'Male', ethnicity: 'Chinese' }, { fingerprint: fp })).toBe(false);
  });
});

describe('filter live for use', () => {
  it('drops pending custom keys from history', () => {
    const profile = {
      customBiomarkers: { mystery: { needsApproval: true, name: 'Mystery', unit: 'u', normalRange: '1-2' } },
    };
    const history = [{ id: '1', date: '2026-08-13', biomarkers: { mystery: 3, hba1c: 35 } }];
    const filtered = filterHistoryForUse(history, profile);
    expect(filtered[0].biomarkers.mystery).toBeUndefined();
    expect(filtered[0].biomarkers.hba1c).toBe(35);
  });
});

describe('attachObservationMeta', () => {
  it('stores raw unit on the log', () => {
    const log: any = { id: '1', date: '2026-08-13', biomarkers: { hdl: 50 } };
    attachObservationMeta(log, 'hdl', { unit: 'mg/dL', rawValue: 50 });
    expect(getObservationUnit(log, 'hdl')).toBe('mg/dL');
  });
});

describe('resolveAgentDestination', () => {
  it('folds retired agents onto owners', () => {
    expect(resolveAgentDestination('agent5')).toBe('data_review');
    expect(resolveAgentDestination('medical_extract')).toBe('agent1');
    expect(resolveAgentDestination('biomarker_review')).toBe('biomarker_review');
  });
});

describe('isValEmpty', () => {
  it('treats 0 as a real value', () => {
    expect(isValEmpty(0)).toBe(false);
    expect(isValEmpty('0')).toBe(false);
  });
  it('treats blank as empty', () => {
    expect(isValEmpty('')).toBe(true);
    expect(isValEmpty(null)).toBe(true);
  });
});

describe('sanitizeBiomarkerHistoryOnLoad — flag only', () => {
  it('does not rewrite 195 cholesterol', () => {
    const history = [
      { id: '1', date: '08-08-2026', biomarkers: { total_cholesterol: 195 } },
      { id: '2', date: '02-08-2026', biomarkers: { total_cholesterol: 6.1 } },
    ];
    const { history: cleaned, current, fixedCount } = sanitizeBiomarkerHistoryOnLoad(history, {});
    expect(Number(cleaned[0].biomarkers.total_cholesterol)).toBe(195);
    expect(Number(current.total_cholesterol)).toBe(195);
    expect(fixedCount).toBeGreaterThan(0);
  });
});
