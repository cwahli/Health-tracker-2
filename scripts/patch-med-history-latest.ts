import fs from 'fs';
const path = 'src/components/MedicalHistoryTab.tsx';
let code = fs.readFileSync(path, 'utf8');

const replacement = `
  const getLatestValue = useCallback((key: string) => {
    const aliases = auditReport?.duplicateGroups?.find((g: any) => g.suggestedMasterKey.toLowerCase() === key.toLowerCase())?.candidateAliases || [];
    
    // Check history logs
    const historyLogs = activeHistory.filter(h => {
      if (!h.biomarkers) return false;
      if (h.biomarkers[key] !== undefined) return true;
      for (const alias of aliases) {
        if (h.biomarkers[alias] !== undefined) return true;
      }
      return false;
    });
    
    if (historyLogs.length > 0) {
      const sortedLogs = [...historyLogs].sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));
      let val = sortedLogs[0].biomarkers[key];
      if (val === undefined) {
        for (const alias of aliases) {
          if (sortedLogs[0].biomarkers[alias] !== undefined) {
            val = sortedLogs[0].biomarkers[alias];
            break;
          }
        }
      }
      return val;
    }
    
    // Fallback to today's biomarkers map
    if (biomarkers?.[key] !== undefined) return biomarkers[key];
    for (const alias of aliases) {
      if (biomarkers?.[alias] !== undefined) return biomarkers[alias];
    }
    return undefined;
  }, [activeHistory, biomarkers, auditReport]);
`;

code = code.replace(
  /const getLatestValue = useCallback\(\(key: string\) => \{[\s\S]*?\}, \[activeHistory, biomarkers\]\);/,
  replacement.trim()
);

fs.writeFileSync(path, code);
