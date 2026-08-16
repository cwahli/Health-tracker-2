    if (agentType === 'medical_extract') {
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
        }
      });

      const finalRowsFallback = parsedRows.map((row: any) => {
        const biomarkerName = row.biomarker || row.name || row.key || 'Unknown';
