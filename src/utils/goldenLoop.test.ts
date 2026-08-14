import { describe, it, expect } from 'vitest';
import {
  GOLDEN_LOOP_MAX_ITERS,
  decideLoop,
  fingerprintReds,
  nextLoopState,
  emptyLoopState,
} from './goldenLoop';

describe('goldenLoop guardrails', () => {
  it('fingerprints only current reds', () => {
    const a = fingerprintReds({
      outcomes: [
        { id: 'x', pass: false, enabled: true },
        { id: 'y', pass: true, enabled: true },
      ],
      mealMisses: [],
      journey: [{ id: 'j1', identityPass: true }],
    });
    const b = fingerprintReds({
      outcomes: [{ id: 'x', pass: false, enabled: true }],
      mealMisses: [],
    });
    expect(a).toBe(b);
  });

  it('stops when green', () => {
    expect(decideLoop({ allGreen: true, fingerprint: '{}', iteration: 1 }).reason).toBe('green');
  });

  it('stops at max iterations', () => {
    const d = decideLoop({
      allGreen: false,
      fingerprint: '{"o":["a"]}',
      iteration: GOLDEN_LOOP_MAX_ITERS,
    });
    expect(d).toEqual({ action: 'stop', reason: 'max_iterations' });
  });

  it('stops when the same reds come back and no new attempt was logged', () => {
    const fp = fingerprintReds({ outcomes: [{ id: 'dup', pass: false }] });
    const d = decideLoop({
      allGreen: false,
      fingerprint: fp,
      previousFingerprints: [fp],
      iteration: 2,
      hasNewAttemptSinceLastLoop: false,
    });
    expect(d.reason).toBe('needs_attempt');
  });

  it('stops as no_progress when the same reds persist after a new attempt', () => {
    const fp = fingerprintReds({ outcomes: [{ id: 'dup', pass: false }] });
    const d = decideLoop({
      allGreen: false,
      fingerprint: fp,
      previousFingerprints: [fp],
      iteration: 2,
      hasNewAttemptSinceLastLoop: true,
    });
    expect(d.reason).toBe('no_progress');
  });

  it('allows continue when the fingerprint changed', () => {
    const d = decideLoop({
      allGreen: false,
      fingerprint: '{"o":["b"]}',
      previousFingerprints: ['{"o":["a"]}'],
      iteration: 2,
      hasNewAttemptSinceLastLoop: true,
    });
    expect(d).toEqual({ action: 'continue', reason: null });
  });

  it('stops when leftover reds need a new Analyze', () => {
    const d = decideLoop({
      allGreen: false,
      fingerprint: '{"o":["id_label_merge_collapsed"]}',
      iteration: 1,
      mayLoop: false,
    });
    expect(d).toEqual({ action: 'stop', reason: 'needs_new_analyze' });
  });

  it('omits accept reds from the fingerprint so a doughnut row cannot loop forever', () => {
    const a = fingerprintReds({
      outcomes: [
        { id: 'id_label_merge_collapsed', label: 'merged into Serrano', pass: false },
        { id: 'truth_estimated_macros_x', label: 'ingredient_decomposition', pass: false },
      ],
    });
    const b = fingerprintReds({
      outcomes: [{ id: 'id_label_merge_collapsed', label: 'merged into Serrano', pass: false }],
    });
    expect(a).toBe(b);
  });

  it('stops without scout or when transport failed', () => {
    expect(decideLoop({ allGreen: false, fingerprint: 'x', iteration: 1, hasScout: false }).reason).toBe(
      'no_scout'
    );
    expect(
      decideLoop({ allGreen: false, fingerprint: 'x', iteration: 1, transportFailed: true }).reason
    ).toBe('transport');
  });

  it('locks state after no-progress', () => {
    const next = nextLoopState(emptyLoopState(), {
      fingerprint: '{"o":["a"]}',
      stop: 'no_progress',
      pipelineRan: true,
    });
    expect(next.locked).toBe(true);
    expect(next.pipelineRuns).toBe(1);
  });

  it('unlocks on green', () => {
    const locked = nextLoopState(emptyLoopState(), {
      fingerprint: '{"o":["a"]}',
      stop: 'no_progress',
      pipelineRan: true,
    });
    const green = nextLoopState(locked, { fingerprint: '{"o":[]}', stop: 'green', pipelineRan: true });
    expect(green.locked).toBe(false);
    expect(green.lastStop).toBe('green');
  });
});
