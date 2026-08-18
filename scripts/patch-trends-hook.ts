import fs from 'fs';
const path = 'src/components/TrendsTab.tsx';
let code = fs.readFileSync(path, 'utf8');

code = code.replace(
  "return { nutrientAverages, bioAverages, allBioKeys: Array.from(allBioKeys) };",
  "return { nutrientAverages, bioAverages, allBioKeys: Array.from(allBioKeys) };\n  // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, [activeFoodLogs, activeHistory, selectedMetric, summaryDays, report, profile, auditReport, aliasKeysToHide]);\n"
);
code = code.replace(
  "const getChartData = () => {",
  "const getChartData = useCallback(() => {"
);
code = code.replace(
  "return compiled;\n  };",
  "return compiled;\n  // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, [activeFoodLogs, activeHistory, selectedMetric, summaryDays, report, profile, auditReport, aliasKeysToHide]);"
);

fs.writeFileSync(path, code);
