import fs from 'fs';

let content = fs.readFileSync('src/jobs/JobStore.ts', 'utf-8');

const applyMethod = `
  apply(event: JobEvent) {
    let writer = 'JobStore.apply';
    switch (event.type) {
      case 'SubmitStarted': writer = 'LogChat.submit'; break;
      case 'ServerStatus': writer = 'JobQueueRunner'; break;
      case 'AnalyzeFinished': writer = 'JobQueueRunner'; break;
      case 'AnalyzeFailed': writer = 'JobQueueRunner'; break;
      case 'PollerPayload': writer = 'poller'; break;
      case 'RealtimeRow': writer = 'realtime'; break;
    }
    const patch = eventToPatch(event);
    
    const job = this.jobs.get(event.id);
    if (job && patch.messages && patch.messages.length === 1 && (event.type === 'AnalyzeFinished' || event.type === 'PollerPayload' || event.type === 'RealtimeRow')) {
      const isNewTurn = !!job.inFlightTurnAt;
      const nonLive = (job.messages || []).filter((m: any) => !m.isLive);
      const assistantMsg = patch.messages[0];
      
      if (shouldMergeFoodEditTurn({
        isMedicalJob: job.kind === 'medical',
        mode: job.mode || patch.mode,
        inputMode: (job.inputSnapshot as any)?.mode,
        cleanMode: patch.result?.mode || job.mode,
        messages: nonLive,
      })) {
        patch.messages = mergeFoodEditMessages(nonLive, assistantMsg);
      } else if (isNewTurn) {
        patch.messages = [...nonLive, assistantMsg];
      } else {
        const lastAsstIdx = nonLive.map((m: any) => m.role).lastIndexOf('assistant');
        if (lastAsstIdx !== -1) {
          nonLive[lastAsstIdx] = assistantMsg;
          patch.messages = [...nonLive];
        } else {
          patch.messages = [...nonLive, assistantMsg];
        }
      }
    }
    
    this.commit(event.id, patch, writer);
  }

  updateJob(id: string, patch: Partial<AgentJob>) {
    this.commit(id, patch, 'JobStore.apply');
  }

  private commit(id: string, patch: Partial<AgentJob>, writer: string) {
`;

content = content.replace('updateJob(id: string, patch: Partial<AgentJob>) {', applyMethod);
content = content.replace("writer: 'JobStore.apply',", "writer: writer as any,");

fs.writeFileSync('src/jobs/JobStore.ts', content);
