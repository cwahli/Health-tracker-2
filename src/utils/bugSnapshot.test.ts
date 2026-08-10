import { describe, it, expect } from 'vitest';
import {
  sanitizePathSegment,
  bugTagR2Prefix,
  bugReportR2Prefix,
  bugShotKey,
  cleanBugLogText,
  budgetPayloadForDigest,
  buildBugTriageSystemPrompt,
  buildBugTriageUserPrompt,
  briefFromTag,
  parseDataUrl,
  BUG_SNAPSHOT_MAX_SHOTS,
} from './bugSnapshot';

describe('bugSnapshot', () => {
  it('builds stable R2 keys under bugs/', () => {
    expect(bugTagR2Prefix('foodcart', 'tag-1')).toBe('bugs/foodcart/tag-1');
    expect(bugReportR2Prefix('foodcart', 'tag-1', 'rep-2')).toContain('bugs/foodcart/tag-1/reports/rep-2');
    expect(bugShotKey('foodcart', 'tag-1', 'rep-2', 1)).toBe(
      'bugs/foodcart/tag-1/reports/rep-2/shot-01.jpg'
    );
    expect(sanitizePathSegment('a/b c!')).toMatch(/^a_b_c/);
  });

  it('caps shots constant', () => {
    expect(BUG_SNAPSHOT_MAX_SHOTS).toBeLessThanOrEqual(5);
  });

  it('cleanBugLogText collapses USDA candidates and caps size', () => {
    const lines = ['start', '=== VERIFIED DATABASE MATCHES ==='];
    for (let i = 0; i < 50; i++) lines.push(`- [USDA] item ${i}`);
    lines.push('after');
    const cleaned = cleanBugLogText(lines.join('\n'), 5000);
    expect(cleaned).toContain('candidates omitted');
    expect(cleaned).not.toContain('- [USDA] item 40');
    expect(cleaned).toContain('after');
  });

  it('budgetPayloadForDigest keeps macros and truncates', () => {
    const payload = {
      mode: 'review',
      pendingFoodLog: {
        name: 'Test meal',
        nutrients: { calories: 500, protein: 20, carbohydrates: 40 },
        itemsBreakdown: [{ originalName: 'rice', weightGrams: 100, calories: 130 }],
        receiptTable: [{ item: 'rice', source: 'USDA', notes: 'ok' }],
      },
      pipelineErrors: [{ message: 'boom' }],
    };
    const s = budgetPayloadForDigest(payload);
    expect(s).toContain('Test meal');
    expect(s).toContain('500');
    expect(s).toContain('rice');
    expect(s).toContain('pipelineErrors');
  });

  it('builds triage prompts with a11y-first for all agents', () => {
    const sys = buildBugTriageSystemPrompt();
    expect(sys).toContain('Symptom');
    expect(sys).toContain('Suspected layer');
    expect(sys).toMatch(/Accessibility tree|a11y/i);
    expect(sys).toMatch(/ALL models|all agents/i);
    const user = buildBugTriageUserPrompt({
      tagTitle: 'Wrong calories',
      category: 'foodcart',
      userSymptom: 'shows 0 kcal',
      logs: 'error line',
      a11yText: '- [dialog] "Food result"',
      domainPackJson: '{"domain":"food","food":{"nutrients":{"calories":0}}}',
    });
    expect(user).toContain('Wrong calories');
    expect(user).toContain('0 kcal');
    expect(user).toContain('PRIMARY structure');
    expect(user.indexOf('Accessibility')).toBeLessThan(user.indexOf('Logs'));
    expect(user).toContain('domain":"food"');
  });

  it('briefFromTag is small and stable', () => {
    const b = briefFromTag({
      id: 't1',
      title: 'Bug',
      category: 'biomarker',
      identified_problems: '## Symptom\nx',
      whats_still_open: 'fix UI',
      linked_count: 2,
    });
    expect(b.identified_problems).toContain('Symptom');
    expect(b.r2_prefix).toBe('bugs/biomarker/t1');
  });

  it('parseDataUrl', () => {
    const p = parseDataUrl('data:image/jpeg;base64,abc123');
    expect(p?.contentType).toBe('image/jpeg');
    expect(p?.base64).toBe('abc123');
    expect(parseDataUrl('nope')).toBeNull();
  });
});
