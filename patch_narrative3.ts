import fs from 'fs';
let code = fs.readFileSync('server_pure_helpers.ts', 'utf8');

const replacement = `
  // 1. Calories
  updated = updated.replace(/\\b([\\d,]+(?:\\.\\d+)?)\\s*((?:[a-zA-Z-]+\\s+)*(?:calories|kcal))\\b/gi, (match, num, rest) => {
    return \`\${calVal} \${rest}\`;
  });

  // 2. Sodium
  updated = updated.replace(/\\b([\\d,]+(?:\\.\\d+)?)\\s*(mg\\s*(?:of\\s+)?(?:[a-zA-Z-]+\\s+)*sodium)\\b/gi, (match, num, rest) => {
    return \`\${naFormatted}\${rest}\`;
  });
  updated = updated.replace(/(sodium\\s*\\([^)]*)([\\d,]+(?:\\.\\d+)?)(\\s*mg[^)]*\\))/gi, (match, p1, num, p3) => {
    return \`\${p1}\${naFormatted}\${p3}\`;
  });
  updated = updated.replace(/(sodium\\s*(?:to\\s+|is\\s+|at\\s+|:\\s*))([\\d,]+(?:\\.\\d+)?)(\\s*mg)/gi, (match, p1, num, p3) => {
    return \`\${p1}\${naFormatted}\${p3}\`;
  });

  // 3. Saturated Fat
  updated = updated.replace(/\\b([\\d,]+(?:\\.\\d+)?)\\s*(g\\s*(?:of\\s+)?(?:[a-zA-Z-]+\\s+)*saturated\\s*fat)\\b/gi, (match, num, rest) => {
    return \`\${satFatVal}\${rest}\`;
  });
  updated = updated.replace(/(saturated\\s*fat\\s*\\([^)]*)([\\d,]+(?:\\.\\d+)?)(\\s*g[^)]*\\))/gi, (match, p1, num, p3) => {
    return \`\${p1}\${satFatVal}\${p3}\`;
  });
  updated = updated.replace(/(saturated\\s*fat\\s*:\\s*)([\\d,]+(?:\\.\\d+)?)(\\s*g)/gi, (match, p1, num, p3) => {
    return \`\${p1}\${satFatVal}\${p3}\`;
  });

  // 4. Total Fat
  updated = updated.replace(/\\b([\\d,]+(?:\\.\\d+)?)\\s*(g\\s*(?:of\\s+)?(?:[a-zA-Z-]+\\s+)*total\\s*fat)\\b/gi, (match, num, rest) => {
    return \`\${fatVal}\${rest}\`;
  });

  // 5. Protein
  updated = updated.replace(/\\b([\\d,]+(?:\\.\\d+)?)\\s*(g\\s*(?:of\\s+)?(?:[a-zA-Z-]+\\s+)*protein)\\b/gi, (match, num, rest) => {
    return \`\${pVal}\${rest}\`;
  });
  updated = updated.replace(/(protein\\s*\\([^)]*)([\\d,]+(?:\\.\\d+)?)(\\s*g[^)]*\\))/gi, (match, p1, num, p3) => {
    return \`\${p1}\${pVal}\${p3}\`;
  });
  updated = updated.replace(/(protein\\s*:\\s*)([\\d,]+(?:\\.\\d+)?)(\\s*g)/gi, (match, p1, num, p3) => {
    return \`\${p1}\${pVal}\${p3}\`;
  });

  // 6. Carbohydrates
  if (grandCarbs !== undefined && grandCarbs > 0) {
    const carbVal = Math.round(grandCarbs * 10) / 10;
    updated = updated.replace(/\\b([\\d,]+(?:\\.\\d+)?)\\s*(g\\s*(?:of\\s+)?(?:[a-zA-Z-]+\\s+)*(?:carbohydrates|carbs))\\b/gi, (match, num, rest) => {
      return \`\${carbVal}\${rest}\`;
    });
  }
`;

// Find the section from "// 1. Calories" to the end of "// 6. Carbohydrates" block
code = code.replace(/\/\/ 1\. Calories[\s\S]*?(?=return updated;)/, replacement);

fs.writeFileSync('server_pure_helpers.ts', code);
console.log("Patched synchronizeNarrativeText regexes 3");
