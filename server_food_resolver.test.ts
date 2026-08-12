import { describe, it, expect, vi } from 'vitest';
import { executeFoodResolverCurator } from './server_food_resolver_curator.js';

describe('Food Resolver Curator Agent', () => {
  it('discards chosenFdcId if NOT present in candidate allowlist and logs error', async () => {
    const logs: string[] = [];
    const addDebugLog = (msg: string) => logs.push(msg);
    const mockLLM = vi.fn().mockResolvedValue(`\`\`\`json\n` + JSON.stringify({
      actions: [
        {
          type: 'pick_existing',
          query: 'mystery snack',
          chosenFdcId: 'FDC_FORGED_99999',
          reason: 'forged'
        }
      ]
    }) + `\n\`\`\``);
    
    const gaps = [
      {
        query: 'mystery snack',
        candidates: [
          { id: '111111', name: 'Snack Bar Real', source: 'usda' },
          { id: '222222', name: 'Other Snack Real', source: 'usda' }
        ]
      }
    ];

    const results = await executeFoodResolverCurator(gaps, addDebugLog, mockLLM);
    expect(results).toHaveLength(1);
    expect(results[0].chosenFdcId).toBeNull(); // Discarded!
    expect(logs.some(l => l.includes('LLM hallucinated ID'))).toBe(true);
  });

  it('accepts chosenFdcId if present in candidate allowlist', async () => {
    const logs: string[] = [];
    const addDebugLog = (msg: string) => logs.push(msg);
    const mockLLM = vi.fn().mockResolvedValue(`\`\`\`json\n` + JSON.stringify({
      actions: [
        {
          type: 'pick_existing',
          query: 'snack bar',
          chosenFdcId: '111111',
          reason: 'matches'
        }
      ]
    }) + `\n\`\`\``);
    
    const gaps = [
      {
        query: 'snack bar',
        candidates: [
          { id: '111111', name: 'Snack Bar Real', source: 'usda' }
        ]
      }
    ];

    const results = await executeFoodResolverCurator(gaps, addDebugLog, mockLLM);
    expect(results).toHaveLength(1);
    expect(results[0].chosenFdcId).toBe('111111');
    expect(logs.some(l => l.includes('pick_existing for "snack bar" -> 111111'))).toBe(true);
  });
});
