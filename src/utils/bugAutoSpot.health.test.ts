import { describe, it, expect } from 'vitest';
import { autoSpotHealth } from './bugAutoSpot';

describe('autoSpotHealth', () => {
  it('flags same-date rows that share a key without sourceReportId', () => {
    const hits = autoSpotHealth({
      history: [
        { id: 'a', date: '2020-01-01', keys: ['hdl'], values: { hdl: 1.2 }, units: { hdl: 'mmol/L' } },
        { id: 'b', date: '2020-01-01', keys: ['hdl'], values: { hdl: 1.4 }, units: { hdl: 'mmol/L' } },
      ],
    });
    expect(hits.remaining.some((h) => h.code === 'SAME_DATE')).toBe(true);
  });

  it('flags duplicate keys on one log', () => {
    const hits = autoSpotHealth({
      history: [{ id: 'a', date: '2021-02-02', keys: ['ldl', 'ldl'], values: { ldl: 3 }, units: { ldl: 'mmol/L' } }],
    });
    expect(hits.remaining.some((h) => h.code === 'DUP_KEYS')).toBe(true);
  });

  it('flags a value with no unit', () => {
    const hits = autoSpotHealth({
      valuesSample: [{ key: 'egfr', value: 64, unit: '' }],
    });
    expect(hits.remaining.some((h) => h.code === 'MISSING_UNIT')).toBe(true);
  });

  it('flags sourceReportId collapse across two logs', () => {
    const hits = autoSpotHealth({
      history: [
        { id: 'a', date: '2022-03-03', keys: ['a1c'], sourceReportId: 'rep_1', values: { a1c: 6.1 }, units: { a1c: '%' } },
        { id: 'b', date: '2022-03-03', keys: ['a1c'], sourceReportId: 'rep_1', values: { a1c: 7.2 }, units: { a1c: '%' } },
      ],
    });
    expect(hits.remaining.some((h) => h.code === 'SOURCE_COLLAPSE')).toBe(true);
  });

  it('flags food text on a health job as WRONG_DOOR', () => {
    const hits = autoSpotHealth({
      jobText: 'itemsBreakdown wrap 540 kcal from scoutItems',
    });
    expect(hits.remaining.some((h) => h.code === 'WRONG_DOOR')).toBe(true);
  });

  it('stays quiet on two same-date rows that already have distinct sourceReportIds', () => {
    const hits = autoSpotHealth({
      history: [
        { id: 'a', date: '2020-01-01', keys: ['hdl'], values: { hdl: 1.2 }, sourceReportId: 'r1', units: { hdl: 'mmol/L' } },
        { id: 'b', date: '2020-01-01', keys: ['tg'], values: { tg: 1.4 }, sourceReportId: 'r2', units: { tg: 'mmol/L' } },
      ],
    });
    expect(hits.remaining).toEqual([]);
  });
});
