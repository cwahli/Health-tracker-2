import { describe, it, expect } from 'vitest';
import { decideFrontDeskHandoff, isUsableHandoffPayload, buildHandoffPrompt } from './handoffGuard';

const payload = {
  targetAgent: 'health_coach',
  intent: 'weight_loss',
  summaryForAgent: 'Goal: lose weight.',
  actionableInsights: ['Insight one']
};

describe('decideFrontDeskHandoff (HANDOFF_LOOP)', () => {
  it('fires for a genuine front_desk ready response with payload', () => {
    const d = decideFrontDeskHandoff({ agentType: 'front_desk', status: 'ready_for_handoff', handoffPayload: payload });
    expect(d?.targetAgent).toBe('health_baseline');
    expect(d?.prompt).toContain('Goal: lose weight.');
    expect(d?.prompt).toContain('Insight one');
  });

  it('routes medical payloads to the medical agent', () => {
    const d = decideFrontDeskHandoff({
      agentType: 'front_desk',
      status: 'ready_for_handoff',
      handoffPayload: { ...payload, targetAgent: 'medical' }
    });
    expect(d?.targetAgent).toBe('medical');
  });

  it('does NOT fire for downstream echo responses carrying a payload', () => {
    expect(decideFrontDeskHandoff({ agentType: 'health_baseline', handoffPayload: payload })).toBeNull();
    expect(decideFrontDeskHandoff({ agentType: 'health_baseline', status: undefined, handoffPayload: payload })).toBeNull();
    expect(decideFrontDeskHandoff({ agentType: 'medical', handoffPayload: payload })).toBeNull();
  });

  it('does NOT fire when the payload is missing or empty (blind handoff)', () => {
    expect(decideFrontDeskHandoff({ agentType: 'front_desk', status: 'ready_for_handoff' })).toBeNull();
    expect(decideFrontDeskHandoff({ agentType: 'front_desk', status: 'ready_for_handoff', handoffPayload: {} })).toBeNull();
    expect(decideFrontDeskHandoff({ agentType: 'front_desk', status: 'needs_info', handoffPayload: null })).toBeNull();
  });

  it('does NOT fire on handoff-continuation turns', () => {
    expect(
      decideFrontDeskHandoff(
        { agentType: 'front_desk', status: 'ready_for_handoff', handoffPayload: payload },
        { isHandoffContinuation: true }
      )
    ).toBeNull();
  });

  it('fires for agentType-less ready responses (back-compat)', () => {
    const d = decideFrontDeskHandoff({ status: 'ready_for_handoff', handoffPayload: payload });
    expect(d?.targetAgent).toBe('health_baseline');
  });

  it('does NOT fire for general_receptionist even with a payload', () => {
    expect(
      decideFrontDeskHandoff({
        agentType: 'front_desk',
        status: 'ready_for_handoff',
        handoffPayload: { ...payload, targetAgent: 'general_receptionist' }
      })
    ).toBeNull();
  });

  it('does NOT fire on needs_info (payload alone is not enough)', () => {
    expect(
      decideFrontDeskHandoff({
        agentType: 'front_desk',
        status: 'needs_info',
        handoffPayload: payload
      })
    ).toBeNull();
  });

  it('routes meal_logging to food and nutritionist to food_idea', () => {
    expect(
      decideFrontDeskHandoff({
        agentType: 'front_desk',
        status: 'ready_for_handoff',
        handoffPayload: { ...payload, targetAgent: 'nutritionist', intent: 'general_wellness' }
      })?.targetAgent
    ).toBe('food_idea');
    expect(
      decideFrontDeskHandoff({
        agentType: 'front_desk',
        status: 'ready_for_handoff',
        handoffPayload: { ...payload, targetAgent: 'health_coach', intent: 'meal_logging' }
      })?.targetAgent
    ).toBe('food');
  });
});

describe('isUsableHandoffPayload', () => {
  it('rejects null/empty/payload-less shapes', () => {
    expect(isUsableHandoffPayload(null)).toBe(false);
    expect(isUsableHandoffPayload(undefined)).toBe(false);
    expect(isUsableHandoffPayload({})).toBe(false);
    expect(isUsableHandoffPayload([])).toBe(false);
    expect(isUsableHandoffPayload('x')).toBe(false);
    expect(isUsableHandoffPayload(payload)).toBe(true);
  });
});

describe('buildHandoffPrompt', () => {
  it('falls back to the generic prompt only when summary and insights are absent', () => {
    expect(buildHandoffPrompt({ targetAgent: 'health_coach' })).toContain('personalized health plan');
  });
});
