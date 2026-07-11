const fs = require('fs');
let code = fs.readFileSync('src/components/AgentResultTable.tsx', 'utf8');

// Fix 1: isSameUnit / dictUnit check
const search1 = `            if (isValueMatch && isSameUnit(rowUnit, dictUnit)) {
              isSynced = true;
              changeReason = \`Match: Log already exists for \${row.date}\`;
            } else if (isValueMatch && !isSameUnit(rowUnit, dictUnit)) {
              isUnitChanged = true;
              oldUnit = dictUnit;
              changeReason = \`It looks like you have the wrong metric (\${rowUnit}). Would you like to convert it to IS (\${dictUnit})?\`;
            }`;

const replace1 = `            if (isValueMatch && (!dictUnit || isSameUnit(rowUnit, dictUnit))) {
              isSynced = true;
              changeReason = \`Match: Log already exists for \${row.date}\`;
            } else if (isValueMatch && dictUnit && !isSameUnit(rowUnit, dictUnit)) {
              isUnitChanged = true;
              oldUnit = dictUnit;
              changeReason = \`It looks like you have the wrong metric (\${rowUnit}). Would you like to convert it to IS (\${dictUnit})?\`;
            }`;

// We know it occurs twice. Let's do split-join.
code = code.split(search1).join(replace1);

// Fix 2: new reading on different date should be isNew, not isChanged.
const search2 = `          } else {
            const sortedHistory = [...existingEntries].sort((a, b) => b.date.localeCompare(a.date));
            const latestVal = sortedHistory[0].biomarkers[key];
            if (latestVal !== undefined) {
              isChanged = true;
              oldValue = latestVal;
              changeReason = \`New reading of \${typeof row.value === 'object' ? JSON.stringify(row.value) : String(row.value || '')} logged on \${typeof row.date === 'object' ? JSON.stringify(row.date) : String(row.date || '')}\`;
            }
          }`;

const replace2 = `          } else {
            const sortedHistory = [...existingEntries].sort((a, b) => b.date.localeCompare(a.date));
            const latestVal = sortedHistory[0].biomarkers[key];
            if (latestVal !== undefined) {
              isNew = true;
              isChanged = false;
              changeReason = \`New reading of \${typeof row.value === 'object' ? JSON.stringify(row.value) : String(row.value || '')} logged on \${typeof row.date === 'object' ? JSON.stringify(row.date) : String(row.date || '')}\`;
            }
          }`;

code = code.split(search2).join(replace2);

fs.writeFileSync('src/components/AgentResultTable.tsx', code);
console.log("Updated exactMatch logic successfully.");
