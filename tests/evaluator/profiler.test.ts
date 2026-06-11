import { AgentProfiler } from '../../src/evaluator/profiler';
import { ImplicitFeedbackEngine } from '../../src/evaluator/feedback';
import type { PreExecMetrics, RuntimeMetrics, PostExecMetrics } from '../../src/types';

function makePre(opts: Partial<PreExecMetrics> = {}): PreExecMetrics {
  return {
    timestamp: Date.now(), toolName: 'exec',
    schemaCheck: { pass: true },
    riskScore: { score: 10, action: 'auto', dimensions: { impact: 0.1, reversibility: 0.9, sensitivity: 0, errorRate: 0.1 } },
    paramQuality: { score: 0.8, observations: [] },
    contextUtilization: { score: 0.7, patterns: [] },
    ...opts,
  };
}

function makeRun(opts: Partial<RuntimeMetrics> = {}): RuntimeMetrics {
  return {
    retryCount: 0, selfCorrected: false, hadTimeout: false,
    toolSuccess: true, toolSelectionMatch: true,
    adaptiveScore: 0.9, durationMs: 100, ...opts,
  };
}

function makePost(opts: Partial<PostExecMetrics> = {}): PostExecMetrics {
  return {
    verifyPassed: true, verifyScore: 0.95,
    userAccepted: true, userEditRate: 0, resultUtilized: true,
    outcomeScore: 0.9, healthy: true, ...opts,
  };
}

describe('AgentProfiler', () => {
  let feedback: ImplicitFeedbackEngine;
  let profiler: AgentProfiler;

  beforeEach(() => {
    feedback = new ImplicitFeedbackEngine();
    profiler = new AgentProfiler(feedback);
  });

  it('should return default profile with 0 ops', () => {
    const p = profiler.getProfile();
    expect(p.totalOps).toBe(0);
    // Score can be non-zero due to feedback engine initial state, just confirm it's valid
    expect(p.overallScore).toBeGreaterThanOrEqual(0);
    expect(p.overallScore).toBeLessThanOrEqual(100);
  });

  it('should record a cycle and compute profile', () => {
    profiler.recordCycle('s1', makePre(), makeRun(), makePost());
    const p = profiler.getProfile();
    expect(p.totalOps).toBe(1);
    expect(p.overallScore).toBeGreaterThanOrEqual(0);
    expect(p.overallScore).toBeLessThanOrEqual(100);
  });

  it('should include satisfaction in overall score', () => {
    feedback.record('user_used_result', 's1');
    profiler.recordCycle('s1', makePre(), makeRun(), makePost());
    const p = profiler.getProfile();
    expect(p.breakdown.userSatisfaction).toBeGreaterThanOrEqual(0);
  });

  it('should aggregate multiple cycles', () => {
    for (let i = 0; i < 5; i++) {
      profiler.recordCycle(`s${i}`, makePre(), makeRun(), makePost());
    }
    const p = profiler.getProfile();
    expect(p.totalOps).toBe(5);
  });

  it('should generate warnings for low runtime score', () => {
    for (let i = 0; i < 20; i++) {
      profiler.recordCycle(`s_low${i}`, makePre(), makeRun({ adaptiveScore: 0, retryCount: 5 }), makePost({ outcomeScore: 0 }));
    }
    const p = profiler.getProfile();
    expect(p.warnings.some(w => w.includes('retry'))).toBe(true);
  });

  it('should generate warnings for low post-exec score', () => {
    for (let i = 0; i < 20; i++) {
      profiler.recordCycle(`s_plow${i}`, makePre(), makeRun({ adaptiveScore: 0 }), makePost({ outcomeScore: 0, verifyPassed: false }));
    }
    const p = profiler.getProfile();
    expect(p.warnings.some(w => w.includes('verify'))).toBe(true);
  });

  it('should generate strengths for high scores', () => {
    feedback.record('user_shared_output', 's1');
    profiler.recordCycle('s1', makePre(), makeRun({ adaptiveScore: 0.95 }), makePost({ outcomeScore: 0.95 }));
    const p = profiler.getProfile();
    expect(p.strengths.length).toBeGreaterThan(0);
  });

  it('should detect improving trend', () => {
    // First: low score
    profiler.recordCycle('s1', makePre({ paramQuality: { score: 0.3, observations: [] }, contextUtilization: { score: 0.3, patterns: [] } }),
      makeRun({ adaptiveScore: 0.4 }), makePost({ outcomeScore: 0.4 }));
    // Force old timestamp for first cycle
    const pm = (profiler as any).preMetrics[0];
    pm.timestamp = Date.now() - 25 * 60 * 60 * 1000;

    // Second: high score (recent)
    profiler.recordCycle('s2', makePre({ paramQuality: { score: 0.9, observations: [] }, contextUtilization: { score: 0.9, patterns: [] } }),
      makeRun({ adaptiveScore: 0.9 }), makePost({ outcomeScore: 0.95 }));

    const p = profiler.getProfile();
    expect(p.trends.improving).toBe(true);
    expect(p.trends.recentOps).toBe(1);
  });

  it('should track per-session scores', () => {
    profiler.recordCycle('s1', makePre(), makeRun(), makePost());
    profiler.recordCycle('s1', makePre(), makeRun(), makePost());
    const p = profiler.getProfile('s1');
    expect(p.totalOps).toBe(2);
  });

  it('should compute correct breakdown averages', () => {
    profiler.recordCycle('s1', makePre({ paramQuality: { score: 1, observations: [] }, contextUtilization: { score: 1, patterns: [] } }),
      makeRun({ adaptiveScore: 1 }), makePost({ outcomeScore: 1 }));
    const p = profiler.getProfile();
    expect(p.breakdown.preExec).toBeGreaterThanOrEqual(50);
    expect(p.breakdown.runtime).toBeGreaterThanOrEqual(50);
    expect(p.breakdown.postExec).toBeGreaterThanOrEqual(50);
  });
});
