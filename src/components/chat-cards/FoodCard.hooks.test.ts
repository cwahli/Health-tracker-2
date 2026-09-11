import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Sensor for the "View Analysis" crash (Rendered fewer hooks than expected).
 *
 * Class HOOKS_EARLY_RETURN: FoodCard used to `return` the live-progress UI from
 * `if (msg.isLive)` before any hooks ran, while the resolved path ran ~30
 * hooks. A live message that later resolved re-rendered the SAME component
 * instance with a different hook count and React crashed.
 *
 * Invariant: every React.use* call in the FoodCard body runs unconditionally
 * above the __FOODCARD_HOOKS_END__ marker; the isLive branch and the non-food
 * null guard both live below it. No hooks may appear after the branches.
 */
describe('FoodCard hooks-before-return invariant', () => {
  const src = fs.readFileSync(path.join(__dirname, 'FoodCard.tsx'), 'utf-8');
  const bodyStart = src.indexOf('export const FoodCard');
  const marker = src.indexOf('__FOODCARD_HOOKS_END__');
  const liveBranch = src.indexOf('if (msg.isLive) {');
  const nullGuard = src.indexOf('if (!isFoodAgentType && !hasFoodPayload) return null;');
  const nextComponent = src.indexOf('function FoodResultFlagButton');

  it('has the hooks-end marker and both branches in order', () => {
    expect(bodyStart).toBeGreaterThanOrEqual(0);
    expect(marker).toBeGreaterThan(bodyStart);
    expect(liveBranch).toBeGreaterThan(marker);
    expect(nullGuard).toBeGreaterThan(marker);
    expect(nextComponent).toBeGreaterThan(nullGuard);
  });

  it('runs hooks before the branches and none after them', () => {
    const hookRe = /React\.use(State|Effect|Memo|Ref|Callback|Context|Reducer|ImperativeHandle|LayoutEffect|DebugValue)\s*\(/g;
    const hooksBefore: number[] = [];
    const hooksAfter: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = hookRe.exec(src)) !== null) {
      const idx = m.index;
      if (idx < bodyStart || idx >= nextComponent) continue; // other components
      (idx < liveBranch ? hooksBefore : hooksAfter).push(idx);
    }
    expect(hooksBefore.length).toBeGreaterThan(10);
    expect(hooksAfter).toEqual([]);
  });
});
