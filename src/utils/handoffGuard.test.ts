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
