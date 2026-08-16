const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const target = `          if (logIdx >= 0 && cmd.newValue !== undefined) {
            updatedHistory[logIdx] = {
              ...updatedHistory[logIdx],
              biomarkers: {
                ...updatedHistory[logIdx].biomarkers,
                [cmd.keyName]: cmd.newValue
              },
              sync_state: 'update',
              updated_at: Date.now()
            };
            modifiedLogIds.push(updatedHistory[logIdx].id);
            madeChanges = true;
            hasNewBiomarkers = true;
          }`;

const replacement = `          if (logIdx >= 0 && cmd.newValue !== undefined) {
            updatedHistory[logIdx] = {
              ...updatedHistory[logIdx],
              biomarkers: {
                ...updatedHistory[logIdx].biomarkers,
                [cmd.keyName]: cmd.newValue
              },
              sync_state: 'update',
              updated_at: Date.now()
            };
            modifiedLogIds.push(updatedHistory[logIdx].id);
            madeChanges = true;
            hasNewBiomarkers = true;
          } else if (logIdx < 0 && cmd.newValue !== undefined && cmd.date) {
            const newLog = {
              id: \`log_\${Date.now()}_\${Math.random().toString(36).slice(2, 9)}\`,
              date: cmd.date,
              biomarkers: {
                [cmd.keyName]: cmd.newValue
              },
              sync_state: 'update',
              updated_at: Date.now()
            };
            updatedHistory.push(newLog);
            modifiedLogIds.push(newLog.id);
            madeChanges = true;
            hasNewBiomarkers = true;
          }`;

code = code.replace(target, replacement);
fs.writeFileSync('src/App.tsx', code);
