import fs from 'fs';

let content = fs.readFileSync('src/jobs/SupabaseJobSync.ts', 'utf-8');

const target2 = `              if (shouldMergeFoodEditTurn({
                isMedicalJob: existingJob.kind === 'medical',
                mode: existingJob.mode || row.mode,
                inputMode: (existingJob.inputSnapshot as any)?.mode,
                cleanMode: cleanRes.mode || row.mode,
                messages: nonLive,
              })) {
                updatedFields.messages = mergeFoodEditMessages(nonLive, assistantMsg);
              } else if (isNewTurn) {
                updatedFields.messages = [...nonLive, assistantMsg];
              } else {
                const lastAsstIdx = nonLive.map((m: any) => m.role).lastIndexOf('assistant');
                if (lastAsstIdx !== -1) {
                  nonLive[lastAsstIdx] = assistantMsg;
                  updatedFields.messages = [...nonLive];
                } else {
                  updatedFields.messages = [...nonLive, assistantMsg];
                }
              }
            }
          }

          if (row.status === 'failed') {
            updatedFields.error = {
              class: 'permanent',
              message: row.status_message || 'Analysis failed on server',
            };
          }

          JobStore.apply({ type: 'RealtimeRow', id: row.id, ...updatedFields } as any);`;

const replacement2 = `            }
          }

          if (row.status === 'failed') {
            updatedFields.error = {
              class: 'permanent',
              message: row.status_message || 'Analysis failed on server',
            };
          }

          JobStore.apply({ type: 'RealtimeRow', id: row.id, ...updatedFields, messages: assistantMsg ? [assistantMsg] : undefined, currentTurn: row.current_turn } as any);`;

content = content.replace(target2, replacement2);
fs.writeFileSync('src/jobs/SupabaseJobSync.ts', content);
