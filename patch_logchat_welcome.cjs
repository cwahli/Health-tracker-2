const fs = require('fs');
let code = fs.readFileSync('src/components/LogChat.tsx', 'utf8');

code = code.replace(
  "const lastWelcomeIndex = messages.length - 1 - [...messages].reverse().findIndex(m => m.id.startsWith('welcome_'));",
  "const revIdx = [...messages].reverse().findIndex(m => m.id.startsWith('welcome_'));\n      const lastWelcomeIndex = revIdx >= 0 ? messages.length - 1 - revIdx : -1;"
);

code = code.replace(
  "const lastWelcomeIndex = messages.length - 1 - [...messages].reverse().findIndex(m => m.id.startsWith('welcome_'));",
  "const revIdx = [...messages].reverse().findIndex(m => m.id.startsWith('welcome_'));\n            const lastWelcomeIndex = revIdx >= 0 ? messages.length - 1 - revIdx : -1;"
);

// We need to fix the deletion logic. Should it delete ONLY past messages or everything? 
// If it deletes ONLY past messages, it should do setMessages(messages.slice(sessionStartIdx))
// Let's replace the deletion logic as well.

code = code.replace(
  `                            onClick={() => {
                              const lastWelcome = messages.findLast(m => m.id.startsWith('welcome_'));
                              if (lastWelcome) {
                                setMessages([lastWelcome]);
                              } else {
                                setMessages([messages[messages.length - 1]]);
                              }
                              setShowPastDiscussion(false);
                            }}`,
  `                            onClick={() => {
                              setMessages(messages.slice(sessionStartIdx));
                              setShowPastDiscussion(false);
                            }}`
);

fs.writeFileSync('src/components/LogChat.tsx', code);
console.log("Patched lastWelcomeIndex");
