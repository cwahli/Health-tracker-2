import { describe, it, expect } from 'vitest';
import {
  isUnderspecifiedUtterance,
  isRoutableSpecialistIntent,
  mapFrontDeskSpecialist
} from './frontDeskRouting';

describe('isUnderspecifiedUtterance', () => {
  it('treats stubs as underspecified', () => {
    expect(isUnderspecifiedUtterance('i want')).toBe(true);
    expect(isUnderspecifiedUtterance('help')).toBe(true);
    expect(isUnderspecifiedUtterance('hi')).toBe(true);
    expect(isUnderspecifiedUtterance('')).toBe(true);
  });

  it('does not treat specialist jobs as stubs', () => {
    expect(isUnderspecifiedUtterance('I want to loose weight')).toBe(false);
    expect(isUnderspecifiedUtterance('i just want to be healthy')).toBe(false);
    expect(isUnderspecifiedUtterance('What can be improved for my health?')).toBe(false);
  });
});

describe('isRoutableSpecialistIntent', () => {
  it('rejects receptionist / vague intents', () => {
    expect(isRoutableSpecialistIntent('general_wellness', 'general_receptionist')).toBe(false);
    expect(isRoutableSpecialistIntent('general_inquiry', 'health_coach')).toBe(false);
    expect(isRoutableSpecialistIntent('profile_update', 'general_receptionist')).toBe(false);
  });

  it('accepts named specialist jobs', () => {
    expect(isRoutableSpecialistIntent('weight_loss', 'health_coach')).toBe(true);
    expect(isRoutableSpecialistIntent('health_improvement', 'health_coach')).toBe(true);
    expect(isRoutableSpecialistIntent('biomarker_review', 'medical')).toBe(true);
    expect(isRoutableSpecialistIntent('meal_logging', 'nutritionist')).toBe(true);
  });
});

describe('mapFrontDeskSpecialist', () => {
  it('maps coach / medical / food / nutritionist', () => {
    expect(mapFrontDeskSpecialist('health_coach', 'weight_loss')).toBe('health_baseline');
    expect(mapFrontDeskSpecialist('medical', 'biomarker_review')).toBe('medical');
    expect(mapFrontDeskSpecialist('nutritionist', 'general_wellness')).toBe('food_idea');
    expect(mapFrontDeskSpecialist('health_coach', 'meal_logging')).toBe('food');
  });

  it('does not map receptionist', () => {
    expect(mapFrontDeskSpecialist('general_receptionist', 'general_wellness')).toBeNull();
  });
});
