import { ImplicitFeedbackEngine } from '../../src/evaluator/feedback';
import type { SignalType } from '../../src/types';

describe('ImplicitFeedbackEngine', () => {
  let engine: ImplicitFeedbackEngine;

  beforeEach(() => { engine = new ImplicitFeedbackEngine(); });

  it('should record a feedback signal', () => {
    const fb = engine.record('user_used_result', 'session-1', 'op-1');
    expect(fb.signal).toBe('user_used_result');
    expect(fb.strength).toBe(0.7);
    expect(fb.sessionId).toBe('session-1');
    expect(fb.confidence).toBe(0.8);
    expect(fb.id).toMatch(/^fb_/);
  });

  it('should assign correct strengths for each signal type', () => {
    const cases: Array<[SignalType, number]> = [
      ['user_deleted_code', -0.8], ['user_interrupted', -0.6],
      ['user_provided_correction', -0.7], ['user_modified_output', -0.5],
      ['user_repeated_instruction', -0.3], ['user_ignored_result', -0.4],
      ['user_silence_then_praise', 0.2], ['user_immediate_continue', 0.3],
      ['agent_self_corrected', 0.3], ['user_explicit_approval', 0.6],
      ['user_used_result', 0.7], ['user_shared_output', 0.8],
    ];
    for (const [sig, expStrength] of cases) {
      const e2 = new ImplicitFeedbackEngine();
      const fb = e2.record(sig, 's1');
      expect(fb.strength).toBe(expStrength);
    }
  });

  it('should return 0 for empty satisfaction', () => {
    expect(engine.getSatisfactionScore()).toBe(0);
  });

  it('should compute positive satisfaction from used_result', () => {
    engine.record('user_used_result', 's1');
    const score = engine.getSatisfactionScore('s1');
    expect(score).toBeGreaterThan(0);
  });

  it('should compute negative satisfaction from user_deleted_code', () => {
    engine.record('user_deleted_code', 's2');
    const score = engine.getSatisfactionScore('s2');
    expect(score).toBeLessThan(0);
  });

  it('should weight by recency — older signals matter less', () => {
    engine.record('user_used_result', 's3');
    // Force timestamp to be old
    const old = engine.query({ sessionId: 's3' })[0]!;
    (old as any).timestamp = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago
    const score = engine.getSatisfactionScore('s3', 1); // 1-hour window
    expect(score).toBe(0); // Outside window
  });

  it('should filter by signal type', () => {
    engine.record('user_used_result', 's4');
    engine.record('user_explicit_approval', 's4');
    const r = engine.query({ signal: 'user_used_result' });
    expect(r.length).toBe(1);
    expect(r[0]!.signal).toBe('user_used_result');
  });

  it('should filter by sessionId', () => {
    engine.record('user_used_result', 'a');
    engine.record('user_used_result', 'b');
    expect(engine.query({ sessionId: 'a' }).length).toBe(1);
  });

  it('should filter by minStrength', () => {
    engine.record('user_shared_output', 's5'); // +0.8
    engine.record('user_modified_output', 's5'); // -0.5
    const r = engine.query({ minStrength: 0.5 });
    expect(r.length).toBe(1);
  });

  it('should sort by timestamp descending', () => {
    engine.record('user_immediate_continue', 's6');
    engine.record('user_used_result', 's6');
    const r = engine.query();
    expect(r[0]!.timestamp).toBeGreaterThanOrEqual(r[1]!.timestamp);
  });

  it('should respect limit', () => {
    for (let i = 0; i < 5; i++) engine.record('user_used_result', 's7');
    expect(engine.query({ limit: 2 }).length).toBe(2);
  });

  it('should provide accurate stats', () => {
    engine.record('user_used_result', 's8');
    engine.record('user_explicit_approval', 's8');
    engine.record('user_deleted_code', 's8');
    const s = engine.stats();
    expect(s.totalSignals).toBe(3);
    expect(s.positiveSignals).toBe(2);
    expect(s.negativeSignals).toBe(1);
    expect(s.averageStrength).toBeGreaterThan(-1);
    expect(s.mostCommonSignal).toBeTruthy();
  });
});
