const fs = require('fs');
let code = fs.readFileSync('serverJobs.ts', 'utf8');

const target = `      if (prebuiltIngestTrace && !finalMessage && (!images || images.length === 0) && (!photoUrls || photoUrls.length === 0)) {
        accumulatedLogs.push(\`[System] Intercepted table. 0 unmatched rows. Skipping LLM.\`);
        finalData = {
          extractedData: [],
          text: 'I have parsed the structured table. No leftover rows to extract.',
          ingestTrace: prebuiltIngestTrace
        };
      } else {`;

const replacement = `      if (prebuiltIngestTrace && !finalMessage && (!images || images.length === 0) && (!photoUrls || photoUrls.length === 0)) {
        accumulatedLogs.push(\`[System] Intercepted table. 0 unmatched rows. Skipping LLM.\`);
        
        const highConfRows = prebuiltIngestTrace.rows?.filter((r: any) => r.bucket === 'high_confidence') || [];
        const flaggedRows = prebuiltIngestTrace.rows?.filter((r: any) => r.bucket === 'flagged') || [];
        
        let extractedDate = new Date().toISOString().split('T')[0];
        if (payload.imageDates && payload.imageDates.length > 0) {
          extractedDate = payload.imageDates[0];
        }
        
        const modificationCommand = flaggedRows.map((r: any) => ({
          action: 'update_biomarker',
          keyName: r.canonicalKey,
          date: extractedDate,
          oldValue: r.rawValue,
          reason: r.comment || 'Flagged for review'
        }));

        finalData = {
          extractedData: highConfRows.map((r: any) => ({
            name: r.printedName,
            value: r.rawValue,
            unit: r.rawUnit,
            biomarker: r.canonicalKey
          })),
          modificationCommand: modificationCommand.length > 0 ? modificationCommand : undefined,
          text: 'I have parsed the structured table. No leftover rows to extract.',
          ingestTrace: prebuiltIngestTrace
        };
      } else {`;

code = code.replace(target, replacement);
fs.writeFileSync('serverJobs.ts', code);
