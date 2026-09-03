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
