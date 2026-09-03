import { describe, it, expect } from 'vitest';
import { dedupeConsecutiveAssistantMessages } from './chatMessageDedupe';

describe('dedupeConsecutiveAssistantMessages', () => {
  it('merges consecutive assistant bubbles when enabled (food cards)', () => {
    const msgs = [
      { id: '1', role: 'user', content: 'photo' },
      { id: '2', role: 'assistant', content: 'old', data: { agentResult: { a: 1 } } },
      { id: '3', role: 'assistant', content: 'new', data: { agentResult: { b: 2 } } }
    ];
    const out = dedupeConsecutiveAssistantMessages(msgs, { enabled: true });
    expect(out).toHaveLength(2);
    expect(out[1].content).toBe('new');
    expect(out[1].data.agentResult).toEqual({ a: 1, b: 2 });
  });

  it('keeps receptionist + handoff + health coach as separate turns for front desk', () => {
    const msgs = [
      { id: 'w', role: 'assistant', content: 'Hello! I am your Health Preparation Agent.', agentType: 'front_desk' },
      { id: 'u', role: 'user', content: 'I want to loose weight' },
      { id: 'r', role: 'assistant', content: 'Handing you to Health Coach', agentType: 'front_desk' },
      { id: 'h', role: 'assistant', content: 'Passed to Health Coach', data: { isHandoffNotice: true } },
      { id: 'c', role: 'assistant', content: 'Your plan', agentType: 'health_baseline', data: { agentResult: { report: { riskCategories: [{}] } } } }
    ];
    const out = dedupeConsecutiveAssistantMessages(msgs, { enabled: false });
    expect(out).toHaveLength(5);
    expect(out[2].agentType).toBe('front_desk');
    expect(out[4].agentType).toBe('health_baseline');
    expect(out[4].data.agentResult.report.riskCategories).toHaveLength(1);
  });
});
