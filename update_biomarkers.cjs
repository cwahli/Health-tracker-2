const fs = require('fs');
let code = fs.readFileSync('src/utils/biomarkers.ts', 'utf8');

const getMappedCode = `export function getMappedBiomarkerKey(rawKey: string): string {
  if (!rawKey) return '';
  const clean = rawKey.toLowerCase().replace(/[^a-z0-9_]/g, ''); // Keep underscores for exact matching
  const cleanNoUnderscore = rawKey.toLowerCase().replace(/[^a-z0-9]/g, '');

  // 1. Exact match on definitions
  for (const def of biomarkerDefinitions) {
    const defKeyNoUnderscore = def.key.replace(/[^a-z0-9]/g, '');
    const defNameNoUnderscore = (def.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (
      def.key === clean ||
      def.key === cleanNoUnderscore ||
      defKeyNoUnderscore === cleanNoUnderscore ||
      defNameNoUnderscore === cleanNoUnderscore
    )
      return def.key;
    if (def.aliases) {
      for (const alias of def.aliases) {
        const aliasNoUnderscore = alias.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (alias === clean || alias === cleanNoUnderscore || aliasNoUnderscore === cleanNoUnderscore) return def.key;
      }
    }
  }

  // 2. Exact match on explicit aliases
  if (CUSTOM_KEY_ALIASES[clean]) return CUSTOM_KEY_ALIASES[clean];
  if (CUSTOM_KEY_ALIASES[cleanNoUnderscore]) return CUSTOM_KEY_ALIASES[cleanNoUnderscore];

  // 3. Specimen Guard & Fuzzy match (IDENTITY_FALSE_FRIEND)
  // If the raw key contains 'urine', it must not map to 'serum' equivalents.
  const isUrine = clean.includes('urine');
  const isSerum = clean.includes('serum') || clean.includes('plasma') || clean.includes('blood');
  
  if (isUrine) {
    if (clean.includes('albumin') && !clean.includes('microalbumin')) return 'urine_albumin';
    // Let other urine markers pass through without matching serum counterparts
  } else {
    // If not urine, we can safely map 'albumin' to 'serum_albumin'
    if (cleanNoUnderscore === 'albumin') return 'serum_albumin';
  }

  // MCH / Hemoglobin guard
  if (clean === 'mch' || (clean.includes('mean_corpuscular_hemoglobin') && !clean.includes('concentration'))) {
    return 'mean_corpuscular_hemoglobin';
  }
  if (cleanNoUnderscore === 'hemoglobin' || cleanNoUnderscore === 'haemoglobin') {
    return 'hemoglobin';
  }

  // Substring mapping for common clinical names that were dropped
  for (const def of biomarkerDefinitions) {
    const defNameNoUnderscore = (def.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    // If the input explicitly contains the clinical name, and isn't guarded
    if (defNameNoUnderscore.length > 5 && cleanNoUnderscore.includes(defNameNoUnderscore)) {
       // Guard against false friends:
       if (isUrine && def.key.includes('serum')) continue;
       if (cleanNoUnderscore.includes('meancorpuscular') && def.key === 'hemoglobin') continue;
       
       return def.key;
    }
  }

  // Canonicalize unknown keys to lowercase slug form so "Hemoglobin" and "hemoglobin"
  // cannot become parallel dictionary identities.
  return clean || rawKey;
}`;

// Replace the function
code = code.replace(/export function getMappedBiomarkerKey\([\s\S]*?return clean \|\| rawKey;\n\}/, getMappedCode);

fs.writeFileSync('src/utils/biomarkers.ts', code);
