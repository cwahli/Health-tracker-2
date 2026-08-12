import re

with open('server.ts', 'r') as f:
    content = f.read()

old_block = """          let dataTypes = 'Foundation,SR Legacy';
          const isDbBrand = await isKnownDatabaseBrand(cleaned);
          if (isBarcode || visionScoutContentType === 'text' || cleaned.toLowerCase().includes('brand') || isDbBrand) {
            dataTypes = 'Foundation,SR Legacy,Branded';
          }"""

new_block = """          let dataTypes = 'Foundation,SR Legacy';
          const isDbBrand = await isKnownDatabaseBrand(cleaned);
          if (isBarcode || visionScoutContentType === 'text' || cleaned.toLowerCase().includes('brand') || isDbBrand) {
            dataTypes = 'Foundation,SR Legacy,Branded';
          }
          
          const isGeneric = /^(mayo|mayonnaise|granola|tortilla|salad greens|mixed salad leaves|lettuce|tomato|onion|cucumber|bread|wrap|egg|boiled egg|salt|pepper|oil|butter|sugar|chicken|beef|pork|fish|tuna|salmon|rice|pasta|cheese)$/i.test(cleaned);
          if (isGeneric && !isDbBrand && !isBarcode) {
            dataTypes = 'Foundation,SR Legacy'; // Override and lock to generics
            addDebugLog(`[BrandGuard] Blocked branded search for generic token: ${cleaned}`);
          }"""

if old_block in content:
    content = content.replace(old_block, new_block)
    print("Successfully replaced BrandGuard block")
else:
    print("Could not find BrandGuard block!")

with open('server.ts', 'w') as f:
    f.write(content)
