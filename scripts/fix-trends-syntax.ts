import fs from 'fs';
const path = 'src/components/TrendsTab.tsx';
let code = fs.readFileSync(path, 'utf8');

code = code.replace(
  "const getSummaryData = () => {",
  "const getSummaryData = useCallback(() => {"
);
code = code.replace(
  "  // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, [activeFoodLogs, activeHistory, selectedMetric, summaryDays, report, profile, auditReport, aliasKeysToHide]);\n\n  };",
  "  // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, [activeFoodLogs, activeHistory, selectedMetric, summaryDays, report, profile, auditReport, aliasKeysToHide]);"
);

fs.writeFileSync(path, code);
