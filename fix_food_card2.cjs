const fs = require('fs');
let code = fs.readFileSync('src/components/chat-cards/FoodCard.tsx', 'utf8');

code = code.replace(
`                  {msg.data?.pendingFoodLog && (
                    <div className="bg-transparent border-0 rounded-none p-0 shadow-none space-y-3 animation-fade-in w-full max-w-full min-w-0 overflow-hidden font-sans">`,
`                  {msg.data?.pendingFoodLog && !(mode === 'evaluation' && comparisonData && comparisonData.groups && comparisonData.groups.length > 0) && (
                    <div className="bg-transparent border-0 rounded-none p-0 shadow-none space-y-3 animation-fade-in w-full max-w-full min-w-0 overflow-hidden font-sans">`
);

fs.writeFileSync('src/components/chat-cards/FoodCard.tsx', code, 'utf8');
console.log('Fixed FoodCard duplicate card rendering');
