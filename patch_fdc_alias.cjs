const fs = require('fs');
const content = fs.readFileSync('server_fdc_resolve.ts', 'utf8');

const search = `export async function writeAliasIfHitUnique(resolveClass: string, query: string, bestMatch: any) {
  if (resolveClass === 'HIT_UNIQUE' && bestMatch) {
    const fdcId = bestMatch.fdcId || bestMatch.id;
    if (fdcId) {
      try {
        console.log(\`[ResolveClass] HIT_UNIQUE for "\${query}". Auto-aliasing to \${fdcId}.\`);
        await supabaseAdmin.from('food_aliases').upsert({
          alias_name: query.toLowerCase().trim(),
          target_food_id: String(fdcId),
          hit_count: 1
        }, { onConflict: 'alias_name' });
      } catch (err) {
        console.warn(\`[ResolveClass] Failed to write auto-alias for \${query}:\`, err);
      }
    }
  }
}`;

const replace = `import { normalizeFoodKey } from './server_food_catalog.js';

export async function writeAliasIfHitUnique(resolveClass: string, query: string, bestMatch: any) {
  if (resolveClass === 'HIT_UNIQUE' && bestMatch) {
    const fdcId = bestMatch.fdcId || bestMatch.id || bestMatch.food_id;
    if (fdcId && query) {
      const aliasKey = normalizeFoodKey(query);
      if (!aliasKey) return;
      try {
        console.log(\`[ResolveClass] HIT_UNIQUE for "\${query}" (key: \${aliasKey}). Auto-aliasing to \${fdcId}.\`);
        await supabaseAdmin.from('food_aliases').upsert({
          alias_key: aliasKey,
          food_id: String(fdcId),
          weight: 1.0,
          source: 'hit_unique_auto_alias',
          hit_count: 1
        }, { onConflict: 'alias_key' });
      } catch (err) {
        console.warn(\`[ResolveClass] Failed to write auto-alias for \${query}:\`, err);
      }
    }
  }
}`;

fs.writeFileSync('server_fdc_resolve.ts', content.replace(search, replace));
