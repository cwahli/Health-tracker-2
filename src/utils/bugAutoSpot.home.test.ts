import { describe, it, expect } from 'vitest';
import { autoSpotHome } from './bugAutoSpot';

describe('autoSpotHome', () => {
  it('flags resurrection when a tombstoned key still has a tile', () => {
    const hits = autoSpotHome({
      tiles: [{ key: 'bmi', value: 27.4 }],
      profile: { deletedCustomBiomarkerKeys: { bmi: 1_700_000_000_000 } },
    });
    expect(hits.remaining.some((h) => h.code === 'RESURRECTION' && h.item === 'bmi')).toBe(true);
  });

  it('flags duplicate Home tile keys', () => {
    const hits = autoSpotHome({
      tiles: ['weight', 'weight', 'height'],
    });
    expect(hits.remaining.some((h) => h.code === 'DUPLICATE_TILE' && h.item === 'weight')).toBe(true);
  });

  it('flags empty-BMI re-init after bmiAutoLogged when the tile returns without a tombstone', () => {
    const hits = autoSpotHome({
      tiles: [{ key: 'bmi', value: 24.1 }],
      profile: { bmiAutoLogged: true, bmi: 24.1 },
    });
    expect(hits.remaining.some((h) => h.code === 'EMPTY_BMI_REINIT')).toBe(true);
  });

  it('stays quiet on a clean Home', () => {
    const hits = autoSpotHome({
      tiles: [{ key: 'weight', value: 70 }, { key: 'height', value: 170 }],
      profile: { bmiAutoLogged: true, deletedCustomBiomarkerKeys: { bmi: 1 } },
    });
    expect(hits.remaining).toEqual([]);
  });
});
