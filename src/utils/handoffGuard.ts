/**
 * Front-desk handoff decision helper.
 *
 * Class repaired: HANDOFF_LOOP — the chat response handler used to fire a
 * seamless handoff whenever `status === 'ready_for_handoff'` OR a payload was
 * present, without checking WHICH agent answered. Downstream agents
 * (health_baseline/medical) echo the handoff payload back, so every
 * specialist reply re-triggered another handoff with a generic fallback
 * prompt (the user's original message was lost) — an infinite,
 * credit-burning loop with no visible answer.
 *
 * Fire rules (all must hold):
 * 1. Not a handoff-continuation turn.
 * 2. The response is genuinely from front_desk
 *    (`agentType === 'front_desk'`, or no agentType + ready_for_handoff).
 * 3. A NON-EMPTY handoffPayload is present (status alone is not enough).
 */
export type HandoffTarget = 'medical' | 'health_baseline';

export interface HandoffDecision {
  targetAgent: HandoffTarget;
  handoff: any;
  prompt: string;
}

const GENERIC_HANDOFF_PROMPT = 'Please create my personalized health plan based on my profile.';

export function isUsableHandoffPayload(handoff: any): boolean {
  if (!handoff || typeof handoff !== 'object' || Array.isArray(handoff)) return false;
  if (Object.keys(handoff).length === 0) return false;
  return Boolean(handoff.targetAgent || handoff.summaryForAgent || handoff.userContextSummary);
}

export function buildHandoffPrompt(handoff: any): string {
  const summary = handoff.summaryForAgent || handoff.userContextSummary || '';
  const insights = Array.isArray(handoff.actionableInsights) ? handoff.actionableInsights : [];
  if (summary) {
    return insights.length > 0
      ? `${summary}\n\nKey Insights:\n${insights.map((i: string) => `• ${i}`).join('\n')}`
      : summary;
  }
  return insights.length > 0 ? insights.map((i: string) => `• ${i}`).join('\n') : GENERIC_HANDOFF_PROMPT;
}

export function decideFrontDeskHandoff(
  resData: any,
  opts?: { isHandoffContinuation?: boolean }
): HandoffDecision | null {
  if (!resData || opts?.isHandoffContinuation) return null;
  const fromFrontDesk =
    resData.agentType === 'front_desk' ||
    (!resData.agentType && resData.status === 'ready_for_handoff');
  if (!fromFrontDesk) return null;
  if (!(resData.status === 'ready_for_handoff' || resData.handoffPayload)) return null;
  const handoff = resData.handoffPayload;
  if (!isUsableHandoffPayload(handoff)) return null;
  const isMed = handoff.targetAgent === 'medical' || handoff.targetAgent === 'biomarker_review';
  return {
    targetAgent: isMed ? 'medical' : 'health_baseline',
    handoff,
    prompt: buildHandoffPrompt(handoff)
  };
}
