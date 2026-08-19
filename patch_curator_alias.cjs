const fs = require('fs');
let content = fs.readFileSync('server_food_resolver_curator.ts', 'utf8');

content = content.replace(
  `await supabaseAdmin.from('food_aliases').upsert({
            alias_key: cleanAlias,
            target_food_id: targetId,
            hit_count: 1
          }, { onConflict: 'alias_key' });`,
  `await supabaseAdmin.from('food_aliases').upsert({
            alias_key: cleanAlias,
            food_id: targetId,
            weight: 1.0,
            source: 'curator_alias',
            hit_count: 1
          }, { onConflict: 'alias_key' });`
);

content = content.replace(
  `await supabaseAdmin.from('food_aliases').upsert({
            alias_key: \`legacy_merge_\${loser}\`,
            target_food_id: String(merge.winnerFdcId),
            hit_count: 1
          }, { onConflict: 'alias_key' });`,
  `await supabaseAdmin.from('food_aliases').upsert({
            alias_key: \`legacy_merge_\${loser}\`,
            food_id: String(merge.winnerFdcId),
            weight: 1.0,
            source: 'curator_legacy_merge',
            hit_count: 1
          }, { onConflict: 'alias_key' });`
);

fs.writeFileSync('server_food_resolver_curator.ts', content);
