import { describe, it, expect } from 'vitest';
import { recordSessionEvent, getSessionLog } from '../sessionLog';

describe('sessionLog', () => {
  it('keeps a ring buffer of 20', () => {
    for (let i = 0; i < 25; i++) {
      recordSessionEvent('ring1', { writer: 'poller', action: 'accepted', status: String(i) });
    }
    const log = getSessionLog('ring1');
    expect(log.length).toBe(20);
    expect(log[0].status).toBe('5');
    expect(log[19].status).toBe('24');
  });
});
