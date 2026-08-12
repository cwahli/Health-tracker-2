import re

with open('server.ts', 'r') as f:
    content = f.read()

old_block = """    foods.sort((a: any, b: any) => {"""

new_block = """    // Reject 0-kcal items that are supposed to have substance
    foods = foods.filter((f: any) => {
      const kcalNutrient = f.foodNutrients?.find((n: any) => n.nutrientName === "Energy" && n.unitName === "kcal");
      const kcal = kcalNutrient ? parseFloat(kcalNutrient.value) : 0;
      const proteinNutrient = f.foodNutrients?.find((n: any) => n.nutrientName === "Protein" && n.unitName === "g");
      const protein = proteinNutrient ? parseFloat(proteinNutrient.value) : 0;
      
      const name = (f.description || "").toLowerCase();
      const isExpectedZero = /\\b(water|diet|zero|no sugar|sparkling|seltzer|ice|tea|coffee|vinegar|salt|spices?)\\b/.test(name);
      
      if (kcal === 0 && protein < 0.5 && !isExpectedZero) {
        console.log(`[DB REJECT] Dropping 0-kcal candidate: ${f.description} (${f.fdcId})`);
        return false;
      }
      return true;
    });

    foods.sort((a: any, b: any) => {"""

if old_block in content:
    content = content.replace(old_block, new_block, 1) # Only first occurrence just in case
    print("Successfully replaced 0-kcal block")
else:
    print("Could not find 0-kcal block!")

with open('server.ts', 'w') as f:
    f.write(content)
