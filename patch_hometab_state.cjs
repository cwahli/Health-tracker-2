const fs = require('fs');
let code = fs.readFileSync('src/components/HomeTab.tsx', 'utf8');

const targetState = `  const [isFoodIdeaChatOpen, setIsFoodIdeaChatOpen] = React.useState(false);`;
const replacementState = `  const [isFoodIdeaChatOpen, setIsFoodIdeaChatOpen] = React.useState(false);
  const [isDailyRecommendationChatOpen, setIsDailyRecommendationChatOpen] = React.useState(false);`;
code = code.replace(targetState, replacementState);

fs.writeFileSync('src/components/HomeTab.tsx', code);
console.log("Patched state");
