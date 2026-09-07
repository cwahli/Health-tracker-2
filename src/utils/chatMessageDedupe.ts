/**
 * Food-chat helper: consecutive assistant bubbles are often two patches of the
 * same meal card and should be merged. Front Desk threads are the opposite —
 * receptionist reply, handoff notice, and Health Coach card are three distinct
 * assistant turns and must stay 1:1 in the same modal.
 */
export function dedupeConsecutiveAssistantMessages<T extends { role?: string; data?: any }>(
  messages: T[],
  opts?: { enabled?: boolean }
): T[] {
  if (opts?.enabled === false) return messages.slice();
  const out: T[] = [];
  for (let i = 0; i < messages.length; i++) {
    const curr = messages[i];
    const prev = out[out.length - 1];
    if (prev && prev.role === 'assistant' && curr.role === 'assistant') {
      out[out.length - 1] = {
        ...prev,
        ...curr,
        data: {
          ...(prev.data || {}),
          ...(curr.data || {}),
          agentResult: {
            ...(prev.data?.agentResult || {}),
            ...(curr.data?.agentResult || {})
          }
        }
      };
    } else {
      out.push(curr);
    }
  }
  return out;
}

/**
 * Drop answered portion-clarify question bubbles on rebuilds. Once the user
 * has confirmed portions, the question card must not resurrect: the answer
 * lives on in the updated meal card and the debug trace, not as a second
 * stale question above the edit. Only drops a clarify bubble when a LATER
 * message already carries the meal ledger (so an unanswered question, or
 * the only card, is never removed). Locally-answered bubbles (portionClarify
 * nulled at confirm time) are unaffected — they carry no payload to match.
 */
export function dropAnsweredClarifyMessages<T extends { role?: string; data?: any; pendingFoodLog?: any; portionClarify?: any }>(
  messages: T[],
  answered: boolean,
): T[] {
  if (!answered || !Array.isArray(messages) || messages.length === 0) return messages.slice();
  const hasMealLedger = (m: any): boolean => {
    const log = m?.pendingFoodLog || m?.data?.pendingFoodLog;
    return Boolean(log && (Array.isArray(log.itemsBreakdown) ? log.itemsBreakdown.length > 0 : true));
  };
  const hasClarifyPayload = (m: any): boolean => Boolean(
    m?.role === 'assistant' && (m?.data?.portionClarify || (m as any)?.portionClarify || m?.pendingFoodLog?.portionClarify)
  );
  const lastLedgerIdx = messages.map((m) => hasMealLedger(m)).lastIndexOf(true);
  if (lastLedgerIdx < 0) return messages.slice();
  return messages.filter((m, idx) => !(idx < lastLedgerIdx && hasClarifyPayload(m)));
}
