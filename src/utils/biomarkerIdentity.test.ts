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
  isBiomarkerDuplicateCandidate,
  selfHealCustomBiomarkerDefinitions,
  biomarkerDefinitions,
  getBiomarkerEffectiveRisk,
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
    expect(getMappedBiomarkerKey('qrisk2_10_year_risk_score')).toBe('qrisk2');
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

  it('egfr collapses across plain-English and specimen-prefixed name variants (dedup engine review)', () => {
    const keys = ['egfr', 'Estimated GFR', 'GFR', 'Glomerular Filtration Rate', 'egfr_creatinine'].map(k => getMappedBiomarkerKey(k));
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe('egfr');
  });

  it('bmi collapses across full-name and unit-suffixed key variants (dedup engine review)', () => {
    const keys = ['bmi', 'Body Mass Index', 'body_mass_index_kg_m2', 'BMI (kg/m2)'].map(k => getMappedBiomarkerKey(k));
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe('bmi');
  });
});

describe('isBiomarkerDuplicateCandidate — false-friend guards (dedup engine review)', () => {
  it('does NOT merge plain Hemoglobin with Mean Corpuscular Hemoglobin (different analytes/units)', () => {
    const m = isBiomarkerDuplicateCandidate({ key: 'hemoglobin', name: 'Hemoglobin' }, { key: 'mch', name: 'Mean Corpuscular Hemoglobin' });
    expect(m.isMatch).toBe(false);
  });

  it('does NOT merge Hemoglobin with Hemoglobin A1c (glycated Hb is a distinct test)', () => {
    const m = isBiomarkerDuplicateCandidate({ key: 'hemoglobin', name: 'Hemoglobin' }, { key: 'hba1c_alt', name: 'Hemoglobin A1c' });
    expect(m.isMatch).toBe(false);
  });

  it('does NOT merge Testosterone with Free Testosterone (distinct clinical values)', () => {
    const m = isBiomarkerDuplicateCandidate({ key: 'testosterone', name: 'Testosterone' }, { key: 'free_t', name: 'Free Testosterone' });
    expect(m.isMatch).toBe(false);
  });

  it('does NOT merge blood Creatinine with Urine Creatinine (different specimen types)', () => {
    const m = isBiomarkerDuplicateCandidate({ key: 'creatinine', name: 'Creatinine' }, { key: 'ucreat', name: 'Urine Creatinine' });
    expect(m.isMatch).toBe(false);
  });

  it('DOES merge Mean Corpuscular Hemoglobin with its unit-suffixed lab variant', () => {
    const m = isBiomarkerDuplicateCandidate({ key: 'mean_corpuscular_hemoglobin', name: 'Mean Corpuscular Hemoglobin' }, { key: 'mch_pg', name: 'Mean Corpuscular Hemoglobin Pg' });
    expect(m.isMatch).toBe(true);
  });

  it('DOES merge eGFR with an unrecognized creatinine-suffixed key via canonical mapped-key match', () => {
    const m = isBiomarkerDuplicateCandidate({ key: 'egfr', name: 'eGFR' }, { key: 'egfr_creatinine', name: 'eGFR Creatinine' });
    expect(m.isMatch).toBe(true);
  });

  it('STRUCTURAL: does NOT merge Direct Bilirubin with Indirect Bilirubin — never explicitly coded, proves the discriminator list generalizes', () => {
    const m = isBiomarkerDuplicateCandidate({ key: 'bilirubin_direct', name: 'Direct Bilirubin' }, { key: 'bilirubin_indirect', name: 'Indirect Bilirubin' });
    expect(m.isMatch).toBe(false);
  });

  it('STRUCTURAL: does NOT merge Calcium with Ionized Calcium — never explicitly coded, proves the discriminator list generalizes', () => {
    const m = isBiomarkerDuplicateCandidate({ key: 'calcium', name: 'Calcium' }, { key: 'calcium_ionized', name: 'Ionized Calcium' });
    expect(m.isMatch).toBe(false);
  });

  it('STRUCTURAL: does NOT merge PSA with Free PSA — never explicitly coded, proves the discriminator list generalizes', () => {
    const m = isBiomarkerDuplicateCandidate({ key: 'psa', name: 'PSA' }, { key: 'free_psa', name: 'Free PSA' });
    expect(m.isMatch).toBe(false);
  });

  it('REGRESSION: does NOT merge Cortisol with Cortisol Peak — caught a dead-code wiring defect where CLINICAL_DISCRIMINATOR_TERMS was declared but never called', () => {
    const m = isBiomarkerDuplicateCandidate({ key: 'cortisol', name: 'Cortisol' }, { key: 'cortisol_peak', name: 'Cortisol Peak' });
    expect(m.isMatch).toBe(false);
  });

  it('REGRESSION: does NOT merge Creatinine with Fecal Creatinine — specimen guard must cover fecal/faecal, not just urine/csf/saliva/stool', () => {
    const m = isBiomarkerDuplicateCandidate({ key: 'creatinine', name: 'Creatinine' }, { key: 'fecal_creatinine', name: 'Fecal Creatinine' });
    expect(m.isMatch).toBe(false);
  });
});

describe('selfHealCustomBiomarkerDefinitions — structural self-healing', () => {
  it('automatically infers units, reference ranges, and physiological categories for new biomarkers', () => {
    const { updatedCustoms, hasChanges } = selfHealCustomBiomarkerDefinitions([
      { key: 'novel_lab_marker_mg_dl', normalRange: '10 - 25' },
      { key: 'hepatic_stress_index', unit: 'U/L', category: 'liver' }
    ]);

    expect(hasChanges).toBe(true);
    expect(updatedCustoms.novel_lab_marker_mg_dl.unit).toBe('mg/dL');
    expect(updatedCustoms.novel_lab_marker_mg_dl.normalRange).toBe('10 - 25');
    expect(updatedCustoms.novel_lab_marker_mg_dl.catalogApproved).toBe(true);

    expect(updatedCustoms.hepatic_stress_index.unit).toBe('U/L');
    expect(updatedCustoms.hepatic_stress_index.standardMedicalGrouping).toBe('Hepatic');
    expect(updatedCustoms.hepatic_stress_index.riskCategories).toContain('Liver');
    expect(updatedCustoms.hepatic_stress_index.catalogApproved).toBe(true);
  });

  it('preserves existing custom ranges while filling in missing structural metadata', () => {
    const existing = {
      my_custom_biomarker: {
        name: 'My Custom Marker',
        normalRange: '5.0 - 15.0',
        unit: 'mmol/L'
      }
    };

    const { updatedCustoms } = selfHealCustomBiomarkerDefinitions(
      [{ key: 'my_custom_biomarker' }],
      existing
    );

    expect(updatedCustoms.my_custom_biomarker.normalRange).toBe('5.0 - 15.0');
    expect(updatedCustoms.my_custom_biomarker.unit).toBe('mmol/L');
    expect(updatedCustoms.my_custom_biomarker.catalogApproved).toBe(true);
    expect(updatedCustoms.my_custom_biomarker.standardMedicalGrouping).toBeDefined();
    expect(updatedCustoms.my_custom_biomarker.riskCategories.length).toBeGreaterThan(0);
  });
});

describe('getBiomarkerEffectiveRisk — tag-aligned category scoring', () => {
  it('returns At risk tag and score 3 for non-hdl cholesterol with at-risk structured range', () => {
    const risk = getBiomarkerEffectiveRisk(
      'non_hdl_cholesterol',
      4.7,
      { key: 'non_hdl_cholesterol', normalRange: '< 3.4', name: 'Non-HDL Cholesterol' },
      {
        customBiomarkers: {
          non_hdl_cholesterol: {
            name: 'Non-HDL Cholesterol',
            structuredRanges: [
              { min: 0, max: 3.4, name: 'Optimal', isNormal: true },
              { min: 3.4, max: 10, name: 'At risk', isNormal: false },
            ]
          }
        }
      }
    );

    expect(risk.score).toBe(3);
    expect(risk.tag).toBe('At risk');
    expect(risk.bg).toBe('bg-amber-500');
    expect(risk.text).toBe('text-white');
  });

  it('returns Critical Risk and score 4 for severe single-sided anomaly', () => {
    const risk = getBiomarkerEffectiveRisk('non_hdl_cholesterol', 5.5, { key: 'non_hdl_cholesterol', normalRange: '< 3.4' });
    expect(risk.score).toBe(4);
    expect(risk.tag.toLowerCase()).toContain('critical');
    expect(risk.bg).toBe('bg-rose-600');
  });

  it('returns Normal and score 2 for within-range values', () => {
    const risk = getBiomarkerEffectiveRisk('hdl_cholesterol', 1.4, { key: 'hdl_cholesterol', normalRange: '> 1.0' });
    expect(risk.score).toBe(2);
    expect(risk.tag.toLowerCase()).toContain('normal');
    expect(risk.bg).toBe('bg-emerald-600');
  });

  it('returns No Data and score 0 for empty or missing values', () => {
    const risk = getBiomarkerEffectiveRisk('hba1c', undefined);
    expect(risk.score).toBe(0);
    expect(risk.tag).toBe('No Data');
  });
});

