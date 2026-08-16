import fs from 'fs';
const file = 'src/components/AgentResultTable.tsx';
let text = fs.readFileSync(file, 'utf8');
const search = "    if (agentType === 'medical_extract') {\n      let parsedRows: any[] = [];\n      const entries = Array.isArray(agentResult) ? agentResult : [];\n      entries.forEach(entry => {\n        if (entry.tests && Array.isArray(entry.tests)) {\n          entry.tests.forEach((test: any) => { \n             parsedRows.push({\n               biomarker: test.originalTestName || test.key || 'Unknown',\n               name: test.originalTestName || test.key || 'Unknown',\n               key: test.key,\n               date: entry.date,\n               value: test.valueNumeric !== null && test.valueNumeric !== undefined ? test.valueNumeric : test.valueString,\n               unit: test.unit,\n               normalRange: test.normalRange,\n               explanation: test.doctorComment\n             });\n          });\n        }\n      });";
const replace = `    if (agentType === 'medical_extract') {
      let parsedRows: any[] = [];
      const entries = Array.isArray(agentResult) ? agentResult : [];
      entries.forEach(entry => {
        if (entry.tests && Array.isArray(entry.tests)) {
          entry.tests.forEach((test: any) => { 
             parsedRows.push({
               biomarker: test.originalTestName || test.key || 'Unknown',
               name: test.originalTestName || test.key || 'Unknown',
               key: test.key,
               date: entry.date,
               value: test.valueNumeric !== null && test.valueNumeric !== undefined ? test.valueNumeric : test.valueString,
               unit: test.unit,
               normalRange: test.normalRange,
               explanation: test.doctorComment
             });
          });
        } else if (entry.biomarker || entry.name) {
          parsedRows.push({
            biomarker: entry.name || entry.biomarker || 'Unknown',
            name: entry.name || entry.biomarker || 'Unknown',
            key: entry.biomarker || entry.key,
            date: entry.date,
            value: entry.numeric_value !== null && entry.numeric_value !== undefined ? entry.numeric_value : (entry.qualitative_value || entry.value),
            unit: entry.unit,
            normalRange: entry.normalRange,
            explanation: entry.explanation || entry.changeReason || ''
          });
        }
      });`;

const textSearch = text.substring(text.indexOf("if (agentType === 'medical_extract') {"), text.indexOf("const finalRowsFallback = parsedRows.map((row: any) => {"));

let newText = text.replace(textSearch, replace + "\n      ");
fs.writeFileSync(file, newText);
console.log("Patched!");
