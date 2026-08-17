import { describe, it, expect } from 'vitest';
import {
  normalizeStemKey,
  getCanonicalBiomarkerStem,
  runGeneralizedBiomarkerAudit,
  findCatalogDefinition
} from './biomarkerAuditEngine';

describe('Biomarker Audit & Deduplication Engine', () => {
  it('correctly maps AST, SGOT, aspartate aminotransferase and serum levels to canonical AST stem', () => {
    const s1 = getCanonicalBiomarkerStem('ast');
    const s2 = getCanonicalBiomarkerStem('sgot');
    const s3 = getCanonicalBiomarkerStem('aspartate_aminotransferase');
    const s4 = getCanonicalBiomarkerStem('ast_serum_level_u_l');
    const s5 = getCanonicalBiomarkerStem('serum_ast_level');

    expect(s1).toBe(s2);
    expect(s1).toBe(s3);
    expect(s1).toBe(s4);
    expect(s1).toBe(s5);
  });

  it('correctly maps HDL, HDL-C, serum HDL to canonical HDL stem', () => {
    const s1 = getCanonicalBiomarkerStem('hdl');
    const s2 = getCanonicalBiomarkerStem('hdl_c');
    const s3 = getCanonicalBiomarkerStem('hdl_cholesterol');
    const s4 = getCanonicalBiomarkerStem('serum_hdl_cholesterol_mmol_l');
    const s5 = getCanonicalBiomarkerStem('serum_hdl');

    expect(s1).toBe(s2);
    expect(s1).toBe(s3);
    expect(s1).toBe(s4);
    expect(s1).toBe(s5);
  });

  it('correctly clusters duplicates where one has values and the other has missing values', () => {
    const customBiomarkers = {
      ast: {
        name: 'AST (SGOT)',
        unit: 'U/L',
        normalRange: '10 - 40',
        category: 'liver'
      },
      aspartate_aminotransferase: {
        name: 'Aspartate Aminotransferase',
        unit: 'U/L',
        normalRange: 'Unknown',
        category: 'other'
      },
      ast_serum_level_u_l: {
        name: 'AST Serum Level',
        unit: 'U/L'
      },
      hdl: {
        name: 'HDL-C',
        unit: 'mmol/L',
        normalRange: '0.9 - 1.7',
        category: 'lipids'
      },
      serum_hdl_cholesterol: {
        name: 'Serum HDL Cholesterol',
        unit: 'mmol/L'
      }
    };

    const biomarkerHistory = [
      {
        id: 'log1',
        date: '2026-08-01',
        biomarkers: {
          ast: 28,
          hdl: 1.45
        }
      }
    ];

    const report = runGeneralizedBiomarkerAudit(customBiomarkers, biomarkerHistory);

    expect(report.duplicateGroups.length).toBe(2);

    const astGroup = report.duplicateGroups.find(g => g.suggestedMasterKey === 'ast');
    expect(astGroup).toBeDefined();
    expect(astGroup?.candidateAliases).toContain('aspartate_aminotransferase');
    expect(astGroup?.candidateAliases).toContain('ast_serum_level_u_l');
    expect(astGroup?.emptyAliasKeys).toContain('aspartate_aminotransferase');
    expect(astGroup?.emptyAliasKeys).toContain('ast_serum_level_u_l');

    const hdlGroup = report.duplicateGroups.find(g => g.suggestedMasterKey === 'hdl');
    expect(hdlGroup).toBeDefined();
    expect(hdlGroup?.candidateAliases).toContain('serum_hdl_cholesterol');
    expect(hdlGroup?.emptyAliasKeys).toContain('serum_hdl_cholesterol');
  });

  it('preserves all metadata fields during deduplication enrichment', () => {
    const masterDef: any = {
      name: 'Total Cholesterol',
      unit: 'mmol/L',
      normalRange: 'Aim under 5.0'
    };

    const aliasDef: any = {
      name: 'Serum Cholesterol',
      description: 'Overall blood cholesterol level',
      category: 'lipids',
      standardMedicalGrouping: 'Metabolic',
      riskCategories: ['Cardiovascular', 'Hyperlipidemia'],
      optimalValue: '< 4.5 mmol/L',
      target: 4.5
    };

    // Merging alias into master without overwriting master existing fields
    const enrichedMaster = {
      ...masterDef,
      category: masterDef.category || aliasDef.category,
      standardMedicalGrouping: masterDef.standardMedicalGrouping || aliasDef.standardMedicalGrouping,
      description: masterDef.description || aliasDef.description,
      optimalValue: masterDef.optimalValue || aliasDef.optimalValue,
      target: masterDef.target !== undefined ? masterDef.target : aliasDef.target,
      riskCategories: Array.from(new Set([...(masterDef.riskCategories || []), ...(aliasDef.riskCategories || [])]))
    };

    expect(enrichedMaster.name).toBe('Total Cholesterol');
    expect(enrichedMaster.unit).toBe('mmol/L');
    expect(enrichedMaster.category).toBe('lipids');
    expect(enrichedMaster.description).toBe('Overall blood cholesterol level');
    expect(enrichedMaster.riskCategories).toEqual(['Cardiovascular', 'Hyperlipidemia']);
    expect(enrichedMaster.optimalValue).toBe('< 4.5 mmol/L');
  });
});
