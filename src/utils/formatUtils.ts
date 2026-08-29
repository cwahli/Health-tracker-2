export function formatMessageContent(content: any, msg?: any): string {
  if (!content && msg?.data?.agentResult) {
    const res = msg.data.agentResult;
    if (typeof res.text === 'string' && res.text.trim()) return res.text;
    if (typeof res.message === 'string' && res.message.trim()) return res.message;
    if (typeof res.report?.globalSummary === 'string') return res.report.globalSummary;
    if (typeof res.globalSummary === 'string') return res.globalSummary;
    if (typeof res.explanation === 'string') return res.explanation;
    if (typeof res.summary === 'string') return res.summary;
    if (res.summary && typeof res.summary === 'object') {
      if (typeof res.summary.primaryDiagnosis === 'string') return res.summary.primaryDiagnosis;
    }
  }

  if (!content) return '';

  let strContent = typeof content === 'object' ? JSON.stringify(content) : String(content);

  const res = msg?.data?.agentResult || msg?.agentResult;
  if (res?.dietitianScratchpad && strContent.trim() === res.dietitianScratchpad.trim()) return '';
  if (res?.scoutScratchpad && strContent.trim() === res.scoutScratchpad.trim()) return '';
  if (res?._internalReasoning && strContent.trim() === res._internalReasoning.trim()) return '';

  const trimmed = strContent.trim();
  const unwrapFence = (s: string) => {
    let t = s.trim();
    if (t.startsWith('```')) {
      t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    }
    return t;
  };
  const cleanStr = unwrapFence(trimmed);

  if (cleanStr.includes('_internalReasoning') || cleanStr.includes('dietitianScratchpad') || cleanStr.includes('scoutScratchpad')) {
    try {
      const parsed = JSON.parse(cleanStr);
      if (parsed.message && typeof parsed.message === 'string' && !parsed.message.startsWith('{')) return parsed.message;
      if (parsed.text && typeof parsed.text === 'string' && !parsed.text.startsWith('{')) return parsed.text;
    } catch (e) {
      const msgMatch = cleanStr.match(/"message"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
      if (msgMatch && msgMatch[1]) return msgMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
      const textMatch = cleanStr.match(/"text"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
      if (textMatch && textMatch[1]) return textMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
    }
    return '';
  }

  if (cleanStr.startsWith('{') || cleanStr.startsWith('[')) {
    try {
      const parsed = JSON.parse(cleanStr);
      const reportObj = parsed.report || parsed;

      const extractStr = (val: any): string | null => {
        if (!val) return null;
        if (typeof val === 'string' && val.trim()) {
          const vTrim = val.trim();
          if (!vTrim.startsWith('{') && !vTrim.includes('_internalReasoning')) return vTrim;
        }
        if (typeof val === 'object') {
          if (typeof val.text === 'string' && val.text.trim() && !val.text.trim().startsWith('{')) return val.text;
          if (typeof val.message === 'string' && val.message.trim() && !val.message.trim().startsWith('{')) return val.message;
          if (typeof val.primaryDiagnosis === 'string') return val.primaryDiagnosis;
          if (typeof val.globalSummary === 'string') return val.globalSummary;
          if (typeof val.summary === 'string' && typeof val.summary === 'string' && !val.summary.startsWith('{')) return val.summary;
          if (typeof val.explanation === 'string') return val.explanation;
          return null;
        }
        return null;
      };

      if (reportObj.text) { const s = extractStr(reportObj.text); if (s) return s; }
      if (reportObj.message) { const s = extractStr(reportObj.message); if (s) return s; }
      if (parsed.text) { const s = extractStr(parsed.text); if (s) return s; }
      if (parsed.message) { const s = extractStr(parsed.message); if (s) return s; }
      if (reportObj.globalSummary) { const s = extractStr(reportObj.globalSummary); if (s) return s; }
      if (reportObj.summary) { const s = extractStr(reportObj.summary); if (s) return s; }
      if (reportObj.explanation) { const s = extractStr(reportObj.explanation); if (s) return s; }

      // If this is structured payload, suppress raw JSON dump to prevent showing schema fields to user
      return '';
    } catch (e) {
      const textMatch = cleanStr.match(/"text"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
      if (textMatch && textMatch[1]) return textMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
      const msgMatch = cleanStr.match(/"message"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
      if (msgMatch && msgMatch[1]) return msgMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
      const summaryMatch = cleanStr.match(/"summary"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
      if (summaryMatch && summaryMatch[1]) return summaryMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');

      if (cleanStr.includes('_internalReasoning') || cleanStr.startsWith('{')) {
        return '';
      }

      if (msg?.isLive || msg?.agentType) {
        return '';
      }

      return strContent;
    }
  }

  return strContent;
}
