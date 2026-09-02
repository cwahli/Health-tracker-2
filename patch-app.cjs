const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf-8');

const oldHandleMedical = `          if ((agentType as string) === 'agent1' || (agentType as string) === 'medical_extract') {`;
const newHandleMedical = `          if ((agentType as string) === 'medical_analyze') {
            const filledRows = agentResult?.filledRows || [];
            
            // We want to construct exactly what the frontend expects for updates:
            // 1. Update Custom Biomarkers (draft catalogs and custom ranges)
            // 2. Append/Update Logs in History
            
            const updatedCustoms = { ...(updatedProfile.customBiomarkers || {}) };
            const newLogsToInsert = [];
            
            const recomputed: { [key: string]: number | string } = {};
            
            filledRows.forEach((row: any) => {
                if (row.newCatalogDraft && row.writeTarget === 'pending') {
                    // It's a Miss! Create a pending draft custom biomarker
                    const key = row.newCatalogDraft.suggestedKey || \`custom_\${Date.now()}_\${Math.random().toString(36).substring(2, 7)}\`;
                    updatedCustoms[key] = {
                        name: row.newCatalogDraft.name,
                        unit: row.newCatalogDraft.unit,
                        description: row.newCatalogDraft.description,
                        normalRange: row.newCatalogDraft.normalRange,
                        riskCategories: row.newCatalogDraft.riskCategories || [],
                        aliases: row.newCatalogDraft.aliases || [],
                        status: 'pending'
                    };
                    
                    if (row.logs && row.logs.length > 0) {
                        row.logs.forEach((log: any) => {
                            newLogsToInsert.push({
                                id: \`log_\${Date.now()}_\${Math.random().toString(36).substring(2, 9)}\`,
                                date: log.date,
                                biomarkers: { [key]: log.value },
                                note: log.comment || \`Draft extracted from \${row.printed}\`
                            });
                        });
                    }
                } else if (row.writeTarget === 'observation' && row.key) {
                    // It's a Hit!
                    const key = row.key;
                    
                    if (row.customRangeOverlay) {
                        const existing = updatedCustoms[key] || { name: row.printed, unit: row.unit };
                        updatedCustoms[key] = {
                            ...existing,
                            profileAdjustedNormalRange: row.customRangeOverlay
                        };
                    }
                    
                    if (row.logs && row.logs.length > 0) {
                        row.logs.forEach((log: any) => {
                            let existingLogIndex = currentHistory.findIndex((h: any) => h.date && String(h.date).split('T')[0] === log.date);
                            if (existingLogIndex >= 0) {
                                currentHistory[existingLogIndex].biomarkers[key] = log.value;
                            } else {
                                newLogsToInsert.push({
                                    id: \`log_\${Date.now()}_\${Math.random().toString(36).substring(2, 9)}\`,
                                    date: log.date,
                                    biomarkers: { [key]: log.value },
                                    note: log.comment || \`Extracted \${row.printed}\`
                                });
                            }
                        });
                    }
                }
            });
            
            updatedProfile.customBiomarkers = updatedCustoms;
            currentHistory = [...currentHistory, ...newLogsToInsert];
            
            currentHistory
                .filter((b: any) => b.sync_state !== 'delete')
                .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
                .forEach((log) => {
                    Object.entries(log.biomarkers || {}).forEach(([k, v]) => {
                        recomputed[k] = v as string | number;
                    });
                });
                
            setBiomarkers(recomputed);
            setBiomarkerHistory(currentHistory);
            
            await saveAndSync(updatedProfile, foodLogs, recomputed, currentHistory, actions, dailyBenefits, report, {
                type: 'medicalAnalyzeBatch',
                targetIds: currentHistory.map((h: any) => h.id)
            });
            
            if (activeJobId) {
                await JobStore.deleteJob(activeJobId);
                setActiveJobId(null);
            }
            // Do NOT close chat, let user see the response.
            // setIsMedicalChatOpen(false);
            setActiveAgentType(null);
            setCalibratingAgentType(null);
            return;
          }

          if ((agentType as string) === 'agent1' || (agentType as string) === 'medical_extract') {`;

if (code.includes(oldHandleMedical)) {
  code = code.replace(oldHandleMedical, newHandleMedical);
  fs.writeFileSync('src/App.tsx', code, 'utf-8');
  console.log('Patched App.tsx medical_analyze handler!');
} else {
  console.log('Could not find the target block in App.tsx');
}
