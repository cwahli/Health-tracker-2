const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const target = `                  const isReviewJob = snapAgentType === 'biomarker_review' || cleanResult.agentType === 'biomarker_review';
                  const reviewCmds = isReviewJob
                    ? enrichReviewModificationCommands(
                        cleanResult.modificationCommand || cleanResult.agentResult?.modificationCommand || [],
                        (job.inputSnapshot as any)?.biomarkerHistory || [],
                        collectCatalogUnitMap(profileRef.current)
                      )
                    : (cleanResult.modificationCommand || null);`;

const replacement = `                  const isReviewJob = snapAgentType === 'biomarker_review' || cleanResult.agentType === 'biomarker_review';
                  const reviewCmds = (cleanResult.modificationCommand || cleanResult.agentResult?.modificationCommand)
                    ? enrichReviewModificationCommands(
                        cleanResult.modificationCommand || cleanResult.agentResult?.modificationCommand || [],
                        (job.inputSnapshot as any)?.biomarkerHistory || [],
                        collectCatalogUnitMap(profileRef.current)
                      )
                    : null;`;

code = code.replace(target, replacement);

const target2 = `                    modificationCommand: isReviewJob ? reviewCmds : (cleanResult.agentResult?.modificationCommand || cleanResult.modificationCommand),`;
const replacement2 = `                    modificationCommand: reviewCmds,`;

code = code.replace(target2, replacement2);

fs.writeFileSync('src/App.tsx', code);
