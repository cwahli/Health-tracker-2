const fs = require('fs');
let code = fs.readFileSync('src/components/LogChat.tsx', 'utf-8');

const oldMedicalBlock = `
        if (agentType) {
          let currentStep = 'medical_analyze';
          if (agentType === 'agent1') {
            if (dataReviewBatchIdx !== null && dataReviewBatchIdx !== undefined) {
              currentStep = 'agent1';
            } else {
              // New user-typed text queries must ALWAYS start fresh at Step 1
              currentStep = 'agent1_step1';
            }
            // Also find and attach extractedData and bucketMapping if available
            const jsonMsg = [...messages].reverse().find(m => m.data?.agentResult?.extractedData || m.extractedData);
            if (jsonMsg) {
              bodyData.extractedData = jsonMsg.agentResult?.extractedData || jsonMsg.extractedData;
            } else if (extractedData && extractedData.length > 0) {
              bodyData.extractedData = extractedData;
            }
            if (lastProcessedIndex !== null && lastProcessedIndex !== undefined) {
              bodyData.lastProcessedIndex = lastProcessedIndex;
            } else if (remainingText) {
              bodyData.remainingText = remainingText;
            }
            if (currentBatch > 1) {
              bodyData.currentBatch = currentBatch;
            }
            if (estimatedTotalMarkers !== null) {
              bodyData.estimatedTotalMarkers = estimatedTotalMarkers;
            }
            const allUserText = messages.filter(m => m.role === 'user').map(m => m.content).join('\\n\\n');
            if (allUserText) {
              bodyData.originalReportText = allUserText;
            }
            const mapMsg = [...messages].reverse().find(m => m.data?.agentResult?.bucketMapping || m.data?.bucketMapping);
            if (mapMsg) {
              bodyData.bucketMapping = typeof (mapMsg.agentResult?.bucketMapping || mapMsg.bucketMapping) === 'string'
                ? (mapMsg.agentResult?.bucketMapping || mapMsg.bucketMapping)
                : JSON.stringify(mapMsg.agentResult?.bucketMapping || mapMsg.bucketMapping);
            }
          } else {
            currentStep = agentType;
          }
          bodyData.agentType = currentStep;
          const deletedIds = profile?.deletedBiomarkerLogIds || {};
          bodyData.biomarkerHistory = (biomarkerHistory || []).filter(h => h.sync_state !== 'delete' && !deletedIds[h.id]);
          bodyData.biomarkers = biomarkers || {};
          bodyData.actions = actions || [];
          bodyData.agentDiagnosticSummary = profile?.agentDiagnosticSummary || '';

          if (currentStep === 'data_review' || currentStep === 'agent1') {
            let batchKeys: string[] = [];
            if (typeof textToSend === 'string' && textToSend.includes(':')) {
              const parts = textToSend.split(':');
              const candidateKeys = parts.slice(1).join(':').split(/[\\n,]/).map((s: string) => s.trim().toLowerCase()).filter(Boolean);
              if (candidateKeys.length > 0 && candidateKeys.length <= 200) {
                batchKeys = candidateKeys;
              }
            }
            const flaggedList = detectFlaggedTelemetryErrors(biomarkers || {}, profile, biomarkerHistory || [], biomarkerDefinitions);

            if (batchKeys.length === 0 && dataReviewBatchKeys && dataReviewBatchKeys.length > 0) {
              batchKeys = dataReviewBatchKeys;
            } else if (batchKeys.length === 0 && dataReviewBatchIdx === 'custom') {
              try {
                const drKey = \`datareview_custom_batch_keys_\${userIdentifier}\`;
                const a1Key = \`agent1_custom_batch_keys_\${userIdentifier}\`;
                const raw = (currentStep === 'data_review' ? localStorage.getItem(drKey) : localStorage.getItem(a1Key))
                          || localStorage.getItem(drKey)
                          || localStorage.getItem(a1Key);
                batchKeys = JSON.parse(raw || '[]');
              } catch(e) {}
            } else if (batchKeys.length === 0 && dataReviewBatchIdx !== null && dataReviewBatchIdx !== undefined) {
              const allKnownKeys = new Set<string>();
              (biomarkerHistory || []).forEach((h: any) => {
                if (h.biomarkers) {
                  Object.keys(h.biomarkers).forEach(k => {
                    if (h.biomarkers[k] !== undefined && h.biomarkers[k] !== null && h.biomarkers[k] !== '') {
                      allKnownKeys.add(k);
                    }
                  });
                }
              });
              if (biomarkers) {
                Object.keys(biomarkers).forEach(k => {
                  if (biomarkers[k] !== undefined && biomarkers[k] !== null && biomarkers[k] !== '') {
                    allKnownKeys.add(k);
                  }
                });
              }
              const markerKeysList = Array.from(allKnownKeys).sort((a, b) => a.localeCompare(b));
              const bSize = localBatchSize || batchSize || 20;
              const batchRes: string[][] = [];
              for (let i = 0; i < markerKeysList.length; i += bSize) {
                batchRes.push(markerKeysList.slice(i, i + bSize));
              }
              batchKeys = batchRes[dataReviewBatchIdx as number] || [];
            } else if (batchKeys.length === 0) {
              // Fallback when neither batch keys nor batch index were explicitly provided
              if (flaggedList.length > 0) {
                batchKeys = flaggedList.map(f => f.key);
              } else {
                const allKnownKeys = new Set<string>();
                (biomarkerHistory || []).forEach((h: any) => {
                  if (h.biomarkers) {
                    Object.keys(h.biomarkers).forEach(k => {
                      if (h.biomarkers[k] !== undefined && h.biomarkers[k] !== null && h.biomarkers[k] !== '') {
                        allKnownKeys.add(k);
                      }
                    });
                  }
                });
                if (biomarkers) {
                  Object.keys(biomarkers).forEach(k => {
                    if (biomarkers[k] !== undefined && biomarkers[k] !== null && biomarkers[k] !== '') {
                      allKnownKeys.add(k);
                    }
                  });
                }
                batchKeys = Array.from(allKnownKeys).sort((a, b) => a.localeCompare(b));
              }
            }
            bodyData.batchKeys = batchKeys;
            bodyData.batchBiomarkers = batchKeys.map(k => {
              const customDef = profile?.customBiomarkers?.[k];
              const historyEntries: { date: string, value: any }[] = [];
              (biomarkerHistory || []).forEach((h: any) => {
                if (h.biomarkers && h.biomarkers[k] !== undefined && h.biomarkers[k] !== null && h.biomarkers[k] !== '') {
                  historyEntries.push({ date: h.date || 'unknown', value: h.biomarkers[k] });
                }
              });
              const val = (biomarkers && biomarkers[k] !== undefined && biomarkers[k] !== null && biomarkers[k] !== '')
                ? biomarkers[k]
                : (historyEntries[0]?.value ?? '');
              return {
                key: k,
                name: customDef?.name || k,
                userValue: val,
                value: val,
                unit: customDef?.unit || '',
                normalRange: customDef?.normalRange || '',
                historicalEntries: historyEntries,
                historicalSummary: historyEntries.map(e => \`\${e.date}: \${e.value}\`).join(' → ')
              };
            });
            bodyData.flaggedBiomarkers = flaggedList.map(f => f.key);
          }
        } else {
          // If agentType is missing for some reason, ensure history is sent
          const deletedIds = profile?.deletedBiomarkerLogIds || {};
          bodyData.biomarkerHistory = (biomarkerHistory || []).filter(h => h.sync_state !== 'delete' && !deletedIds[h.id]);
          bodyData.agentType = 'medical_analyze';
        }
`;

const newMedicalBlock = `
        let currentStep = 'medical_analyze';
        bodyData.agentType = currentStep;
        
        const deletedIds = profile?.deletedBiomarkerLogIds || {};
        bodyData.biomarkerHistory = (biomarkerHistory || []).filter(h => h.sync_state !== 'delete' && !deletedIds[h.id]);
        bodyData.biomarkers = biomarkers || {};
        bodyData.actions = actions || [];
        bodyData.agentDiagnosticSummary = profile?.agentDiagnosticSummary || '';
`;

if (code.includes('if (agentType) {')) {
  code = code.replace(oldMedicalBlock, newMedicalBlock);
  fs.writeFileSync('src/components/LogChat.tsx', code, 'utf-8');
  console.log('Replaced medical agent block!');
} else {
  console.log('Could not find the target block');
}
