import re

with open('server.ts', 'r') as f:
    content = f.read()

old_block = """    if (!response.ok) return [];
    const data = await response.json();
    return data.products || [];"""

new_block = """    if (!response.ok) return [];
    const data = await response.json();
    let products = data.products || [];
    
    products = products.filter((p: any) => {
      const kcal = p.nutriments?.['energy-kcal_100g'] || 0;
      const protein = p.nutriments?.['proteins_100g'] || 0;
      
      const name = (p.product_name || p.generic_name || "").toLowerCase();
      const isExpectedZero = /\\b(water|diet|zero|no sugar|sparkling|seltzer|ice|tea|coffee|vinegar|salt|spices?)\\b/.test(name);
      
      if (kcal === 0 && protein < 0.5 && !isExpectedZero) {
        console.log(`[DB REJECT] Dropping 0-kcal OFF candidate: ${p.product_name} (${p.id})`);
        return false;
      }
      return true;
    });
    
    return products;"""

if old_block in content:
    content = content.replace(old_block, new_block, 1) # Only first occurrence just in case
    print("Successfully replaced OFF 0-kcal block")
else:
    print("Could not find OFF 0-kcal block!")

with open('server.ts', 'w') as f:
    f.write(content)
