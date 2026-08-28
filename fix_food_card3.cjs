const fs = require('fs');
let code = fs.readFileSync('src/components/chat-cards/FoodCard.tsx', 'utf8');

code = code.replace(
`                                  <h4 className="font-bold text-slate-800 dark:text-slate-100 text-[15px] leading-snug">
                                    {group.groupName}
                                  </h4>`,
`                                  {!(displayGroups.length === 1 && activeScoutItems.length === 1 && (group.groupName === activeScoutItems[0].keyword || group.groupName === activeScoutItems[0].originalName)) && (
                                    <h4 className="font-bold text-slate-800 dark:text-slate-100 text-[15px] leading-snug">
                                      {group.groupName}
                                    </h4>
                                  )}`
);

fs.writeFileSync('src/components/chat-cards/FoodCard.tsx', code, 'utf8');
console.log('Fixed duplicate groupName');
