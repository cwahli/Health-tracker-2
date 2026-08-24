import fs from 'fs';
let code = fs.readFileSync('server_pure_helpers.ts', 'utf8');

const replacement = `
  // 1. Calories
  updated = updated.replace(/\\b[\\d,]+(?:\\.\\d+)?\\s*(?:calories|kcal)\\b/gi, \`\${calVal} calories\`);

  // 2. Sodium
  updated = updated.replace(/\\b[\\d,]+(?:\\.\\d+)?\\s*mg\\s*(?:of\\s+)?(?:[a-zA-Z-]+\\s+)*sodium\\b/gi, \`\${naFormatted}mg of sodium\`);
  updated = updated.replace(/sodium\\s*\\([^)]*[\\d,]+(?:\\.\\d+)?\\s*mg[^)]*\\)/gi, \`sodium (\${naFormatted}mg)\`);
  updated = updated.replace(/sodium\\s*(?:to\\s+|is\\s+|at\\s+|:\\s*)[\\d,]+(?:\\.\\d+)?\\s*mg/gi, \`sodium: \${naFormatted}mg\`);
  updated = updated.replace(/\\bsodium\\s*to\\s*[\\d,]+(?:\\.\\d+)?\\s*mg/gi, \`sodium to \${naFormatted}mg\`);

  // 3. Saturated Fat
  updated = updated.replace(/\\b[\\d,]+(?:\\.\\d+)?\\s*g\\s*(?:of\\s+)?(?:[a-zA-Z-]+\\s+)*saturated\\s*fat\\b/gi, \`\${satFatVal}g of saturated fat\`);
  updated = updated.replace(/saturated\\s*fat\\s*\\([^)]*[\\d,]+(?:\\.\\d+)?\\s*g[^)]*\\)/gi, \`saturated fat (\${satFatVal}g)\`);
  updated = updated.replace(/saturated\\s*fat\\s*:\\s*[\\d,]+(?:\\.\\d+)?\\s*g/gi, \`saturated fat: \${satFatVal}g\`);

  // 4. Total Fat
  updated = updated.replace(/\\b[\\d,]+(?:\\.\\d+)?\\s*g\\s*(?:of\\s+)?(?:[a-zA-Z-]+\\s+)*total\\s*fat\\b/gi, \`\${fatVal}g of total fat\`);

  // 5. Protein
  updated = updated.replace(/\\b[\\d,]+(?:\\.\\d+)?\\s*g\\s*(?:of\\s+)?(?:[a-zA-Z-]+\\s+)*protein\\b/gi, (match) => {
    return match.replace(/[\\d,]+(?:\\.\\d+)?/, String(pVal));
  });
  updated = updated.replace(/protein\\s*\\([^)]*[\\d,]+(?:\\.\\d+)?\\s*g[^)]*\\)/gi, \`protein (\${pVal}g)\`);
  updated = updated.replace(/protein\\s*:\\s*[\\d,]+(?:\\.\\d+)?\\s*g/gi, \`protein: \${pVal}g\`);

  // 6. Carbohydrates
  if (grandCarbs !== undefined && grandCarbs > 0) {
    const carbVal = Math.round(grandCarbs * 10) / 10;
    updated = updated.replace(/\\b[\\d,]+(?:\\.\\d+)?\\s*g\\s*(?:of\\s+)?(?:[a-zA-Z-]+\\s+)*(?:carbohydrates|carbs)\\b/gi, \`\${carbVal}g of carbohydrates\`);
  }
`;

// Find the section from "// 1. Calories" to the end of "// 6. Carbohydrates" block
code = code.replace(/\/\/ 1\. Calories[\s\S]*?(?=return updated;)/, replacement);

fs.writeFileSync('server_pure_helpers.ts', code);
console.log("Patched synchronizeNarrativeText regexes");
