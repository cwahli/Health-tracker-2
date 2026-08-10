import { describe, it, expect, vi } from 'vitest';
import { executeFoodResolverAgent } from './server';

describe('Food Resolver Agent Execution (PASS 3)', () => {
  it('discards chosenFdcId if NOT present in candidate allowlist and logs error', async () => {
    const logs: string[] = [];
    const addDebugLog = (msg: string) => logs.push(msg);

    const mockLLM = vi.fn().mockResolvedValue(JSON.stringify({
      resolutions: [
        {
          query: 'mystery snack',
          chosenFdcId: 'FDC_FORGED_99999',
          formTags: ['packaged']
        }
      ]
    }));

    const gaps = [
      {
        query: 'mystery snack',
        candidates: [
          { id: '111111', name: 'Snack Bar Real', source: 'usda' },
          { id: '222222', name: 'Other Snack Real', source: 'usda' }
        ]
      }
    ];

    const results = await executeFoodResolverAgent(gaps, addDebugLog, mockLLM);

    expect(results).toHaveLength(1);
    expect(results[0].chosenFdcId).toBeNull(); // Discarded!
    expect(logs.some(l => l.includes('[food_resolver_error] DISCARDED chosenFdcId'))).toBe(true);
  });

  it('accepts chosenFdcId if present in candidate allowlist', async () => {
    const logs: string[] = [];
    const addDebugLog = (msg: string) => logs.push(msg);

    const mockLLM = vi.fn().mockResolvedValue(JSON.stringify({
      resolutions: [
        {
          query: 'snack bar',
          chosenFdcId: '111111',
          formTags: ['bar']
        }
      ]
    }));

    const gaps = [
      {
        query: 'snack bar',
        candidates: [
          { id: '111111', name: 'Snack Bar Real', source: 'usda' }
        ]
      }
    ];

    const results = await executeFoodResolverAgent(gaps, addDebugLog, mockLLM);

    expect(results).toHaveLength(1);
    expect(results[0].chosenFdcId).toBe('111111');
    expect(logs.some(l => l.includes('[food_resolver_fetch_id] Validated candidate match'))).toBe(true);
  });

  it('caps gap items at N=8 and defers excess items', async () => {
    const logs: string[] = [];
    const addDebugLog = (msg: string) => logs.push(msg);

    const mockLLM = vi.fn().mockResolvedValue(JSON.stringify({ resolutions: [] }));

    const gaps = Array.from({ length: 12 }, (_, i) => ({
      query: `item_${i}`,
      candidates: [{ id: `id_${i}`, name: `name_${i}`, source: 'usda' }]
    }));

    await executeFoodResolverAgent(gaps, addDebugLog, mockLLM);

    expect(logs.some(l => l.includes('[food_resolver_skip] Capping gap items at 8'))).toBe(true);
  });
});
