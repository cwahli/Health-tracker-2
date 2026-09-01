/**
 * LogChat debug download — extracted so LogChat.tsx stays under the Q-1 ceiling.
 */
import { JobStore } from '../jobs/JobStore';
import { auth } from '../firebase';
import { getAgentRequestLogs } from './agentLogsTracker';
import { buildDebugMarkdownReport } from './debugPayload';

function extractLogString(val: any): string {
  if (!val) return '';
  if (typeof val === 'string') return val.trim();
  if (Array.isArray(val)) {
    return val.map((l: any) =>
      typeof l === 'string'
        ? l
        : (l.message ? (l.timestamp ? `[${l.timestamp}] ${l.message}` : l.message) : JSON.stringify(l))
    ).join('\n').trim();
  }
  return '';
}

function triggerBlobDownload(content: Blob, filename: string) {
  const url = window.URL.createObjectURL(content);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

export async function downloadJobDebugReport(args: {
  jobIdToDownload: string;
  msg: any;
  format?: 'json' | 'markdown';
  fallbackJobId?: string;
  messages: any[];
  inputText?: string;
  globalLiveLogs?: string;
}): Promise<void> {
  const { jobIdToDownload, msg, messages } = args;
  const format = args.format || 'markdown';
  const resolvedJobId =
    msg?.data?.jobId ||
    (msg?.id?.startsWith('msg_assistant_job_') ? msg.id.replace('msg_assistant_job_', 'job_') : '') ||
    (msg?.id?.startsWith('msg_assistant_') && !msg.id.includes('fail') && !msg.id.includes('clarify') && !/^\d+$/.test(msg.id.replace('msg_assistant_', '')) ? msg.id.replace('msg_assistant_', '') : '') ||
    (msg?.pendingFoodLog?.jobId || msg?.data?.pendingFoodLog?.jobId) ||
    jobIdToDownload ||
    args.fallbackJobId;

  const msgIndexForHistory = messages.findIndex((m: any) => m.id === msg?.id);
  const conversationHistory = (msgIndexForHistory >= 0 ? messages.slice(0, msgIndexForHistory) : [])
    .map((m: any) => ({ role: m.role, content: String(m.content || '').slice(0, 1000) }));

  const job = JobStore.getJob(resolvedJobId);
  const w = window as any;
  const clientConsoleLogs = w.__clientConsoleLogs || [];
  const networkErrors = w.__clientNetworkErrors || [];
  const lastUserAction = w.__lastUserAction || (args.inputText ? { action: 'chat_submit', prompt: args.inputText, timestamp: new Date().toISOString() } : undefined);

  const pendingFoodLog = msg?.data?.pendingFoodLog || msg?.pendingFoodLog || job?.result?.pendingFoodLog;
  const scoutItems = msg?.data?.scoutItems || msg?.data?.agentResult?.scoutItems || job?.result?.scoutItems;
  const receiptTable = msg?.data?.pendingFoodLog?.receiptTable || msg?.data?.receiptTable || job?.result?.receiptTable || job?.result?.pendingFoodLog?.receiptTable;

  let initialBackendLogs =
    extractLogString(msg?.data?.agentResult?.backendLogs) ||
    extractLogString(msg?.data?.agentResult?.globalLiveLogs) ||
    extractLogString(msg?.data?.backendLogs) ||
    extractLogString(msg?.agentResult?.backendLogs) ||
    extractLogString(pendingFoodLog?.backendLogs) ||
    extractLogString(pendingFoodLog?.rawLogs) ||
    extractLogString(job?.result?.backendLogs) ||
    extractLogString((job as any)?.clean_result?.backendLogs) ||
    extractLogString(job?.liveThoughts?.backendLogs) ||
    extractLogString(job?.liveThoughts?.globalLiveLogs) ||
    extractLogString((job as any)?.accumulatedLogs) ||
    args.globalLiveLogs ||
    '';

  const localPayload = {
    jobId: resolvedJobId,
    status: job?.status,
    result: {
      ...(job?.result || {}),
      lastUserAction,
      clientConsoleLogs,
      networkErrors,
    },
    messages: job?.messages,
    liveThoughts: job?.liveThoughts,
    backendLogs: initialBackendLogs,
    exportedAt: new Date().toISOString(),
    source: 'client-fallback',
  };

  try {
    const uid = auth.currentUser?.uid || 'anonymous';
    const fmtParam = format === 'markdown' ? '&format=markdown' : '';
    const res = await fetch(`/api/jobs/debug?jobId=${encodeURIComponent(resolvedJobId)}&userId=${encodeURIComponent(uid)}${fmtParam}`);
    if (res.ok) {
      const contentType = res.headers.get('content-type') || '';
      const text = await res.text();
      if (
        !contentType.includes('text/html') &&
        !text.trim().startsWith('<!doctype') &&
        !text.trim().startsWith('<html') &&
        !text.includes('Cookie check') &&
        !text.includes('No server execution trace found')
      ) {
        triggerBlobDownload(
          new Blob([text], { type: format === 'markdown' ? 'text/markdown;charset=utf-8' : 'application/json' }),
          `debug-${resolvedJobId}.${format === 'markdown' ? 'md' : 'json'}`
        );
        return;
      }
    }
  } catch (e) {
    console.warn('Proxy download failed, trying local fallback:', e);
  }

  let finalBackendLogs = localPayload.backendLogs;
  if (finalBackendLogs && (finalBackendLogs.startsWith('[Logs stored in R2') || finalBackendLogs.includes('.r2.dev/logs/'))) {
    const urlMatch = finalBackendLogs.match(/(https?:\/\/[^\s\]"]+\.r2.dev\/logs\/[^\s\]"]+)/i) ||
                     finalBackendLogs.match(/\[Logs stored in R2:\s*(https?:\/\/[^\s\]]+)\]/i);
    if (urlMatch) {
      const r2Url = urlMatch[1] || urlMatch[0];
      try {
        let r2Res = await fetch(`/api/r2/log-proxy?url=${encodeURIComponent(r2Url)}`);
        if (!r2Res.ok) r2Res = await fetch(r2Url);
        if (r2Res.ok) {
          const fetchedText = await r2Res.text();
          if (fetchedText && fetchedText.trim() && !fetchedText.startsWith('[Logs stored in R2')) {
            finalBackendLogs = fetchedText;
          }
        }
      } catch (e) {
        console.warn('[LogChat] Failed fetching R2 logs for debug download:', e);
      }
    }
  }

  if (!finalBackendLogs || finalBackendLogs.startsWith('[Logs stored in R2') || finalBackendLogs.length < 50) {
    try {
      const storedLogs = getAgentRequestLogs();
      const matchedReq = storedLogs.find(r =>
        r.id === resolvedJobId ||
        r.id === `server-job-${resolvedJobId}` ||
        (msg?.data?.requestId && r.id === msg.data.requestId) ||
        (msg?.id && r.id === msg.id) ||
        (pendingFoodLog?.id && r.id === pendingFoodLog.id)
      );
      if (matchedReq && matchedReq.logs && matchedReq.logs.length > 0) {
        finalBackendLogs = matchedReq.logs.map(l => typeof l === 'string' ? l : (l.timestamp ? `[${l.timestamp}] ${l.message}` : (l.message || JSON.stringify(l)))).join('\n');
      }
    } catch (e) {
      console.warn('[LogChat] Failed loading stored logs from tracker:', e);
    }
  }

  if (format === 'markdown') {
    const mdContent = buildDebugMarkdownReport({
      jobId: resolvedJobId,
      status: job?.status,
      mode: job?.result?.mode,
      agentType: job?.result?.agentType || msg?.data?.agentResult?.agentType || msg?.data?.agentType,
      message: job?.result?.message || msg?.content,
      backendLogs: finalBackendLogs,
      pendingFoodLog,
      scoutItems,
      receiptTable,
      error: job?.error?.message,
      lastUserAction: lastUserAction || job?.result?.lastUserAction || w.__lastUserAction,
      sessionEvents: job?.sessionEvents || job?.result?.sessionEvents,
      userActionBreadcrumbs: w.__userActionBreadcrumbs || job?.result?.userActionBreadcrumbs || [],
      clientConsoleLogs: clientConsoleLogs || job?.result?.clientConsoleLogs || w.__clientConsoleLogs || [],
      networkErrors: networkErrors || job?.result?.networkErrors || w.__clientNetworkErrors || [],
      usdaSearchResults: job?.result?.usdaSearchResults,
      brandSearchResults: job?.result?.brandSearchResults,
      comprehensiveNutrients: job?.result?.comprehensiveNutrients || pendingFoodLog?.nutrients,
      ingestTrace: job?.result?.ingestTrace || msg?.data?.ingestTrace || msg?.data?.agentResult?.ingestTrace,
      report: job?.result?.report || msg?.data?.report || msg?.data?.agentResult?.report,
      stageLedger: job?.result?.stageLedger || msg?.data?.stageLedger,
      historyLog: job?.result?.historyLog || msg?.data?.historyLog,
      conversationHistory,
    });
    triggerBlobDownload(new Blob([mdContent], { type: 'text/markdown;charset=utf-8' }), `debug-${resolvedJobId}.md`);
  } else {
    triggerBlobDownload(
      new Blob([JSON.stringify({ ...localPayload, backendLogs: finalBackendLogs }, null, 2)], { type: 'application/json' }),
      `debug-${resolvedJobId}.json`
    );
  }
}
