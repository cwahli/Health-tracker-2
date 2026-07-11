const fs = require('fs');
let code = fs.readFileSync('src/components/AgentResultTable.tsx', 'utf8');

const target = `        const newGroup = row.standardMedicalGrouping || 'Other';
        const oldGroup = customDef?.standardMedicalGrouping || 'Other';
        const isGroupChanged = !!customDef && newGroup !== oldGroup;

        let changeReason = row.noChangeNeeded 
          ? \`No changes needed. Entry is already up-to-date.\` 
          : \`Extracted new \${biomarkerName}: \${typeof row.value === 'object' ? JSON.stringify(row.value) : String(row.value || '')} \${rowUnit}\`;
        let oldValue: any = undefined;
        let oldUnit: any = undefined;
        let isChanged = isGroupChanged;
        let isSynced = false;
        let isUnitChanged = false;

        if (!row.noChangeNeeded && !isNew && existingEntries.length > 0) {
          const exactMatch = existingEntries.find((h: any) => h.date === row.date && h.biomarkers?.[key] !== undefined);`;

const replacement = `        const newGroup = row.standardMedicalGrouping || 'Other';
        const oldGroup = customDef?.standardMedicalGrouping || 'Other';
        const isGroupChanged = !!customDef && newGroup !== oldGroup;

        const normalizeDate = (d: string) => {
          if (!d) return d;
          const match1 = String(d).match(/^(\\d{4})-(\\d{1,2})-(\\d{1,2})$/);
          if (match1) return \`\${match1[1]}-\${match1[2].padStart(2, '0')}-\${match1[3].padStart(2, '0')}\`;
          const match2 = String(d).match(/^(\\d{1,2})-(\\d{1,2})-(\\d{4})$/);
          if (match2) return \`\${match2[3]}-\${match2[2].padStart(2, '0')}-\${match2[1].padStart(2, '0')}\`;
          return String(d);
        };
        const normalizedRowDate = normalizeDate(row.date);

        let changeReason = row.noChangeNeeded 
          ? \`No changes needed. Entry is already up-to-date.\` 
          : \`Extracted new \${biomarkerName}: \${typeof row.value === 'object' ? JSON.stringify(row.value) : String(row.value || '')} \${rowUnit}\`;
        let oldValue: any = undefined;
        let oldUnit: any = undefined;
        let isChanged = false;
        let isSynced = false;
        let isUnitChanged = false;

        if (!row.noChangeNeeded && !isNew && existingEntries.length > 0) {
          const exactMatch = existingEntries.find((h: any) => normalizeDate(h.date) === normalizedRowDate && h.biomarkers?.[key] !== undefined);`;

code = code.split(target).join(replacement);
fs.writeFileSync('src/components/AgentResultTable.tsx', code);
