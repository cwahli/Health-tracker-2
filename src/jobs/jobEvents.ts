import { AgentJob } from './types';

export type JobEvent = { result?: any; status?: any; error?: any; attemptCount?: number; resumeStage?: string; progressPercent?: number; clientSubmitPending?: boolean; photoUrl?: string; debugUrl?: string; mealBuild?: any; inFlightTurnAt?: number; attemptByStep?: any; abortController?: any; startedAt?: string; finishedAt?: string; retryNotBefore?: string } & (
  | { type: 'SubmitStarted'; id: string; mode?: string; inputSnapshot?: any; messages?: any[]; statusMessage?: string; currentTurn?: number; clientSubmitPending?: boolean }
  | { type: 'ServerStatus'; id: string; status: AgentJob['status']; statusMessage?: string }
  | { type: 'PollerPayload'; id: string; status: AgentJob['status']; result?: any; messages?: any[]; currentTurn?: number; updatedAt?: string }
  | { type: 'RealtimeRow'; id: string; status: AgentJob['status']; result?: any; currentTurn?: number; updatedAt?: string; statusMessage?: string; progressPercent?: number }
  | { type: 'AnalyzeFinished'; id: string; result?: any; messages?: any[]; currentTurn?: number }
  | { type: 'AnalyzeFailed'; id: string; error: AgentJob['error'] } );

export function eventToPatch(event: JobEvent): Partial<AgentJob> {
  const patch: Partial<AgentJob> = {};
  
  if ('mode' in event && event.mode !== undefined) patch.mode = event.mode;
  if ('inputSnapshot' in event && event.inputSnapshot !== undefined) patch.inputSnapshot = event.inputSnapshot;
  if ('messages' in event && event.messages !== undefined) patch.messages = event.messages;
  if ('statusMessage' in event && event.statusMessage !== undefined) patch.statusMessage = event.statusMessage;
  if ('currentTurn' in event && event.currentTurn !== undefined) patch.currentTurn = event.currentTurn;
  if ('clientSubmitPending' in event && event.clientSubmitPending !== undefined) patch.clientSubmitPending = event.clientSubmitPending;
  if ('status' in event && event.status !== undefined) patch.status = event.status;
  if ('result' in event && event.result !== undefined) patch.result = event.result;
  if ('updatedAt' in event && event.updatedAt !== undefined) patch.updatedAt = event.updatedAt;
  if ('progressPercent' in event && event.progressPercent !== undefined) patch.progressPercent = event.progressPercent;
  if ('error' in event && event.error !== undefined) patch.error = event.error;

  
  if ('photoUrl' in event && event.photoUrl !== undefined) patch.photoUrl = event.photoUrl;
  if ('debugUrl' in event && event.debugUrl !== undefined) patch.debugUrl = event.debugUrl;
  if ('mealBuild' in event && event.mealBuild !== undefined) patch.mealBuild = event.mealBuild;
  if ('inFlightTurnAt' in event) patch.inFlightTurnAt = event.inFlightTurnAt as any;
  if ('attemptByStep' in event && event.attemptByStep !== undefined) patch.attemptByStep = event.attemptByStep;
  if ('abortController' in event && event.abortController !== undefined) patch.abortController = event.abortController;
  if ('startedAt' in event && event.startedAt !== undefined) patch.startedAt = event.startedAt;
  if ('finishedAt' in event) patch.finishedAt = event.finishedAt;
  if ('retryNotBefore' in event) patch.retryNotBefore = event.retryNotBefore;
  if ('attemptCount' in (event as any) && (event as any).attemptCount !== undefined) patch.attemptCount = (event as any).attemptCount;
  if ('resumeStage' in (event as any) && (event as any).resumeStage !== undefined) patch.resumeStage = (event as any).resumeStage;
  
  return patch;

}
