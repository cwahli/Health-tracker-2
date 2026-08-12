import re

with open('server_nutrient_basis.test.ts', 'r') as f:
    content = f.read()

content = content.replace("toPer100g, parseNutrientNumber", "toPer100g, parseNutrientNumber, normalizeToPer100g, isPlausibleNutrients")

new_tests = """
  it('normalizeToPer100g correctly normalizes based on pack or serving', () => {
    const perPack = normalizeToPer100g({
      basisType: 'per_pack',
      servingGrams: null,
      packGrams: 200,
      nutrients: { calories: 400, protein: 20 },
    });
    expect(perPack.calories).toBe(200);
    expect(perPack.protein).toBe(10);
    
    const perPack2 = normalizeToPer100g({
      basisType: 'per_pack',
      servingGrams: 50,
      portionsPerPack: 4,
      nutrients: { calories: 400, protein: 20 },
    });
    expect(perPack2.calories).toBe(200);
    expect(perPack2.protein).toBe(10);
  });

  it('isPlausibleNutrients checks for limits', () => {
    expect(isPlausibleNutrients({ calories: 960 }).valid).toBe(false);
    expect(isPlausibleNutrients({ calories: 500, protein: 110 }).valid).toBe(false);
    expect(isPlausibleNutrients({ calories: 500, protein: 50, fat: 20 }).valid).toBe(true);
  });
});
"""
content = content.replace("});\n", new_tests)

with open('server_nutrient_basis.test.ts', 'w') as f:
    f.write(content)
