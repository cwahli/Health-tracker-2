import re

with open('server.ts', 'r') as f:
    content = f.read()

import_statement = "import { rankAndClassifyCandidates, writeAliasIfHitUnique } from './server_fdc_resolve.js';\n"
if "import { rankAndClassifyCandidates" not in content:
    content = import_statement + content

old_block = """async function searchUSDAFood(query: string): Promise<any | null> {
  const results = await searchUSDA(query, 3, 'Foundation,SR Legacy,Survey (FNDDS)');
  if (results && results.length > 0) {
    const item = results[0];
    return {
      ...item,
      id: String(item.fdcId || item.id),
      name: item.description || item.name || query
    };
  }
  return null;
}"""

new_block = """async function searchUSDAFood(query: string): Promise<any | null> {
  const results = await searchUSDA(query, 5, 'Foundation,SR Legacy,Survey (FNDDS)');
  if (results && results.length > 0) {
    const { resolveClass, bestMatch } = rankAndClassifyCandidates(query, results, 65);
    if (bestMatch) {
      // Auto-alias if it's a solid HIT_UNIQUE
      if (resolveClass === 'HIT_UNIQUE') {
         writeAliasIfHitUnique(resolveClass, query, bestMatch).catch(e => console.error(e));
      }
      return {
        ...bestMatch,
        id: String(bestMatch.fdcId || bestMatch.id),
        name: bestMatch.description || bestMatch.name || query
      };
    }
    
    // Fallback if none passed threshold
    const item = results[0];
    return {
      ...item,
      id: String(item.fdcId || item.id),
      name: item.description || item.name || query
    };
  }
  return null;
}"""

if old_block in content:
    content = content.replace(old_block, new_block, 1)
    print("Successfully replaced searchUSDAFood")
else:
    print("Could not find searchUSDAFood block!")

with open('server.ts', 'w') as f:
    f.write(content)
