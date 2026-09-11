import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Sensor for the portion-confirm "Cannot update a component (FoodHistoryTab)
 * while rendering a different component (LogChat)" warning.
 *
 * Class STORE_WRITE_IN_RENDER: the PortionClarifyCard onConfirm handler used to
 * call persistAnswered() (JobStore.updateJob → notify → subscriber setStates)
 * INSIDE a setMessages(prev => ...) updater. Updaters execute during
 * render/commit, so every JobStore subscriber (e.g. FoodHistoryTab) setState
 * fired mid-render of LogChat.
 *
 * Invariant: no setMessages updater body in LogChat.tsx may contain a JobStore
 * write (persistAnswered / JobStore.updateJob / JobStore.deleteJob). Compute
 * the next value from committed state, write the store, then setMessages(value).
 */
function updaterBodies(src: string): string[] {
  const bodies: string[] = [];
  const re = /setMessages\(\s*prev\s*=>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    let i = m.index + m[0].length;
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src[i] === '{') {
      let depth = 0;
      let j = i;
      for (; j < src.length; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') {
          depth--;
          if (depth === 0) break;
        }
      }
      bodies.push(src.slice(i, j + 1));
    } else {
      // Concise-body updater: setMessages(prev => expr) — capture to matching paren.
      let depth = 0;
      let j = m.index;
      for (; j < src.length; j++) {
        if (src[j] === '(') depth++;
        else if (src[j] === ')') {
          depth--;
          if (depth === 0) break;
        }
      }
      bodies.push(src.slice(m.index, j + 1));
    }
  }
  return bodies;
}

describe('LogChat portion-confirm store-write placement', () => {
  const src = fs.readFileSync(path.join(__dirname, 'LogChat.tsx'), 'utf-8');

  it('has no JobStore writes inside setMessages updaters', () => {
    const bodies = updaterBodies(src);
    expect(bodies.length).toBeGreaterThan(0);
    const offenders = bodies.filter(
      (b) => b.includes('persistAnswered(') || b.includes('JobStore.updateJob(') || b.includes('JobStore.deleteJob(')
    );
    expect(offenders).toEqual([]);
  });

  it('portion-confirm persists the answered job outside the updater', () => {
    const confirmIdx = src.indexOf('onConfirm={(choices: any) => {');
    expect(confirmIdx).toBeGreaterThanOrEqual(0);
    const region = src.slice(confirmIdx, confirmIdx + 12000);
    expect(region).toContain('persistAnswered(nextLocal');
    expect(region).toContain('persistAnswered(nextForEdit');
  });
});
