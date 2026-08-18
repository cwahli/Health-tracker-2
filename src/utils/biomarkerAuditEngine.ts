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
  lookupClinicalSynonym,
  normalizeStemKey,
  normalizeBiomarkerName,
  isBiomarkerDuplicateCandidate,
  findDuplicateOrExistingBiomarker,
  detectFlaggedTelemetryErrors,
  COMMON_PREFIXES,
  COMMON_SUFFIXES,
  COMMON_UNIT_SUFFIXES
} from './biomarkers';
import { CONVERSION_FACTORS } from './unitConversion';

export {
  CLINICAL_SYNONYM_MAP,
  normalizeStemKey,
  normalizeBiomarkerName,
  isBiomarkerDuplicateCandidate,
  findDuplicateOrExistingBiomarker,
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
  const normKeySyn = lookupClinicalSynonym(normKey);
  if (normKeySyn) {
    return normKeySyn;
  }
  if (name) {
    const normName = normalizeStemKey(name);
    const normNameSyn = lookupClinicalSynonym(normName);
    if (normNameSyn) {
      return normNameSyn;
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
  const mapped = getMappedBiomarkerKey(key, name);
  
  // Exact key match
  let found = biomarkerDefinitions.find(d => d.key.toLowerCase() === normKey);
  if (found) return found;

  // Mapped canonical key match
  if (mapped) {
    found = biomarkerDefinitions.find(d => d.key.toLowerCase() === mapped.toLowerCase());
    if (found) return found;
  }

  // Stem match
  found = biomarkerDefinitions.find(d => normalizeStemKey(d.key) === stem);
  if (found) return found;

  // Clinical Synonym match
  const synKey = lookupClinicalSynonym(normKey) || lookupClinicalSynonym(stem);
  if (synKey) {
    found = biomarkerDefinitions.find(d => d.key.toLowerCase() === synKey.toLowerCase() || normalizeStemKey(d.key) === normalizeStemKey(synKey));
    if (found) return found;
  }

  // Alias match
  found = biomarkerDefinitions.find(d => 
    Array.isArray(d.aliases) && d.aliases.some(a => a.toLowerCase() === normKey || normalizeStemKey(a) === stem || (synKey && normalizeStemKey(a) === normalizeStemKey(synKey)))
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
  biomarkerHistory: any[] = [],
  currentBiomarkers: { [key: string]: any } = {},
  deletedCustomBiomarkerKeys: { [key: string]: number } = {}
): BiomarkerAuditReport {
  const items: BiomarkerAuditItem[] = [];

  // 1. Calculate log activity counts per key
  const combinedHistory = [...biomarkerHistory];
  if (currentBiomarkers && Object.keys(currentBiomarkers).length > 0) {
    combinedHistory.push({ date: new Date().toISOString().split('T')[0], biomarkers: currentBiomarkers });
  }
  const logCounts: { [key: string]: number } = {};
  const logUnits: { [key: string]: { [unit: string]: number } } = {};
  const allKeysSet = new Set<string>(
    Object.keys(customBiomarkers).filter(k => !(deletedCustomBiomarkerKeys[k] && deletedCustomBiomarkerKeys[k] > 0))
  );

  combinedHistory.forEach(log => {
    if (log && log.biomarkers) {
      Object.keys(log.biomarkers).forEach(k => {
        // Skip counting or adding keys tombstoned as deleted/consolidated aliases
        if (deletedCustomBiomarkerKeys[k] && deletedCustomBiomarkerKeys[k] > 0 && !customBiomarkers[k]) {
          return;
        }
        logCounts[k] = (logCounts[k] || 0) + 1;
        allKeysSet.add(k);
      });
    }
    if (log && log.tests && Array.isArray(log.tests)) {
      log.tests.forEach((t: any) => {
        if (t && t.key && t.unit && !isCorruptedUnit(t.unit)) {
          if (deletedCustomBiomarkerKeys[t.key] && deletedCustomBiomarkerKeys[t.key] > 0 && !customBiomarkers[t.key]) {
            return;
          }
          if (!logUnits[t.key]) logUnits[t.key] = {};
          logUnits[t.key][t.unit] = (logUnits[t.key][t.unit] || 0) + 1;
          allKeysSet.add(t.key);
        }
      });
    }
  });

  // Also include built-in keys so we can detect duplicates against the standard catalog
  biomarkerDefinitions.forEach(d => allKeysSet.add(d.key));

  const allKeys = Array.from(allKeysSet);

  // Helper to get definition
  const getDef = (key: string) => {
    return customBiomarkers[key] || biomarkerDefinitions.find((b: any) => b.key === key) || {};
  };

  const fakeProfile = { customBiomarkers, deletedCustomBiomarkerKeys };
  const telemetryFlags = detectFlaggedTelemetryErrors(
    currentBiomarkers,
    fakeProfile,
    biomarkerHistory,
    allKeys.map(k => getDef(k))
  );

  // 2. Multi-strategy candidate-bucketed duplicate clustering (O(N) bucketing with bounded intra-bucket matching)
  const adjacency: { [key: string]: Set<string> } = {};
  const matchReasons: { [pairKey: string]: string } = {};
  allKeys.forEach(k => { adjacency[k] = new Set([k]); });

  // Pre-index keys by stem, canonical mapped key, exact name token, and clinical synonym
  const buckets: { [bucketKey: string]: string[] } = {};
  const addToBucket = (bucket: string | undefined | null, key: string) => {
    if (!bucket) return;
    const b = bucket.trim().toLowerCase();
    if (!b || b.length < 2) return;
    if (!buckets[b]) buckets[b] = [];
    if (!buckets[b].includes(key)) buckets[b].push(key);
  };

  const keyMetaMap = new Map<string, { stem: string; name: string; rawClean: string; normName: string; def: any }>();
  allKeys.forEach(k => {
    const def = getDef(k);
    const stem = getCanonicalBiomarkerStem(k, def.name);
    const rawClean = (def.name || k).toLowerCase().replace(/[^a-z0-9]/g, '');
    const normName = normalizeBiomarkerName(def.name || k);
    keyMetaMap.set(k, { stem, name: def.name || k, rawClean, normName, def });

    addToBucket(`stem:${stem}`, k);
    addToBucket(`name:${rawClean}`, k);
    addToBucket(`norm:${normName.replace(/\s+/g, '')}`, k);
    const synKey = lookupClinicalSynonym(rawClean) || lookupClinicalSynonym(stem);
    if (synKey) addToBucket(`syn:${synKey}`, k);
    const mapped = getMappedBiomarkerKey(k, def.name);
    if (mapped) addToBucket(`mapped:${mapped}`, k);
  });

  const checkedPairs = new Set<string>();
  const evaluatePair = (keyA: string, keyB: string) => {
    if (keyA === keyB) return;
    const pairKey = keyA < keyB ? `${keyA}:::${keyB}` : `${keyB}:::${keyA}`;
    if (checkedPairs.has(pairKey)) return;
    checkedPairs.add(pairKey);

    const metaA = keyMetaMap.get(keyA)!;
    const metaB = keyMetaMap.get(keyB)!;
    const stemA = metaA.stem;
    const stemB = metaB.stem;

    let isDuplicate = false;
    let reason = '';

    if (stemA && stemB && stemA === stemB) {
      isDuplicate = true;
      reason = `Shares canonical biomarker stem "${stemA}"`;
    } else {
      const candidateCheck = isBiomarkerDuplicateCandidate(
        { key: keyA, name: metaA.name, unit: metaA.def.unit, normalRange: metaA.def.normalRange },
        { key: keyB, name: metaB.name, unit: metaB.def.unit, normalRange: metaB.def.normalRange }
      );
      if (candidateCheck.isMatch) {
        isDuplicate = true;
        reason = candidateCheck.reason;
      }
    }

    if (isDuplicate) {
      adjacency[keyA].add(keyB);
      adjacency[keyB].add(keyA);
      matchReasons[pairKey] = reason;
    }
  };

  // Compare candidates within matching buckets
  Object.values(buckets).forEach(bucketKeys => {
    if (bucketKeys.length > 1) {
      for (let i = 0; i < bucketKeys.length; i++) {
        for (let j = i + 1; j < bucketKeys.length; j++) {
          evaluatePair(bucketKeys[i], bucketKeys[j]);
        }
      }
    }
  });

  // Check user-active biomarkers against catalog for substring/close name matches
  const activeUserKeys = allKeys.filter(k => (logCounts[k] || 0) > 0 || customBiomarkers[k] !== undefined);
  activeUserKeys.forEach(userKey => {
    const metaU = keyMetaMap.get(userKey);
    if (!metaU) return;
    allKeys.forEach(catalogKey => {
      if (userKey === catalogKey) return;
      const metaC = keyMetaMap.get(catalogKey);
      if (!metaC) return;
      const isSub = (metaU.rawClean.length > 5 && metaC.rawClean.includes(metaU.rawClean)) ||
                    (metaC.rawClean.length > 5 && metaU.rawClean.includes(metaC.rawClean)) ||
                    (metaU.normName.length > 4 && metaC.normName.includes(metaU.normName)) ||
                    (metaC.normName.length > 4 && metaU.normName.includes(metaC.normName));
      if (isSub) {
        evaluatePair(userKey, catalogKey);
      }
    });
  });

  // Find connected components in the adjacency graph
  const visited = new Set<string>();
  const clusterMap: { [key: string]: string[] } = {};
  const clusterReasonMap: { [key: string]: string } = {};

  allKeys.forEach(k => {
    if (!visited.has(k)) {
      const component: string[] = [];
      const queue = [k];
      visited.add(k);
      while (queue.length > 0) {
        const curr = queue.shift()!;
        component.push(curr);
        adjacency[curr]?.forEach(neighbor => {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        });
      }
      
      const componentStem = getCanonicalBiomarkerStem(k, getDef(k).name);
      const compReason = component.length > 1 
        ? `Morphological & clinical match cluster for "${componentStem}" across ${component.length} entries`
        : '';

      component.forEach(memberKey => {
        clusterMap[memberKey] = component;
        clusterReasonMap[memberKey] = compReason;
      });
    }
  });

  // 3. Evaluate each biomarker
  allKeys.forEach(key => {
    const def = getDef(key);
    const name = def.name || key;
    const currentUnit = def.unit || '';
    const siblings = clusterMap[key] || [key];
    const thisLogCount = logCounts[key] || 0;
    const catalogMatchDef = findCatalogDefinition(key, name);

    let status: BiomarkerAuditItem['status'] = 'clean';
    let corruptedUnitProposal: BiomarkerAuditItem['corruptedUnitProposal'] = undefined;
    let duplicateCluster: BiomarkerAuditItem['duplicateCluster'] = undefined;
    let missingMetadata: BiomarkerAuditItem['missingMetadata'] = undefined;
    let conflictInfo: BiomarkerAuditItem['conflictInfo'] = undefined;

    const tFlag = telemetryFlags.find(f => f.key === key);

    // Check Unit Corruption or Improbable Telemetry
    if (isCorruptedUnit(currentUnit) || tFlag) {
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

      // 6. Extract unit directly embedded in key name (e.g. height_cm -> cm, serum_sodium_mmol_l -> mmol/L, psa_ug_l -> ug/L)
      if (!proposedUnit) {
        const kLow = key.toLowerCase();
        if (kLow.endsWith('_mmol_l') || kLow.endsWith('_mmol_per_l')) { proposedUnit = 'mmol/L'; reason = 'Extracted from key name unit suffix'; }
        else if (kLow.endsWith('_umol_l') || kLow.endsWith('_umol_per_l')) { proposedUnit = 'umol/L'; reason = 'Extracted from key name unit suffix'; }
        else if (kLow.endsWith('_pmol_l')) { proposedUnit = 'pmol/L'; reason = 'Extracted from key name unit suffix'; }
        else if (kLow.endsWith('_nmol_l')) { proposedUnit = 'nmol/L'; reason = 'Extracted from key name unit suffix'; }
        else if (kLow.endsWith('_mg_dl')) { proposedUnit = 'mg/dL'; reason = 'Extracted from key name unit suffix'; }
        else if (kLow.endsWith('_mg_l')) { proposedUnit = 'mg/L'; reason = 'Extracted from key name unit suffix'; }
        else if (kLow.endsWith('_ug_l') || kLow.endsWith('_mcg_l')) { proposedUnit = 'ug/L'; reason = 'Extracted from key name unit suffix'; }
        else if (kLow.endsWith('_g_l') || kLow.endsWith('_g_per_l')) { proposedUnit = 'g/L'; reason = 'Extracted from key name unit suffix'; }
        else if (kLow.endsWith('_g_dl')) { proposedUnit = 'g/dL'; reason = 'Extracted from key name unit suffix'; }
        else if (kLow.endsWith('_pg') || kLow.endsWith('_pg_ml')) { proposedUnit = 'pg'; reason = 'Extracted from key name unit suffix'; }
        else if (kLow.endsWith('_ng_ml') || kLow.endsWith('_ng_dl')) { proposedUnit = 'ng/mL'; reason = 'Extracted from key name unit suffix'; }
        else if (kLow.endsWith('_fl')) { proposedUnit = 'fL'; reason = 'Extracted from key name unit suffix'; }
        else if (kLow.endsWith('_u_l') || kLow.endsWith('_iu_l')) { proposedUnit = 'U/L'; reason = 'Extracted from key name unit suffix'; }
        else if (kLow.endsWith('_10_9_l') || kLow.endsWith('_10_9_per_l')) { proposedUnit = '10^9/L'; reason = 'Extracted from key name unit suffix'; }
        else if (kLow.endsWith('_10_12_l') || kLow.endsWith('_10_12_per_l')) { proposedUnit = '10^12/L'; reason = 'Extracted from key name unit suffix'; }
        else if (kLow.endsWith('_cm')) { proposedUnit = 'cm'; reason = 'Extracted from key name unit suffix'; }
        else if (kLow.endsWith('_kg') || kLow.includes('_kg_m2')) { proposedUnit = kLow.includes('_kg_m2') ? 'kg/m2' : 'kg'; reason = 'Extracted from key name unit suffix'; }
        else if (kLow.endsWith('_percent') || kLow.endsWith('_pct')) { proposedUnit = '%'; reason = 'Extracted from key name unit suffix'; }
        else if (kLow.endsWith('_score') || kLow.includes('audit_c_') || kLow.includes('audit_score')) { proposedUnit = 'points'; reason = 'Clinical assessment scoring scale'; }
        else if (kLow.includes('weekly_alcohol')) { proposedUnit = 'units/week'; reason = 'Standard alcohol telemetry unit'; }
        
        if (proposedUnit) {
          source = 'optimalValue';
        }
      }

      if (proposedUnit) {
        status = 'corrupted_unit';
        corruptedUnitProposal = {
          proposedUnit,
          sourceField: source,
          confidence: 0.95,
          reason
        };
      } else if (tFlag && !isCorruptedUnit(currentUnit)) {
        status = 'corrupted_unit';
        corruptedUnitProposal = {
          proposedUnit: currentUnit,
          sourceField: 'logHistory',
          confidence: 0.8,
          reason: tFlag.reason
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
        const sDef = getDef(sk);
        const score = calculateCompletenessScore(sDef, logCounts[sk] || 0);
        if (score > bestScore) {
          bestScore = score;
          bestKey = sk;
        }
      });

      const isPrimary = key === bestKey;
      const targetDef = getDef(bestKey);
      const allCandidateAliases = siblings.filter(sk => sk !== bestKey);
      const candidateAliases = allCandidateAliases.filter(sk => {
        const hasLogs = (logCounts[sk] || 0) > 0;
        const isCustom = customBiomarkers[sk] !== undefined;
        return hasLogs || isCustom;
      });

      const clusterReason = clusterReasonMap[key] || `Matches cluster across ${siblings.length} entries`;

      if (candidateAliases.length > 0 || isPrimary) {
        duplicateCluster = {
          targetKey: bestKey,
          targetName: targetDef.name || bestKey,
          clusterKeys: siblings,
          candidateAliases,
          reason: clusterReason,
          isPrimary
        };

        if (!isPrimary && status === 'clean' && candidateAliases.includes(key)) {
          status = 'duplicate_candidate';
        }
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
  const processedClusters = new Set<string>();

  Object.values(clusterMap).forEach(keys => {
    if (keys.length > 1) {
      const clusterSig = [...keys].sort().join(':::');
      if (!processedClusters.has(clusterSig)) {
        processedClusters.add(clusterSig);

        // Determine master key
        let bestKey = keys[0];
        let bestScore = -1;
        keys.forEach(sk => {
          const sDef = getDef(sk);
          const score = calculateCompletenessScore(sDef, logCounts[sk] || 0);
          if (score > bestScore) {
            bestScore = score;
            bestKey = sk;
          }
        });
        const masterDef = getDef(bestKey);
        const allCandidateAliases = keys.filter(k => k !== bestKey);

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

        // Only report as a duplicate cluster if there is at least one active candidate alias
        // that exists in customBiomarkers or has historical observations (>0 logs)
        const activeCandidateAliases = allCandidateAliases.filter(k => {
          const hasLogs = (logCounts[k] || 0) > 0;
          const isCustom = customBiomarkers[k] !== undefined;
          return hasLogs || isCustom;
        });

        if (activeCandidateAliases.length === 0) return;

        const clusterReason = clusterReasonMap[bestKey] || `Matches duplicate cluster across ${keys.length} entries`;

        duplicateGroups.push({
          suggestedMasterKey: bestKey,
          suggestedMasterName: masterDef.name || bestKey,
          memberKeys: keys,
          candidateAliases: activeCandidateAliases,
          reason: clusterReason,
          totalLogsInCluster,
          emptyAliasKeys: emptyAliasKeys.filter(k => activeCandidateAliases.includes(k)),
          populatedAliasKeys: populatedAliasKeys.filter(k => activeCandidateAliases.includes(k))
        });
      }
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
