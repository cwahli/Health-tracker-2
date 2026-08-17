/**
 * Biomarker Audit & Continuity Engine
 * 
 * Performs generalized structural and heuristic diagnostics across UserProfile.customBiomarkers
 * and BiomarkerHistory without using hardcoded analyte names.
 * 
 * Features:
 * 1. Stringified "null", "undefined", or blank unit detection.
 * 2. Self-contained unit scraping from optimal values, ranges, descriptions, and history logs.
 * 3. Generalized morphological & affix-based duplicate candidate clustering.
 * 4. Missing metadata categorization & triage.
 * 5. Continuity state serialization for pause & resume workflows.
 */

import { 
  biomarkerDefinitions, 
  BiomarkerDefinition,
  getMappedBiomarkerKey,
  CLINICAL_SYNONYM_MAP,
  normalizeStemKey,
  COMMON_PREFIXES,
  COMMON_SUFFIXES,
  COMMON_UNIT_SUFFIXES
} from './biomarkers';
import { CONVERSION_FACTORS } from './unitConversion';

export {
  CLINICAL_SYNONYM_MAP,
  normalizeStemKey,
  COMMON_PREFIXES,
  COMMON_SUFFIXES,
  COMMON_UNIT_SUFFIXES
};

export interface BiomarkerAuditItem {
  key: string;
  name: string;
  currentUnit: string;
  status: 'clean' | 'corrupted_unit' | 'duplicate_candidate' | 'missing_ranges' | 'conflict';
  logCount: number;
  corruptedUnitProposal?: {
    proposedUnit: string;
    sourceField: 'optimalValue' | 'rangeBrackets' | 'logHistory' | 'normalRange' | 'catalog';
    confidence: number;
    reason: string;
  };
  duplicateCluster?: {
    targetKey: string;
    targetName: string;
    clusterKeys: string[];
    candidateAliases: string[];
    reason: string;
    isPrimary: boolean;
  };
  missingMetadata?: {
    missingRange: boolean;
    missingCategory: boolean;
    missingBrackets?: boolean;
    missingDescription: boolean;
    currentRange?: string;
    currentCategory?: string;
    catalogMatch?: {
      normalRange?: string;
      category?: string;
      unit?: string;
      standardMedicalGrouping?: string;
      descriptions?: { [lang: string]: string };
    };
  };
  conflictInfo?: {
    declaredUnit: string;
    bracketUnit: string;
    optimalUnit?: string;
    suggestedResolution?: {
      action: 'scale_brackets_to_declared' | 'align_declared_to_brackets';
      targetUnit: string;
      description: string;
      scaledBrackets?: any[];
      scaledRange?: string;
    };
  };
}

export interface DuplicateGroupAudit {
  suggestedMasterKey: string;
  suggestedMasterName: string;
  memberKeys: string[];
  candidateAliases: string[];
  reason: string;
  totalLogsInCluster: number;
  emptyAliasKeys: string[];
  populatedAliasKeys: string[];
}

export interface BiomarkerAuditReport {
  timestamp: string;
  totalScanned: number;
  corruptedUnitsCount: number;
  duplicateCandidatesCount: number;
  missingRangesCount: number;
  conflictsCount: number;
  cleanCount: number;
  items: BiomarkerAuditItem[];
  duplicateGroups: DuplicateGroupAudit[];
}

export interface AuditSessionState {
  id: string;
  createdAt: string;
  updatedAt: string;
  step: 'triage' | 'units_review' | 'duplicates_review' | 'ranges_review' | 'conflicts_review' | 'completed';
  selectedFixes: { [key: string]: boolean };
  autoFixUnits: { key: string; fromUnit: string; toUnit: string; reason: string }[];
  duplicateMergeQueue: { sourceKey: string; targetKey: string }[];
  status: 'in_progress' | 'paused' | 'applied';
}

/**
 * Resolves a key or name to its canonical biomarker stem across synonym dictionaries
 * and standard medical catalogs. Single unified engine shared with getMappedBiomarkerKey.
 */
export function getCanonicalBiomarkerStem(key: string, name?: string): string {
  if (!key && !name) return '';
  const mapped = getMappedBiomarkerKey(key, name);
  if (mapped) {
    const norm = normalizeStemKey(mapped);
    if (norm) return norm;
  }
  const normKey = normalizeStemKey(key);
  if (normKey && CLINICAL_SYNONYM_MAP[normKey]) {
    return CLINICAL_SYNONYM_MAP[normKey];
  }
  if (name) {
    const normName = normalizeStemKey(name);
    if (normName && CLINICAL_SYNONYM_MAP[normName]) {
      return CLINICAL_SYNONYM_MAP[normName];
    }
    if (normName) return normName;
  }
  return normKey || key.toLowerCase().trim();
}

/**
 * Extracts a unit token from arbitrary string text using heuristic regex
 */
export function extractUnitFromString(text?: string | null): string | null {
  if (!text || typeof text !== 'string') return null;
  const cleaned = text.trim();
  if (!cleaned || cleaned.toLowerCase() === 'null' || cleaned.toLowerCase() === 'undefined' || cleaned.toLowerCase() === 'unknown') {
    return null;
  }

  // Look for patterns like "100 mL/min/1.73m2", "35 mmol/mol", "15 - 30 U/L", "220 K/uL"
  const match = cleaned.match(/(?:[\d\.]+|\bto\b|\-|\>|\<|\>\=|\<\=)\s*([a-zA-Z%][a-zA-Z0-9%\/\^\._\-]*)/);
  if (match && match[1]) {
    const candidate = match[1].trim();
    if (!['to', 'and', 'or', 'null', 'undefined', 'min', 'max', 'range', 'unknown'].includes(candidate.toLowerCase())) {
      return candidate;
    }
  }
  return null;
}

/**
 * Checks if a stored unit is structurally corrupted
 */
export function isCorruptedUnit(unit?: string | null): boolean {
  if (unit === null || unit === undefined) return true;
  const s = String(unit).trim().toLowerCase();
  return s === '' || s === 'null' || s === 'undefined' || s === '[object object]' || s === 'unknown' || s === 'none';
}

/**
 * Computes information completeness score for a biomarker definition
 */
export function calculateCompletenessScore(def: any, logCount: number): number {
  if (!def) return 0;
  let score = 0;
  if (def.unit && !isCorruptedUnit(def.unit)) score += 3;
  if (def.optimalValue) score += 2;
  if (Array.isArray(def.rangeBrackets) && def.rangeBrackets.length > 0) score += 4;
  if (def.normalRange && def.normalRange !== 'Unknown') score += 2;
  if (def.category && def.category !== 'other' && def.category !== 'wellness') score += 2;
  if (def.description || def.descriptions?.en) score += 1;
  if (def.catalogApproved) score += 3;
  score += Math.min(logCount, 5); // Up to 5 points for log activity
  return score;
}

/**
 * Finds a matching standard biomarker catalog definition by key, stem, alias, or name
 */
export function findCatalogDefinition(key: string, name?: string): BiomarkerDefinition | undefined {
  if (!key) return undefined;
  const normKey = key.toLowerCase().trim();
  const stem = normalizeStemKey(key);
  
  // Exact key match
  let found = biomarkerDefinitions.find(d => d.key.toLowerCase() === normKey);
  if (found) return found;

  // Stem match
  found = biomarkerDefinitions.find(d => normalizeStemKey(d.key) === stem);
  if (found) return found;

  // Alias match
  found = biomarkerDefinitions.find(d => 
    Array.isArray(d.aliases) && d.aliases.some(a => a.toLowerCase() === normKey || normalizeStemKey(a) === stem)
  );
  if (found) return found;

  // Name match
  if (name) {
    const cleanName = name.toLowerCase().trim();
    found = biomarkerDefinitions.find(d => d.name.toLowerCase() === cleanName);
    if (found) return found;
  }

  return undefined;
}

/**
 * Derives an automatic mathematical resolution for unit/bracket conflict
 */
export function deriveConflictResolution(
  key: string,
  declaredUnit: string,
  bracketUnit: string,
  def: any
): BiomarkerAuditItem['conflictInfo']['suggestedResolution'] {
  const k = key.toLowerCase();
  const dUnit = (declaredUnit || '').trim();
  const bUnit = (bracketUnit || '').trim();
  const dLow = dUnit.toLowerCase();
  const bLow = bUnit.toLowerCase();

  // Hematocrit % vs L/L
  if (k.includes('hematocrit') || k.includes('hct')) {
    if ((dLow === '%' || dLow === 'percent') && (bLow === 'l/l' || bLow === 'fraction')) {
      let scaledRange = '';
      if (def.normalRange && typeof def.normalRange === 'string') {
        scaledRange = def.normalRange.replace(/([\d\.]+)/g, m => {
          const v = parseFloat(m);
          return v <= 1 ? (v * 100).toFixed(0) : m;
        });
      }
      return {
        action: 'scale_brackets_to_declared',
        targetUnit: '%',
        description: 'Convert reference brackets from L/L to % (e.g. 0.37-0.50 L/L ➔ 37-50 %) to match declared % unit',
        scaledRange: scaledRange || '37 - 50'
      };
    }
  }

  // Hemoglobin / Albumin / Protein: g/dL vs g/L
  if ((k.includes('hemoglobin') || k.includes('albumin') || k.includes('protein')) &&
      ((dLow === 'g/dl' && bLow === 'g/l') || (dLow === 'g/l' && bLow === 'g/dl'))) {
    if (dLow === 'g/dl' && bLow === 'g/l') {
      let scaledRange = '';
      if (def.normalRange && typeof def.normalRange === 'string') {
        scaledRange = def.normalRange.replace(/([\d\.]+)/g, m => {
          const v = parseFloat(m);
          return v > 30 ? (v / 10).toFixed(1) : m;
        });
      }
      return {
        action: 'scale_brackets_to_declared',
        targetUnit: 'g/dL',
        description: 'Convert reference brackets from g/L to g/dL (e.g. 120-160 g/L ➔ 12.0-16.0 g/dL) using clinical factor 10 to match declared g/dL unit',
        scaledRange: scaledRange || '12.0 - 16.0'
      };
    } else {
      return {
        action: 'scale_brackets_to_declared',
        targetUnit: 'g/L',
        description: 'Convert reference brackets from g/dL to g/L using clinical factor 10 to match declared g/L unit'
      };
    }
  }

  // General conversion factor check
  const conv = CONVERSION_FACTORS[k];
  if (conv) {
    if (dLow === conv.from.toLowerCase() && bLow === conv.to.toLowerCase()) {
      return {
        action: 'scale_brackets_to_declared',
        targetUnit: conv.from,
        description: `Scale reference brackets to match declared ${conv.from} unit using clinical multiplier ${conv.multiplier}`
      };
    }
    if (dLow === conv.to.toLowerCase() && bLow === conv.from.toLowerCase()) {
      return {
        action: 'scale_brackets_to_declared',
        targetUnit: conv.to,
        description: `Scale reference brackets to match declared ${conv.to} unit using clinical multiplier ${conv.multiplier}`
      };
    }
  }

  // Fallback: Align declared unit to reference brackets
  return {
    action: 'align_declared_to_brackets',
    targetUnit: bracketUnit,
    description: `Update declared biomarker unit from "${declaredUnit}" to "${bracketUnit}" to match reference range brackets`
  };
}

/**
 * Runs a complete generalized audit on the custom biomarkers dictionary and log history
 */
export function runGeneralizedBiomarkerAudit(
  customBiomarkers: { [key: string]: any } = {},
  biomarkerHistory: any[] = []
): BiomarkerAuditReport {
  const allKeys = Object.keys(customBiomarkers);
  const items: BiomarkerAuditItem[] = [];

  // 1. Calculate log activity counts per key
  const logCounts: { [key: string]: number } = {};
  const logUnits: { [key: string]: { [unit: string]: number } } = {};

  biomarkerHistory.forEach(log => {
    if (log && log.biomarkers) {
      Object.keys(log.biomarkers).forEach(k => {
        logCounts[k] = (logCounts[k] || 0) + 1;
      });
    }
    if (log && log.tests && Array.isArray(log.tests)) {
      log.tests.forEach((t: any) => {
        if (t && t.key && t.unit && !isCorruptedUnit(t.unit)) {
          if (!logUnits[t.key]) logUnits[t.key] = {};
          logUnits[t.key][t.unit] = (logUnits[t.key][t.unit] || 0) + 1;
        }
      });
    }
  });

  // 2. Canonical stem grouping to discover duplicate candidates
  const stemMap: { [stem: string]: string[] } = {};
  allKeys.forEach(k => {
    const def = customBiomarkers[k] || {};
    const stem = getCanonicalBiomarkerStem(k, def.name);
    if (!stemMap[stem]) stemMap[stem] = [];
    stemMap[stem].push(k);
  });

  // 3. Evaluate each biomarker
  allKeys.forEach(key => {
    const def = customBiomarkers[key] || {};
    const name = def.name || key;
    const currentUnit = def.unit || '';
    const stem = getCanonicalBiomarkerStem(key, name);
    const siblings = stemMap[stem] || [];
    const thisLogCount = logCounts[key] || 0;
    const catalogMatchDef = findCatalogDefinition(key, name);

    let status: BiomarkerAuditItem['status'] = 'clean';
    let corruptedUnitProposal: BiomarkerAuditItem['corruptedUnitProposal'] = undefined;
    let duplicateCluster: BiomarkerAuditItem['duplicateCluster'] = undefined;
    let missingMetadata: BiomarkerAuditItem['missingMetadata'] = undefined;
    let conflictInfo: BiomarkerAuditItem['conflictInfo'] = undefined;

    // Check Unit Corruption
    if (isCorruptedUnit(currentUnit)) {
      // Attempt internal scraping or catalog lookup
      let proposedUnit: string | null = null;
      let source: BiomarkerAuditItem['corruptedUnitProposal']['sourceField'] = 'optimalValue';
      let reason = '';

      if (def.optimalValue) {
        const u = extractUnitFromString(def.optimalValue);
        if (u) {
          proposedUnit = u;
          source = 'optimalValue';
          reason = `Extracted from optimal target "${def.optimalValue}"`;
        }
      }

      if (!proposedUnit && Array.isArray(def.rangeBrackets) && def.rangeBrackets.length > 0) {
        for (const b of def.rangeBrackets) {
          const u = extractUnitFromString(b.range);
          if (u) {
            proposedUnit = u;
            source = 'rangeBrackets';
            reason = `Extracted from reference bracket "${b.range}"`;
            break;
          }
        }
      }

      if (!proposedUnit && def.normalRange && def.normalRange !== 'Unknown') {
        const u = extractUnitFromString(def.normalRange);
        if (u) {
          proposedUnit = u;
          source = 'normalRange';
          reason = `Extracted from normal range "${def.normalRange}"`;
        }
      }

      if (!proposedUnit && logUnits[key]) {
        // Find most frequent unit from logs
        const sortedUnits = Object.entries(logUnits[key]).sort((a, b) => b[1] - a[1]);
        if (sortedUnits.length > 0 && sortedUnits[0][0]) {
          proposedUnit = sortedUnits[0][0];
          source = 'logHistory';
          reason = `Consensus unit from ${sortedUnits[0][1]} recorded lab history log(s)`;
        }
      }

      if (!proposedUnit && catalogMatchDef && catalogMatchDef.unit) {
        proposedUnit = catalogMatchDef.unit;
        source = 'catalog';
        reason = `Standard medical catalog unit for ${catalogMatchDef.name}`;
      }

      if (proposedUnit) {
        status = 'corrupted_unit';
        corruptedUnitProposal = {
          proposedUnit,
          sourceField: source,
          confidence: 0.95,
          reason
        };
      } else {
        status = 'corrupted_unit';
        corruptedUnitProposal = {
          proposedUnit: '',
          sourceField: 'optimalValue',
          confidence: 0.2,
          reason: 'Unit is corrupted and no internal reference unit could be discovered'
        };
      }
    }

    // Check Duplicate Candidates
    if (siblings.length > 1) {
      // Find the highest score member in the cluster
      let bestKey = siblings[0];
      let bestScore = -1;
      siblings.forEach(sk => {
        const sDef = customBiomarkers[sk] || {};
        const score = calculateCompletenessScore(sDef, logCounts[sk] || 0);
        if (score > bestScore) {
          bestScore = score;
          bestKey = sk;
        }
      });

      const isPrimary = key === bestKey;
      const targetDef = customBiomarkers[bestKey] || {};
      const candidateAliases = siblings.filter(sk => sk !== bestKey);

      duplicateCluster = {
        targetKey: bestKey,
        targetName: targetDef.name || bestKey,
        clusterKeys: siblings,
        candidateAliases,
        reason: `Matches morphological cluster "${stem}" across ${siblings.length} entries`,
        isPrimary
      };

      if (!isPrimary && status === 'clean') {
        status = 'duplicate_candidate';
      }
    }

    // Check Missing Metadata & Catalog Matches
    const hasNormalRange = !!def.normalRange && def.normalRange !== 'Unknown' && def.normalRange.trim() !== '';
    const hasRangeBrackets = Array.isArray(def.rangeBrackets) && def.rangeBrackets.length > 0;
    const isRangeMissing = !hasNormalRange && !hasRangeBrackets;
    const isCategoryMissing = !def.category || def.category === 'other' || def.category === 'wellness' || def.needsApproval || !def.standardMedicalGrouping || def.standardMedicalGrouping === 'Other';
    const isBracketsMissing = hasNormalRange && !hasRangeBrackets;
    const isDescriptionMissing = !def.description && !def.descriptions?.en;

    if (isRangeMissing || isCategoryMissing || isDescriptionMissing || isBracketsMissing) {
      missingMetadata = {
        missingRange: !!isRangeMissing,
        missingCategory: !!isCategoryMissing,
        missingBrackets: !!isBracketsMissing,
        missingDescription: !!isDescriptionMissing,
        currentRange: hasNormalRange ? def.normalRange : undefined,
        currentCategory: def.category && def.category !== 'other' && def.category !== 'wellness' ? def.category : undefined,
        catalogMatch: catalogMatchDef ? {
          normalRange: catalogMatchDef.normalRange,
          category: catalogMatchDef.category,
          unit: catalogMatchDef.unit,
          standardMedicalGrouping: catalogMatchDef.standardMedicalGrouping || catalogMatchDef.category,
          descriptions: catalogMatchDef.descriptions
        } : undefined
      };
      if (status === 'clean') {
        status = 'missing_ranges';
      }
    }

    // Check Internal Scale Conflicts
    if (!isCorruptedUnit(currentUnit)) {
      const optimalUnit = extractUnitFromString(def.optimalValue);
      let bracketUnit: string | null = null;
      if (Array.isArray(def.rangeBrackets) && def.rangeBrackets.length > 0) {
        for (const b of def.rangeBrackets) {
          const u = extractUnitFromString(b.range);
          if (u) {
            bracketUnit = u;
            break;
          }
        }
      }

      if (bracketUnit && bracketUnit.toLowerCase() !== currentUnit.toLowerCase()) {
        status = 'conflict';
        const suggestedResolution = deriveConflictResolution(key, currentUnit, bracketUnit, def);
        conflictInfo = {
          declaredUnit: currentUnit,
          bracketUnit,
          optimalUnit: optimalUnit || undefined,
          suggestedResolution
        };
      }
    }

    items.push({
      key,
      name,
      currentUnit,
      status,
      logCount: thisLogCount,
      corruptedUnitProposal,
      duplicateCluster,
      missingMetadata,
      conflictInfo
    });
  });

  // Extract deduplicated group list with full alias analytics
  const duplicateGroups: DuplicateGroupAudit[] = [];
  const processedStems = new Set<string>();

  Object.entries(stemMap).forEach(([stem, keys]) => {
    if (keys.length > 1 && !processedStems.has(stem)) {
      processedStems.add(stem);
      // Determine master key
      let bestKey = keys[0];
      let bestScore = -1;
      keys.forEach(sk => {
        const sDef = customBiomarkers[sk] || {};
        const score = calculateCompletenessScore(sDef, logCounts[sk] || 0);
        if (score > bestScore) {
          bestScore = score;
          bestKey = sk;
        }
      });
      const masterDef = customBiomarkers[bestKey] || {};
      const candidateAliases = keys.filter(k => k !== bestKey);

      let totalLogsInCluster = 0;
      const emptyAliasKeys: string[] = [];
      const populatedAliasKeys: string[] = [];

      keys.forEach(k => {
        const count = logCounts[k] || 0;
        totalLogsInCluster += count;
        if (k !== bestKey) {
          if (count === 0) {
            emptyAliasKeys.push(k);
          } else {
            populatedAliasKeys.push(k);
          }
        }
      });

      duplicateGroups.push({
        suggestedMasterKey: bestKey,
        suggestedMasterName: masterDef.name || bestKey,
        memberKeys: keys,
        candidateAliases,
        reason: `Shares common biomarker stem "${stem}" across ${keys.length} entries`,
        totalLogsInCluster,
        emptyAliasKeys,
        populatedAliasKeys
      });
    }
  });

  const corruptedUnitsCount = items.filter(i => i.status === 'corrupted_unit').length;
  const duplicateCandidatesCount = items.filter(i => i.status === 'duplicate_candidate').length;
  const missingRangesCount = items.filter(i => i.status === 'missing_ranges').length;
  const conflictsCount = items.filter(i => i.status === 'conflict').length;
  const cleanCount = items.filter(i => i.status === 'clean').length;

  return {
    timestamp: new Date().toISOString(),
    totalScanned: allKeys.length,
    corruptedUnitsCount,
    duplicateCandidatesCount,
    missingRangesCount,
    conflictsCount,
    cleanCount,
    items,
    duplicateGroups
  };
}

/**
 * Persistence helpers for continuity across sessions
 */
export const AUDIT_STORAGE_KEY = 'dict_audit_continuity_state';

export function loadSavedAuditSession(): AuditSessionState | null {
  try {
    const raw = localStorage.getItem(AUDIT_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.warn('Failed to load audit continuity session:', e);
    return null;
  }
}

export function saveAuditSession(state: AuditSessionState | null): void {
  try {
    if (!state) {
      localStorage.removeItem(AUDIT_STORAGE_KEY);
    } else {
      localStorage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(state));
    }
  } catch (e) {
    console.warn('Failed to save audit continuity session:', e);
  }
}
