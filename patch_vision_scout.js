import fs from 'fs';
let code = fs.readFileSync('server_vision_scout.ts', 'utf8');

const targetStr = `        const compNames = components.map(c => c.name).filter(Boolean);
        let dishTitle = d.dishName || (compNames.length > 0 ? compNames.join(', ') : "Dish");
        if (compNames.length > 1) {
          const missingFoods = compNames.filter(cn => !dishTitle.toLowerCase().includes(cn.toLowerCase()));
          if (missingFoods.length > 0) {
            dishTitle = \`\${dishTitle} with \${missingFoods.join(', ')}\`;
          }
        }`;

const replacement = `        const compNames = components.map(c => c.name).filter(Boolean);
        let dishTitle = d.dishName || (compNames.length > 0 ? compNames.join(', ') : "Dish");`;

code = code.replace(targetStr, replacement);
fs.writeFileSync('server_vision_scout.ts', code);
console.log("Patched server_vision_scout.ts");
