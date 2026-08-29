const fs = require('fs');
const content = fs.readFileSync('src/components/chat-cards/FoodCard.tsx', 'utf8');

const regex = /export const resolveHistoricalImgSrc = \([\s\S]*?\n};\n/;
const match = content.match(regex);
if (!match) {
  console.log("Not found");
  process.exit(1);
}

const funcStr = match[0];
let newContent = content.replace(funcStr, '');
const replacementStr = funcStr.replace('export const resolveHistoricalImgSrc', 'export const resolveHistoricalImgSrc');

// Insert it before export const FoodCard
newContent = newContent.replace('export const FoodCard:', replacementStr + '\nexport const FoodCard:');

fs.writeFileSync('src/components/chat-cards/FoodCard.tsx', newContent);
console.log("Fixed!");
