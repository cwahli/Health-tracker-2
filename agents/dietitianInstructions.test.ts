import { describe, it, expect } from 'vitest';
import { buildModeAEditInstruction, buildModeAReviewInstruction } from './dietitianInstructions';

describe('dietitian edit/narrate contract (F-8.4)', () => {
  it('edit instruction uses split/replace + estimate, not remove+add few-shot 80/100/70 sides', () => {
    const text = buildModeAEditInstruction({});
    expect(text).toMatch(/split_item/);
    expect(text).toMatch(/replace_identity/);
    expect(text).toMatch(/estimate/);
    expect(text).not.toMatch(/newWeightGrams": 80/);
    expect(text).not.toMatch(/newWeightGrams": 70/);
    expect(text).not.toMatch(/CURRENT_ACTIVE_MEAL_STATE/);
    expect(text).not.toMatch(/"itemsBreakdown":\s*"array/);
  });

  it('create instruction narrates; does not ask to rebuild the meal as NEW FOOD LOGGING', () => {
    const text = buildModeAReviewInstruction({});
    expect(text).toMatch(/NARRATE/);
    expect(text).not.toMatch(/ACTIVE TASK: NEW FOOD LOGGING/);
  });
});
