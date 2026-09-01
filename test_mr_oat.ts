import { parseAndHealVisionScout } from './server_vision_scout.js';
const mockScoutOutput = {
  dishes: [
    {
      dishName: 'Breakfast',
      foods: [
        {
          foodName: 'Mr Oat Rolled Oats',
          weightGrams: 70
        }
      ]
    }
  ]
};
const result = parseAndHealVisionScout(mockScoutOutput, () => {});
console.dir(result, { depth: null });
