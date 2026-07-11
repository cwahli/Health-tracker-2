const fs = require('fs');
const glob = require('glob');

const files = glob.sync('src/**/*.tsx');

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let original = content;

  // Replace a.date.localeCompare(b.date)
  content = content.replace(/a\.date\.localeCompare\(b\.date\)/g, 'toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date))');
  content = content.replace(/b\.date\.localeCompare\(a\.date\)/g, 'toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date))');
  
  // MedicalHistoryTab.tsx has dateB.localeCompare(dateA)
  if (file.includes('MedicalHistoryTab.tsx')) {
    content = content.replace(/dateB\.localeCompare\(dateA\)/g, 'toYYYYMMDD(dateB).localeCompare(toYYYYMMDD(dateA))');
  }
  
  // AgentResultTable.tsx has String(a.date).localeCompare(String(b.date))
  if (file.includes('AgentResultTable.tsx')) {
    content = content.replace(/String\(a\.date\)\.localeCompare\(String\(b\.date\)\)/g, 'toYYYYMMDD(String(a.date)).localeCompare(toYYYYMMDD(String(b.date)))');
  }

  if (content !== original) {
    if (!content.includes('toYYYYMMDD')) {
      content = 'import { toYYYYMMDD } from "../utils/dateUtils";\n' + content;
    } else if (!content.match(/import.*toYYYYMMDD/)) {
        // Need to add import if it doesn't have it
        let importPath = '"../utils/dateUtils"';
        // count slashes to get depth
        const depth = file.split('/').length - 2;
        if (depth === 0) importPath = '"./utils/dateUtils"';
        else if (depth === 2) importPath = '"../../utils/dateUtils"';
        content = `import { toYYYYMMDD } from ${importPath};\n` + content;
    }
    fs.writeFileSync(file, content);
  }
});
