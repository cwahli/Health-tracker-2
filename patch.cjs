const fs = require('fs');
const file = 'src/mealBuild/consolidate.ts';
let content = fs.readFileSync(file, 'utf8');

const target = `    items: Array.isArray(json.items) ? json.items.map((i: any, index: number) => ({
      ...i,
      scoutIndex: i.scoutIndex ?? index,
      itemId: i.itemId || generateId()
    })) : [],`;

const replacement = `    items: Array.isArray(json.items) && json.items.length > 0 ? json.items.map((i: any, index: number) => ({
      ...i,
      scoutIndex: i.scoutIndex ?? index,
      itemId: i.itemId || generateId()
    })) : (Array.isArray(json.itemsBreakdown) ? json.itemsBreakdown.map((i: any, index: number) => ({
      ...i,
      scoutIndex: i.scoutIndex ?? index,
      itemId: i.itemId || generateId()
    })) : []),`;

if (content.includes(target)) {
    content = content.replace(target, replacement);
    fs.writeFileSync(file, content);
    console.log("Successfully patched consolidate.ts");
} else {
    console.log("Target not found!");
}
