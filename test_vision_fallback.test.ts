import { describe, it, expect } from 'vitest';
import { parseAndHealVisionScout } from './server_vision_scout';

describe('DISH_DROP: local food mapping', () => {
  it('should map a local food component to a generic english searchQuery if missing from LLM', () => {
    const output = {
      dishes: [
        {
          dishName: 'Indonesian Mixed Plate',
          foods: [
            { foodName: 'Telur Goreng', weightGrams: 50 },
            { foodName: 'Ikan Bakar', weightGrams: 150 },
            { foodName: 'Cumi Saus Padang', weightGrams: 100 },
            { foodName: 'Ayam Goreng', weightGrams: 100 }
          ]
        }
      ]
    };
    
    const result = parseAndHealVisionScout(output, () => {});
    const components = result.items[0].components;
    
    expect(components[0].searchQuery).toContain('egg');
    expect(components[1].searchQuery).toContain('fish');
    expect(components[2].searchQuery).toContain('squid');
    expect(components[3].searchQuery).toContain('chicken');
  });
});
