import fs from 'fs';

let content = fs.readFileSync('src/jobs/SupabaseJobSync.ts', 'utf-8');

const target1 = `              if (shouldMergeFoodEditTurn({
                isMedicalJob: existing.kind === 'medical',
                mode: existing.mode || backendJob.mode,
                inputMode: (existing.inputSnapshot as any)?.mode,
                cleanMode: updatedResult.mode || backendJob.mode,
                messages: nonLive,
              })) {
                updatedMessages = mergeFoodEditMessages(nonLive, assistantMsg);
              } else if (isNewTurn) {
                updatedMessages = [...nonLive, assistantMsg];
              } else {
                const lastAsstIdx = nonLive.map((m: any) => m.role).lastIndexOf('assistant');
                if (lastAsstIdx !== -1) {
                  nonLive[lastAsstIdx] = assistantMsg;
                  updatedMessages = [...nonLive];
                } else {
                  updatedMessages = [...nonLive, assistantMsg];
                }
              }
            }

            JobStore.updateJob(jobId, {
              status: backendJob.status || 'succeeded',
              inFlightTurnAt: backendJob.status === 'succeeded' ? undefined : existing?.inFlightTurnAt,
              result: updatedResult,
              mealBuild: updatedResult.mealBuild || existing?.mealBuild,
              messages: updatedMessages,
              photoUrl: updatedResult.photoUrl || existing?.photoUrl,
              debugUrl: updatedResult.debugUrl || existing?.debugUrl
            });`;

const replacement1 = `            }

            JobStore.apply({
              type: 'PollerPayload',
              id: jobId,
              status: backendJob.status || 'succeeded',
              inFlightTurnAt: backendJob.status === 'succeeded' ? undefined : existing?.inFlightTurnAt,
              result: updatedResult,
              mealBuild: updatedResult.mealBuild || existing?.mealBuild,
              messages: assistantMsg ? [assistantMsg] : undefined,
              currentTurn: backendJob.current_turn,
              photoUrl: updatedResult.photoUrl || existing?.photoUrl,
              debugUrl: updatedResult.debugUrl || existing?.debugUrl
            });`;

content = content.replace(target1, replacement1);

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

          JobStore.updateJob(row.id, updatedFields);`;

const replacement2 = `            }
          }

          JobStore.apply({
            type: 'RealtimeRow',
            id: row.id,
            status: row.status,
            result: cleanRes,
            messages: assistantMsg ? [assistantMsg] : undefined,
            currentTurn: row.current_turn,
            statusMessage: updatedFields.statusMessage,
            progressPercent: updatedFields.progressPercent,
          });`;

content = content.replace(target2, replacement2);
content = content.replace("JobStore.updateJob(j.id, { status: 'failed', statusMessage: 'Job timed out after 10 minutes' });", "JobStore.apply({ type: 'AnalyzeFailed', id: j.id, error: 'timeout' });");
content = content.replace("import { mergeFoodEditMessages, shouldMergeFoodEditTurn } from './mergeFoodEditMessages';", "");
fs.writeFileSync('src/jobs/SupabaseJobSync.ts', content);
