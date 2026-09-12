import { describe, it, expect } from 'vitest';
import { getFoodImageUrl } from './FoodCard';

describe('FoodCard image resolution & fallbacks', () => {
  it('correctly falls back beverage dishes to refreshing drink images rather than pepper/spices', () => {
    const herbalDrinkUrl = getFoodImageUrl('Tier 1 - Low-Sugar Herbal Cooling Drinks');
    expect(herbalDrinkUrl).toContain('photo-1556881286-fc6915169721');

    const teaUrl = getFoodImageUrl('Adem Sari Ching Ku Herbal Tea');
    expect(teaUrl).toContain('photo-1556881286-fc6915169721');

    const juiceUrl = getFoodImageUrl('Fresh Orange Juice');
    expect(juiceUrl).toContain('photo-1556881286-fc6915169721');
  });

  it('keeps pepper & seasonings matching spices when not a beverage', () => {
    const spiceUrl = getFoodImageUrl('Black Pepper Seasoning');
    expect(spiceUrl).toContain('photo-1506368249639-73a05d6f6488');
  });

  it('preserves valid URLs when supplied', () => {
    const customUrl = 'https://example.com/meal.jpg';
    expect(getFoodImageUrl('Herbal Drink', customUrl)).toBe(customUrl);

    const r2ProxyUrl = '/photos/job_12345.jpg';
    expect(getFoodImageUrl('Cooling Water', r2ProxyUrl)).toBe(r2ProxyUrl);
  });
});
