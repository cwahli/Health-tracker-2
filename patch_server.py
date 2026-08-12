import re

with open('server.ts', 'r') as f:
    content = f.read()

# Add import
import_statement = "import { buildFoodSearchQuerySet } from './server_query_set.js';\n"
if "import { buildFoodSearchQuerySet }" not in content:
    content = content.replace('import { buildGeminiPrompt, extractJsonFromText } from "./server_pure_helpers.js";', 
                             'import { buildGeminiPrompt, extractJsonFromText } from "./server_pure_helpers.js";\n' + import_statement)

# We want to replace from "// Clean and consolidate queries first" down to "const uniqueQueries = Array.from(queryKeyMap.values());"
old_block = """    // Clean and consolidate queries first
    if (visionScoutItems && visionScoutItems.length > 0) {
      visionScoutItems.forEach((it: any) => {
        if (it.originalName) queriesToSearch.push(it.originalName);
        if (it.keyword) queriesToSearch.push(it.keyword);
        if (it.components) {
           it.components.forEach((c: any) => {
              const q = typeof c === 'string' ? c : c.searchQuery || c.name || c.keyword;
              if (q) queriesToSearch.push(q);
           });
        }
        const combined = [
          it.originalName, it.keyword, it.originalLocalName, it.canonicalDbName, it.name,
          ...(it.visualIngredients || []),
          ...(it.components ? it.components.map((c: any) => typeof c === 'string' ? c : c.name || c.searchQuery || c.keyword) : [])
        ].filter(Boolean).join(' ').toLowerCase();

        if (combined.includes('mayo') || combined.includes('mayonnaise')) {
          if (!queriesToSearch.some(q => q.toLowerCase().includes('mayonnaise'))) {
            queriesToSearch.push('mayonnaise');
          }
        }
        if (combined.includes('black pepper sauce') || combined.includes('pepper sauce')) {
          if (!queriesToSearch.some(q => q.toLowerCase().includes('black pepper sauce'))) {
            queriesToSearch.push('black pepper sauce');
          }
        }
      });
    }

    const sanitizedRawQueries = queriesToSearch
      .map(q => sanitizeDishTitle(String(q || '')))
      .filter(q => q.length > 0);

    const queryKeyMap = new Map<string, string>();
    for (const q of sanitizedRawQueries) {
      const key = normalizeFoodKey(q);
      if (!key) continue;
      if (!queryKeyMap.has(key) || q.length < queryKeyMap.get(key)!.length) {
        queryKeyMap.set(key, q);
      }
    }

    const uniqueQueries = Array.from(queryKeyMap.values());"""

new_block = """    // Clean and consolidate queries first
    const uniqueQueries = buildFoodSearchQuerySet(visionScoutItems || []);"""

if old_block in content:
    content = content.replace(old_block, new_block)
    print("Successfully replaced uniqueQueries block")
else:
    # Try Regex fallback
    pattern = re.compile(r'    // Clean and consolidate queries first.*?const uniqueQueries = Array\.from\(queryKeyMap\.values\(\)\);', re.DOTALL)
    if pattern.search(content):
        content = pattern.sub(new_block, content)
        print("Successfully replaced uniqueQueries block (regex)")
    else:
        print("Could not find old block!")

with open('server.ts', 'w') as f:
    f.write(content)
