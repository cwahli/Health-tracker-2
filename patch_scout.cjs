const fs = require('fs');
let code = fs.readFileSync('server_vision_scout.ts', 'utf8');

const splitSearch = `        } else {
          explodedItems.push(item);
        }`;

const splitReplace = `        } else {
          const countMatch = rawOriginal.match(/^(\\d+)\\s+(.+)$/);
          if (countMatch && !hasPrintedMacros) {
            const count = parseInt(countMatch[1], 10);
            const itemName = countMatch[2];
            if (count > 1 && count <= 10 && (itemName.toLowerCase().includes('croissant') || itemName.toLowerCase().includes('pastry') || itemName.toLowerCase().includes('swirl') || itemName.toLowerCase().includes('roll') || itemName.toLowerCase().includes('bun') || itemName.toLowerCase().includes('muffin'))) {
              const singleWeight = Math.round((item.estimatedWeightGrams || 100 * count) / count);
              const singleCals = item.estimatedCalories ? Math.round(item.estimatedCalories / count) : undefined;
              for (let i = 0; i < count; i++) {
                explodedItems.push({
                  ...item,
                  originalName: itemName,
                  keyword: itemName,
                  name: itemName,
                  estimatedWeightGrams: singleWeight,
                  estimatedCalories: singleCals
                });
              }
              addDebugLog(\`[Scout Counting] Split "\${rawOriginal}" into \${count} distinct "\${itemName}" items.\`);
              return;
            }
          }
          explodedItems.push(item);
        }`;

code = code.replace(splitSearch, splitReplace);

const tuningSearch = `      visionScoutItems = explodedItems.map((item: any, idx: number) => {
        let newItem = { ...item, scoutIndex: idx };
        if (!newItem.boundingBox2D || !Array.isArray(newItem.boundingBox2D) || newItem.boundingBox2D.length !== 4) {`;

const tuningReplace = `      visionScoutItems = explodedItems.map((item: any, idx: number) => {
        let newItem = { ...item, scoutIndex: idx };

        // Volumetric Tuning for high-density condiments
        const isCondiment = (name: string) => {
          const lower = (name || '').toLowerCase();
          return lower.includes('mayonnaise') || lower.includes('ranch') || lower.includes('dressing') || lower.includes('sauce') || lower.includes('ketchup') || lower.includes('mustard') || lower.includes('dip');
        };
        if (isCondiment(newItem.originalName) || isCondiment(newItem.keyword)) {
          if (newItem.estimatedWeightGrams > 50) {
            newItem.estimatedWeightGrams = 30;
            if (newItem.estimatedCalories) {
                newItem.estimatedCalories = Math.round(newItem.estimatedCalories * (30 / item.estimatedWeightGrams));
            }
            addDebugLog(\`[Volumetric Tuning] Capped high-density condiment "\${newItem.keyword}" to 30g.\`);
          }
        }

        if (!newItem.boundingBox2D || !Array.isArray(newItem.boundingBox2D) || newItem.boundingBox2D.length !== 4) {`;

code = code.replace(tuningSearch, tuningReplace);

fs.writeFileSync('server_vision_scout.ts', code);
