import fs from 'fs';
let code = fs.readFileSync('src/components/LogChat.tsx', 'utf8');

const targetStr = `            const combinedMatches = [
              ...catalogMatches.map(m => ({ ...m, _listType: 'brand' })),
              ...matchingPreviousLogs.map(m => ({ ...m, _listType: 'previous_meal' }))
            ];`;

const replacement = `            const combinedMatches = [
              ...catalogMatches.map(m => ({ ...m, _listType: 'brand' })),
              ...matchingPreviousLogs.map(m => ({ ...m, _listType: 'previous_meal' }))
            ].filter(m => !explicitFoodTags.some(tag => tag.dbId === (m._listType === 'brand' ? m.food_id : m.id)));`;

code = code.replace(targetStr, replacement);
fs.writeFileSync('src/components/LogChat.tsx', code);
console.log("Patched combinedMatches filter");
