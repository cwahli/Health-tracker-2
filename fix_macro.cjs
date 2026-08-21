const fs = require('fs');
let code = fs.readFileSync('server_food_resolver_curator.ts', 'utf8');

const boundaryCheckCode = `
function checkMacroBoundary(query: string, nutrients: Record<string, number> | undefined): { passed: boolean; reason?: string } {
    if (!nutrients) return { passed: true };
    const q = (query || '').toLowerCase().trim();
    
    // Dairy/Cheese: Protein >= 12%, Fat <= 50%, Calories <= 550 kcal/100g.
    if (q.includes('cheese') && !q.includes('sauce') && !q.includes('cream')) {
        if ((nutrients.protein || 0) < 12 || (nutrients.totalFat || 0) > 50 || (nutrients.calories || 0) > 550) {
            return { passed: false, reason: \`Macro boundary violation for cheese: P=\${nutrients.protein}, F=\${nutrients.totalFat}, C=\${nutrients.calories}\` };
        }
    }
    
    // Lean Poultry/Meat: Protein >= 18%, Fat <= 15%.
    if (q.includes('chicken breast') || q.includes('turkey breast') || (q.includes('lean') && q.includes('meat'))) {
        if ((nutrients.protein || 0) < 18 || (nutrients.totalFat || 0) > 15) {
            return { passed: false, reason: \`Macro boundary violation for lean meat: P=\${nutrients.protein}, F=\${nutrients.totalFat}\` };
        }
    }
    
    // Fresh Fruit: Fat <= 2%, Carbs <= 25%.
    if ((q.includes('apple') || q.includes('strawberry') || q.includes('blueberry') || q.includes('raspberry') || q.includes('fruit')) && !q.includes('dried')) {
        if ((nutrients.totalFat || 0) > 2 || (nutrients.carbohydrates || 0) > 25) {
             return { passed: false, reason: \`Macro boundary violation for fresh fruit: F=\${nutrients.totalFat}, C=\${nutrients.carbohydrates}\` };
        }
    }
    
    return { passed: true };
}
`;

code = code + boundaryCheckCode;

fs.writeFileSync('server_food_resolver_curator.ts', code);
