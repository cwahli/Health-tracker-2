import fs from 'fs';
let code = fs.readFileSync('src/components/LogChat.tsx', 'utf8');

const targetStr = `            kind: family === 'D' ? 'food_compare' : 'food_log',
            mode: submissionMode,
            text: userContent || textToSend,
            images: stagedImagesForSubmit,`;

const replacement = `            kind: family === 'D' ? 'food_compare' : 'food_log',
            mode: submissionMode,
            text: ((userContent || textToSend || '').replace(/\\[.*?\\]/g, '').replace(/\\s+/g, ' ').trim()),
            images: stagedImagesForSubmit,`;

code = code.replace(targetStr, replacement);

const targetStr2 = `            lastUserAction: window.__lastUserAction || { action: 'chat_submit', prompt: userContent || textToSend, timestamp: new Date().toISOString() }
          };`;

const replacement2 = `            lastUserAction: window.__lastUserAction || { action: 'chat_submit', prompt: userContent || textToSend, timestamp: new Date().toISOString() },
            explicitFoodTags: explicitFoodTags.length > 0 ? explicitFoodTags : undefined
          };`;

code = code.replace(targetStr2, replacement2);
fs.writeFileSync('src/components/LogChat.tsx', code);
console.log("Patched submitPayload");
