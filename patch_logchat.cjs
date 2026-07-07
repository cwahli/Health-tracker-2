const fs = require('fs');
let code = fs.readFileSync('src/components/LogChat.tsx', 'utf8');

const targetEndpoint = `      if (type === 'food') endpoint = '/api/gemini/food-analyze';
      else if (type === 'food_idea') endpoint = '/api/gemini/food-idea';
      else endpoint = '/api/gemini/medical-analyze';`;
const replacementEndpoint = `      if (type === 'food') endpoint = '/api/gemini/food-analyze';
      else if (type === 'food_idea') endpoint = '/api/gemini/food-idea';
      else if (type === 'daily_recommendation') endpoint = '/api/gemini/daily-recommendation-chat';
      else endpoint = '/api/gemini/medical-analyze';`;
code = code.replace(targetEndpoint, replacementEndpoint);

const targetType = `  type: 'food' | 'medical' | 'food_idea';`;
const replacementType = `  type: 'food' | 'medical' | 'food_idea' | 'daily_recommendation';`;
code = code.replace(targetType, replacementType);

fs.writeFileSync('src/components/LogChat.tsx', code);
console.log("Patched LogChat endpoints");
