const fs = require('fs');
let content = fs.readFileSync('server_routes_food_analyze.ts', 'utf8');
content = content.replace(
  'let updatedProfile = recOutput.updatedProfile ? { ...profile, ...recOutput.updatedProfile } : null;',
  `let updatedProfile = recOutput.updatedProfile ? { ...profile, ...recOutput.updatedProfile } : null;
    if (recOutput.modificationCommand && Array.isArray(recOutput.modificationCommand)) {
      if (!updatedProfile) updatedProfile = { ...profile };
      recOutput.modificationCommand.forEach((cmd: any) => {
        if (cmd.field && cmd.value !== undefined) {
           updatedProfile[cmd.field] = cmd.value;
        }
      });
    }`
);
fs.writeFileSync('server_routes_food_analyze.ts', content);
