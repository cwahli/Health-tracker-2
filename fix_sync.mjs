import fs from 'fs';

let content = fs.readFileSync('src/jobs/SupabaseJobSync.ts', 'utf-8');

content = content.replace(
  "const assistantMsg = {",
  "assistantMsg = {"
);
content = content.replace(
  "let updatedMessages = existing?.messages;",
  "let updatedMessages = existing?.messages;\n            let assistantMsg: any = undefined;"
);
// same for the second block in realtime
content = content.replace(
  "const assistantMsg = {",
  "assistantMsg = {"
); // it will replace the first one again or the second one? let's use replaceAll.
content = content.replaceAll(
  "const assistantMsg = {",
  "assistantMsg = {"
);
content = content.replaceAll(
  "let updatedFields: any = {",
  "let assistantMsg: any = undefined;\n          let updatedFields: any = {"
);

fs.writeFileSync('src/jobs/SupabaseJobSync.ts', content);
