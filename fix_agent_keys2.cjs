const fs = require('fs');
let code = fs.readFileSync('src/components/AgentResultTable.tsx', 'utf8');

const helperCode = `
export const resolveBiomarkerKey = (rawKey: string, rawName: string, profile: any) => {
  const cleanName = (n: string): string => n.split('(')[0].split('[')[0].trim();
  const cleaned = cleanName(String(rawName || rawKey));
  const safeKey = cleaned.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  let key = rawKey || safeKey;
  
  const currentCustoms = profile?.customBiomarkers || {};
  let targetKey = key;
  
  const stdMatch = !currentCustoms[key] ? biomarkerDefinitions.find(d => {
    const nameMatch = d.name.toLowerCase() === cleaned.toLowerCase() || d.key.toLowerCase() === cleaned.toLowerCase() || cleanName(d.name).toLowerCase() === cleaned.toLowerCase();
    return nameMatch;
  }) : null;
  
  if (stdMatch) {
    targetKey = stdMatch.key;
  } else {
    let existingKey = Object.keys(currentCustoms).find(k => {
      const nameMatch = cleanName(currentCustoms[k]?.name || '').toLowerCase() === cleaned.toLowerCase();
      const keyMatch = k.toLowerCase() === cleaned.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      return nameMatch || keyMatch;
    });
    if (existingKey) {
      targetKey = existingKey;
    }
  }
  return targetKey;
};
`;

code = code.replace(`export const AgentResultTable: React.FC<AgentResultTableProps> = ({`, helperCode + `\nexport const AgentResultTable: React.FC<AgentResultTableProps> = ({`);

fs.writeFileSync('src/components/AgentResultTable.tsx', code);
console.log("Updated keys successfully!");
