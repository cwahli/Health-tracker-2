import fs from 'fs';
let code = fs.readFileSync('server.ts', 'utf8');

const additionalOverrides = `
        } else if (n.includes("soup") || n.includes("broth") || n.includes("sop") || n.includes("soto")) {
          overrides = { calories: 60, protein: 3, totalFat: 2.5, saturatedFat: 1, sodium: 600, carbohydrates: 6, transFat: 0, addedSugar: 0, potassium: 120, totalFibre: 0.5, solubleFibre: 0 };
        } else if (n.includes("cracker") || n.includes("chip") || n.includes("crisp") || n.includes("emping") || n.includes("kerupuk") || n.includes("krupuk")) {
          overrides = { calories: 500, protein: 7, totalFat: 25, saturatedFat: 4, sodium: 600, carbohydrates: 60, transFat: 0, addedSugar: 0, potassium: 200, totalFibre: 3, solubleFibre: 0.5 };
`;

code = code.replace(
  /        return \{ \.\.\.base, \.\.\.overrides \};\n      \};/g,
  `${additionalOverrides}        return { ...base, ...overrides };\n      };`
);

fs.writeFileSync('server.ts', code);
console.log("Patched clinical defaults.");
