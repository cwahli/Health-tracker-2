/**
 * Front-desk handoff decision helper.
 *
 * Fire rules (all must hold):
 * 1. Not a handoff-continuation turn.
 * 2. The response is genuinely from front_desk.
 * 3. status is ready_for_handoff AND a usable specialist payload is present.
 * 4. targetAgent maps to a real specialist (never general_receptionist → coach).
 *
 * Passed-through specialists are appended in the Front Desk thread.
 * Standalone Health tab / FAB entry points are unchanged.
 */
import { mapFrontDeskSpecialist, type FrontDeskSpecialist } from './frontDeskRouting';

export type HandoffTarget = FrontDeskSpecialist;

export interface HandoffDecision {
  targetAgent: HandoffTarget;
  handoff: any;
  prompt: string;
}

const GENERIC_HANDOFF_PROMPT = 'Please create my personalized health plan based on my profile.';

export function isUsableHandoffPayload(handoff: any): boolean {
  if (!handoff || typeof handoff !== 'object' || Array.isArray(handoff)) return false;
  if (Object.keys(handoff).length === 0) return false;
  if (handoff.targetAgent === 'general_receptionist') return false;
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
  if (resData.status !== 'ready_for_handoff') return null;
  const handoff = resData.handoffPayload;
  if (!isUsableHandoffPayload(handoff)) return null;
  const mapped = mapFrontDeskSpecialist(handoff.targetAgent || resData.targetAgent, handoff.intent || resData.intent);
  if (!mapped) return null;
  return {
    targetAgent: mapped,
    handoff,
    prompt: buildHandoffPrompt(handoff)
  };
}
