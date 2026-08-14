import { describe, it, expect } from 'vitest';
import {
  applyModificationCommands,
  enrichReviewModificationCommands,
  buildReviewCommandsFromHistory,
  convertViaTable,
  handleUnitChange,
  overlayAgeBand,
  overlayFingerprint,
  shouldRunCalibrator,
  getRangeVariesBy,
  resolveAgentDestination,
  filterHistoryForUse,
  filterCurrentForUse,
  formatBiomarkersForPrompt,
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

describe('handleUnitChange (P6)', () => {
  it('relabels unit in profile/custom without modifying history values', () => {
    const profile = { customBiomarkers: { hdl: { name: 'HDL', unit: 'mg/dL' } } };
    const history = [{ id: '1', date: '2026-08-14', biomarkers: { hdl: 50 } }];

    const result = handleUnitChange({
      key: 'hdl',
      fromUnit: 'mg/dL',
      toUnit: 'mmol/L',
      mode: 'relabel',
      profile,
      history: history as any,
    });

    expect(result.convertedCount).toBe(0);
    expect(result.profile.customBiomarkers.hdl.unit).toBe('mmol/L');
    expect(result.history[0].biomarkers.hdl).toBe(50); // Untouched!
    expect(result.history[0].observationMeta).toBeUndefined();
  });

  it('converts history values with convertViaTable and populates observationMeta', () => {
    const profile = { customBiomarkers: { hdl: { name: 'HDL', unit: 'mg/dL' } } };
    const history = [{ id: '1', date: '2026-08-14', biomarkers: { hdl: 50 } }];

    const result = handleUnitChange({
      key: 'hdl',
      fromUnit: 'mg/dL',
      toUnit: 'mmol/L',
      mode: 'convert',
      profile,
      history: history as any,
    });

    expect(result.convertedCount).toBe(1);
    expect(result.profile.customBiomarkers.hdl.unit).toBe('mmol/L');
    expect(Number(result.history[0].biomarkers.hdl)).toBeCloseTo(1.293, 2);
    expect(result.history[0].observationMeta?.hdl?.rawValue).toBe(50);
    expect(result.history[0].observationMeta?.hdl?.rawUnit).toBe('mg/dL');
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

  it('applies the five convert commands onto 14-08-2026 while older SI rows remain unchanged', () => {
    const history = [
      { id: '1', date: '14-08-2026', biomarkers: { hdl: 50, triglycerides: 125, ldl: 130, creatinine: 0.9, total_bilirubin: 0.8 } },
      { id: '2', date: '02-08-2026', biomarkers: { hdl: 1.43, triglycerides: 1.07, ldl: 4.2, creatinine: 100, total_bilirubin: 16 } },
      { id: '3', date: '05-06-2026', biomarkers: { hdl: 1.43, triglycerides: 1.07, ldl: 4.2, creatinine: 100, total_bilirubin: 16 } },
      { id: '4', date: '03-04-2024', biomarkers: { hdl: 1.43, triglycerides: 1.07, creatinine: 72, total_bilirubin: 13 } },
    ];
    const catalogUnits = {
      hdl: 'mmol/L',
      triglycerides: 'mmol/L',
      ldl: 'mmol/L',
      creatinine: 'umol/L',
      total_bilirubin: 'umol/L',
    };
    const { history: afterApply, applied } = applyModificationCommands(history as any, [], catalogUnits);
    expect(applied).toBe(5);

    // 14-08-2026 must be converted to exact locked SI values
    const log14 = afterApply.find((h) => h.date === '14-08-2026')!;
    expect(Number(log14.biomarkers.hdl)).toBeCloseTo(1.293, 2);
    expect(Number(log14.biomarkers.triglycerides)).toBeCloseTo(1.411, 2);
    expect(Number(log14.biomarkers.ldl)).toBeCloseTo(3.362, 2);
    expect(Number(log14.biomarkers.creatinine)).toBeCloseTo(79.56, 1);
    expect(Number(log14.biomarkers.total_bilirubin)).toBeCloseTo(13.68, 1);

    // rawValues must be captured on observationMeta
    expect(log14.observationMeta?.hdl?.rawValue).toBe(50);
    expect(log14.observationMeta?.triglycerides?.rawValue).toBe(125);
    expect(log14.observationMeta?.ldl?.rawValue).toBe(130);
    expect(log14.observationMeta?.creatinine?.rawValue).toBe(0.9);
    expect(log14.observationMeta?.total_bilirubin?.rawValue).toBe(0.8);

    // Older SI dates must remain unchanged
    const log02 = afterApply.find((h) => h.date === '02-08-2026')!;
    expect(log02.biomarkers).toEqual({ hdl: 1.43, triglycerides: 1.07, ldl: 4.2, creatinine: 100, total_bilirubin: 16 });

    const log05 = afterApply.find((h) => h.date === '05-06-2026')!;
    expect(log05.biomarkers).toEqual({ hdl: 1.43, triglycerides: 1.07, ldl: 4.2, creatinine: 100, total_bilirubin: 16 });

    const log03 = afterApply.find((h) => h.date === '03-04-2024')!;
    expect(log03.biomarkers.total_bilirubin).toBe(13);
    expect(log03.biomarkers.creatinine).toBe(72);
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
  it('runs calibrator for 25-yo female, skips on rerun with stored overlay, runs again when age changes to 55', () => {
    const profile25 = { age: 25, gender: 'Female', ethnicity: 'Asian' };
    expect(shouldRunCalibrator('hdl', profile25, null)).toBe(true);

    const overlay = {
      fingerprint: overlayFingerprint(profile25),
      sameAsCatalog: true,
      range: '> 1.3 mmol/L',
    };
    // Rerun with stored overlay: skipped
    expect(shouldRunCalibrator('hdl', profile25, overlay)).toBe(false);

    // Change age to 55: fingerprint changes from 20-29|f|asian to 50-59|f|asian -> runs again
    const profile55 = { age: 55, gender: 'Female', ethnicity: 'Asian' };
    expect(shouldRunCalibrator('hdl', profile55, overlay)).toBe(true);
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

  it('drops 195 cholesterol from dietitian prompt context when flagged in history', () => {
    const profile = {};
    const history = [
      { id: 'l1', date: '08-08-2026', biomarkers: { total_cholesterol: 195, hdl: 1.3 } },
    ];
    const current = { total_cholesterol: 195, hdl: 1.3 };

    const filtered = filterCurrentForUse(current, profile, history);
    expect(filtered.total_cholesterol).toBeUndefined();
    expect(filtered.hdl).toBe(1.3);

    const promptContext = formatBiomarkersForPrompt(current, profile, history);
    expect(promptContext).not.toContain('195');
    expect(promptContext).toContain('"hdl":1.3');
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

  it('routes data_accuracy to comparison modal payload', () => {
    const route = resolveAgentDestination('data_accuracy', { comparisonRows: [{ key: 'hdl', val1: 50, val2: 1.3 }] });
    expect(typeof route).toBe('object');
    expect((route as any).destination).toBe('comparison_modal');
    expect((route as any).requiresApproval).toBe(true);
    expect((route as any).payload.comparisonRows).toHaveLength(1);
  });

  it('routes biomarker_review with proposal.range to customRanges proposal (NOT silent write)', () => {
    const route = resolveAgentDestination('biomarker_review', {
      biomarkerKey: 'hdl',
      proposal: { range: '1.0 - 2.0 mmol/L' }
    });
    expect(typeof route).toBe('object');
    expect((route as any).destination).toBe('custom_ranges_proposal');
    expect((route as any).requiresApproval).toBe(true);
    expect((route as any).silentWrite).toBe(false);
    expect((route as any).targetKey).toBe('hdl');
  });

  it('routes name_consolidation to remap proposal', () => {
    const route = resolveAgentDestination('name_consolidation', {
      proposal: { from: 'Total Chol', to: 'total_cholesterol' }
    });
    expect(typeof route).toBe('object');
    expect((route as any).destination).toBe('name_remap_proposal');
    expect((route as any).requiresApproval).toBe(true);
  });
});

describe('isValEmpty', () => {
  it('treats 0 and 0.0 as real values', () => {
    expect(isValEmpty(0)).toBe(false);
    expect(isValEmpty('0')).toBe(false);
    expect(isValEmpty(0.0)).toBe(false);
  });
  it('treats blank, null, undefined, and NaN as empty', () => {
    expect(isValEmpty('')).toBe(true);
    expect(isValEmpty('   ')).toBe(true);
    expect(isValEmpty(null)).toBe(true);
    expect(isValEmpty(undefined)).toBe(true);
    expect(isValEmpty(NaN)).toBe(true);
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
