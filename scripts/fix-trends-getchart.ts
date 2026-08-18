import fs from 'fs';
const path = 'src/components/TrendsTab.tsx';
let code = fs.readFileSync(path, 'utf8');

code = code.replace(
  "return activeCompiled;\n  };",
  "return activeCompiled;\n  // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, [activeFoodLogs, activeHistory, selectedMetric, report, profile, auditReport, aliasKeysToHide]);"
);

fs.writeFileSync(path, code);
