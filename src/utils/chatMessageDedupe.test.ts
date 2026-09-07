import { describe, it, expect } from 'vitest';
import { dedupeConsecutiveAssistantMessages, dropAnsweredClarifyMessages } from './chatMessageDedupe';

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

describe('dropAnsweredClarifyMessages', () => {
  const clarifyMsg = (id: string) => ({
    id, role: 'assistant', content: 'How much?',
    data: { needsPortionClarify: true, portionClarify: { promptMessage: 'How much?', items: [{ name: 'Oats' }] } },
    pendingFoodLog: { name: 'Meal', itemsBreakdown: [{ name: 'Oats' }], portionClarify: { promptMessage: 'How much?' } },
  });
  const mealCard = (id: string) => ({
    id, role: 'assistant', content: 'Updated meal',
    pendingFoodLog: { name: 'Meal', itemsBreakdown: [{ name: 'Oats' }] },
    data: { pendingFoodLog: { name: 'Meal', itemsBreakdown: [{ name: 'Oats' }] } },
  });

  it('drops the answered question when a later meal card carries the ledger', () => {
    const msgs: any[] = [
      { id: 'u1', role: 'user', content: 'photo' },
      clarifyMsg('q'),
      { id: 'u2', role: 'user', content: 'oats 130g' },
      mealCard('card'),
    ];
    const out = dropAnsweredClarifyMessages(msgs, true);
    expect(out.map((m: any) => m.id)).toEqual(['u1', 'u2', 'card']);
  });

  it('keeps the question while unanswered', () => {
    const msgs: any[] = [{ id: 'u1', role: 'user', content: 'photo' }, clarifyMsg('q')];
    expect(dropAnsweredClarifyMessages(msgs, false).map((m: any) => m.id)).toEqual(['u1', 'q']);
  });

  it('keeps the only card when it is also the question (no later ledger)', () => {
    const msgs: any[] = [{ id: 'u1', role: 'user', content: 'photo' }, clarifyMsg('q')];
    expect(dropAnsweredClarifyMessages(msgs, true).map((m: any) => m.id)).toEqual(['u1', 'q']);
  });

  it('keeps locally-answered bubbles whose payload was nulled at confirm', () => {
    const nulled: any = { ...clarifyMsg('q'), data: { needsPortionClarify: false, portionClarify: null } };
    delete nulled.pendingFoodLog.portionClarify;
    const msgs: any[] = [nulled, mealCard('card')];
    expect(dropAnsweredClarifyMessages(msgs, true).map((m: any) => m.id)).toEqual(['q', 'card']);
  });
});
