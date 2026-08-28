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

  const trimmed = strContent.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      const reportObj = parsed.report || parsed;

      const extractStr = (val: any): string | null => {
        if (!val) return null;
        if (typeof val === 'string' && val.trim()) return val;
        if (typeof val === 'object') {
          if (typeof val.text === 'string' && val.text.trim()) return val.text;
          if (typeof val.message === 'string' && val.message.trim()) return val.message;
          if (typeof val.primaryDiagnosis === 'string') return val.primaryDiagnosis;
          if (typeof val.globalSummary === 'string') return val.globalSummary;
          if (typeof val.summary === 'string') return val.summary;
          if (typeof val.explanation === 'string') return val.explanation;
          return null;
        }
        return String(val);
      };

      if (reportObj.text) { const s = extractStr(reportObj.text); if (s && !s.startsWith('{')) return s; }
      if (reportObj.message) { const s = extractStr(reportObj.message); if (s && !s.startsWith('{')) return s; }
      if (parsed.text) { const s = extractStr(parsed.text); if (s && !s.startsWith('{')) return s; }
      if (parsed.message) { const s = extractStr(parsed.message); if (s && !s.startsWith('{')) return s; }
      if (reportObj.globalSummary) { const s = extractStr(reportObj.globalSummary); if (s) return s; }
      if (reportObj.summary) { const s = extractStr(reportObj.summary); if (s && !s.startsWith('{')) return s; }
      if (reportObj.explanation) { const s = extractStr(reportObj.explanation); if (s) return s; }
      if (parsed.globalSummary) { const s = extractStr(parsed.globalSummary); if (s) return s; }
      if (parsed.summary) { const s = extractStr(parsed.summary); if (s && !s.startsWith('{')) return s; }
      if (parsed.explanation) { const s = extractStr(parsed.explanation); if (s) return s; }

      // If this message belongs to an agent card or has structured data,
      // never return _internalReasoning or raw structured json to user text.
      if (msg?.agentType || parsed.riskCategories || parsed.report?.riskCategories || parsed.foodData || parsed.pendingFoodLog || parsed.scoutItems || parsed.dishes) {
        return '';
      }

      // If it's pure structured JSON that contains _internalReasoning, remove internal fields before printing
      if (parsed && typeof parsed === 'object') {
        const cleaned = { ...parsed };
        delete cleaned._internalReasoning;
        delete cleaned.scratchpad;
        delete cleaned.dietitianScratchpad;
        delete cleaned.scoutScratchpad;
        if (Object.keys(cleaned).length === 0) return '';
        return JSON.stringify(cleaned, null, 2);
      }

      // Pretty-print JSON with clean spacing if it's arbitrary structured data
      return JSON.stringify(parsed, null, 2);
    } catch (e) {
      // If JSON parse failed (e.g. streaming/incomplete JSON string)
      const textMatch = trimmed.match(/"text"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
      if (textMatch && textMatch[1]) {
        return textMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
      }
      const summaryMatch = trimmed.match(/"summary"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
      if (summaryMatch && summaryMatch[1]) {
        return summaryMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
      }
      const msgMatch = trimmed.match(/"message"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
      if (msgMatch && msgMatch[1]) {
        return msgMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
      }

      // If raw string starts with _internalReasoning (streaming or broken json), hide it
      if (trimmed.includes('"_internalReasoning"') || trimmed.includes('_internalReasoning:')) {
        return '';
      }

      // Hide raw unparsed JSON string while message is live/thinking or assigned to an agent
      if (msg?.isLive || msg?.agentType) {
        return '';
      }

      return strContent;
    }
  }

  return strContent;
}
