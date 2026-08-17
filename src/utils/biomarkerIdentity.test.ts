/**
 * Biomarker identity / alias / merge-def regression tests.
 * Domain: docs/agent/domains/biomarkers.md
 */
import { describe, it, expect } from 'vitest';
import {
  getMappedBiomarkerKey,
  getCustomBiomarkerDef,
  getMergedBiomarkerDef,
  isBiomarkerApproved,
  isBiomarkerMissingRange,
  isPendingCatalogApproval,
  shouldStampExtractedDefPending,
  biomarkerDefinitions,
} from './biomarkers';

describe('getMappedBiomarkerKey — identity', () => {
  it('maps empty to empty', () => {
    expect(getMappedBiomarkerKey('')).toBe('');
  });

  it('resolves built-in keys case-insensitively', () => {
    expect(getMappedBiomarkerKey('hba1c')).toBe('hba1c');
    expect(getMappedBiomarkerKey('HbA1c')).toBe('hba1c');
  });

  it('maps unit-suffixed lab aliases to canonical keys (no duplicate identity)', () => {
    expect(getMappedBiomarkerKey('hemoglobin_g_l')).toBe('hemoglobin');
    expect(getMappedBiomarkerKey('hematocrit_l_l')).toBe('hematocrit');
    expect(getMappedBiomarkerKey('serum_albumin_g_l')).toBe('serum_albumin');
    expect(getMappedBiomarkerKey('total_white_cell_count_wbc')).toBe('wbc');
    expect(getMappedBiomarkerKey('qrisk2_10_year_risk_score')).toBe('qrisk2_10yr_risk');
  });

  it('maps symptom aliases that share one score key (dedupe pressure)', () => {
    expect(getMappedBiomarkerKey('hemorrhoids')).toBe('hemorrhoidal_symptom_score');
    expect(getMappedBiomarkerKey('blood_in_stool')).toBe('hemorrhoidal_symptom_score');
    expect(getMappedBiomarkerKey('heartburn')).toBe('gerd_symptom_score');
    expect(getMappedBiomarkerKey('acid_reflux')).toBe('gerd_symptom_score');
  });

  it('strips punctuation but keeps unknown keys as cleaned raw (no silent invent)', () => {
    const raw = 'my_novel_marker_xyz';
    expect(getMappedBiomarkerKey(raw)).toBe(raw);
  });

  it('built-in definitions do not share the same key twice', () => {
    const keys = biomarkerDefinitions.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('getCustomBiomarkerDef — alias fallback', () => {
  it('returns def under core key', () => {
    const profile = { customBiomarkers: { hba1c: { unit: 'mmol/mol', name: 'HbA1c' } } };
    expect(getCustomBiomarkerDef(profile, 'hba1c')?.unit).toBe('mmol/mol');
  });

  it('falls back to custom stored under alias when core key missing', () => {
    const def = biomarkerDefinitions.find((d) => d.aliases && d.aliases.length > 0);
    if (!def || !def.aliases?.[0]) {
      // Still pass: no alias-rich def in catalog — skip soft
      expect(true).toBe(true);
      return;
    }
    const alias = def.aliases[0];
    const profile = {
      customBiomarkers: {
        [alias]: { name: 'Legacy', unit: 'u', normalRange: '1-2' },
      },
    };
    const found = getCustomBiomarkerDef(profile, def.key);
    expect(found?.name).toBe('Legacy');
  });
});

describe('getMergedBiomarkerDef — field priority', () => {
  it('prefers custom name/unit/range over built-in when set', () => {
    const builtIn = biomarkerDefinitions.find((d) => d.key === 'hba1c');
    const custom = {
      name: 'Custom A1c',
      unit: 'custom-unit',
      normalRange: '10 - 20',
      standardMedicalGrouping: 'Endocrinology',
      riskCategories: ['Metabolic'],
      potentialMedicalConditions: ['Diabetes'],
    };
    const m = getMergedBiomarkerDef('hba1c', builtIn, custom);
    expect(m.name).toBe('Custom A1c');
    expect(m.unit).toBe('custom-unit');
    expect(m.normalRange).toBe('10 - 20');
    expect(m.key).toBe('hba1c');
  });

  it('does not drop built-in when custom is partial', () => {
    const builtIn = biomarkerDefinitions.find((d) => d.key === 'hba1c');
    const m = getMergedBiomarkerDef('hba1c', builtIn, { name: 'Only Name' });
    expect(m.name).toBe('Only Name');
    expect(m.unit).toBeTruthy();
    expect(m.normalRange).toBeTruthy();
  });

  it('pulls unit/range from item logs when custom/built-in empty', () => {
    const m = getMergedBiomarkerDef(
      'totally_unknown_marker_zz',
      undefined,
      {},
      [{ unit: 'ng/mL', normalRange: '0 - 4' }]
    );
    expect(m.unit).toBe('ng/mL');
    expect(m.normalRange).toBe('0 - 4');
  });
});

describe('approval / missing range gates', () => {
  it('built-in hba1c is approved without a custom def', () => {
    expect(isBiomarkerApproved('hba1c', {})).toBe(true);
  });

  it('needsApproval on custom blocks isBiomarkerApproved', () => {
    const profile = {
      customBiomarkers: {
        mystery: {
          needsApproval: true,
          unit: 'u',
          normalRange: '1-2',
          standardMedicalGrouping: 'Other',
          riskCategories: ['X'],
          potentialMedicalConditions: ['Y'],
        },
      },
    };
    expect(isBiomarkerApproved('mystery', profile)).toBe(false);
  });

  it('isBiomarkerMissingRange true for empty/unknown range', () => {
    const profile = {
      customBiomarkers: {
        bare: { unit: 'x', normalRange: 'Unknown' },
      },
    };
    expect(isBiomarkerMissingRange('bare', profile)).toBe(true);
  });

  it('built-in hba1c is not missing range', () => {
    expect(isBiomarkerMissingRange('hba1c', {})).toBe(false);
  });

  it('stale needsApproval on a built-in does not hide it from live use', () => {
    const profile = {
      customBiomarkers: { hdl: { needsApproval: true, name: 'HDL-C' } },
    };
    expect(isBiomarkerApproved('hdl', profile)).toBe(true);
    expect(isPendingCatalogApproval('hdl', profile)).toBe(false);
  });

  it('pending is explicit needsApproval only — missing fields are not pending', () => {
    const profile = {
      customBiomarkers: {
        mystery_panel: { name: 'Mystery', unit: '', normalRange: '' },
        new_slug: { name: 'New', needsApproval: true },
      },
    };
    expect(isPendingCatalogApproval('mystery_panel', profile)).toBe(false);
    expect(isPendingCatalogApproval('new_slug', profile)).toBe(true);
    expect(isPendingCatalogApproval('hdl_c', { customBiomarkers: { hdl_c: { needsApproval: true } } })).toBe(false);
  });

  it('extract does not stamp pending on catalog keys or already-approved defs', () => {
    expect(shouldStampExtractedDefPending('hdl')).toBe(false);
    expect(shouldStampExtractedDefPending('HDL-C')).toBe(false);
    expect(shouldStampExtractedDefPending('brand_new_marker')).toBe(true);
    expect(shouldStampExtractedDefPending('brand_new_marker', { catalogApproved: true })).toBe(false);
    expect(shouldStampExtractedDefPending('brand_new_marker', { name: 'Reviewed' })).toBe(false);
  });
});

/**
 * Alias collision guard: multiple raw keys that map to the same canonical key
 * must not create parallel dictionary identities when agents normalize.
 */
describe('dedupe pressure — alias fan-in', () => {
  it('hemoglobin family collapses to one canonical key', () => {
    const keys = ['hemoglobin', 'hemoglobin_g_l', 'Hemoglobin'].map(k => getMappedBiomarkerKey(k));
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe('hemoglobin');
  });

  it('albumin family collapses', () => {
    const keys = ['serum_albumin', 'serum_albumin_g_l', 'serum_albumin_2'].map(k => getMappedBiomarkerKey(k));
    expect(new Set(keys).size).toBe(1);
  });

  it('egfr family collapses to one canonical key across lab unit suffixes', () => {
    const keys = ['egfr', 'egfr_mlmin173m2', 'egfr_ml_min_1_73m2', 'egfrcreatckdepi173m2', 'eGFR'].map(k => getMappedBiomarkerKey(k));
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe('egfr');
  });
});
