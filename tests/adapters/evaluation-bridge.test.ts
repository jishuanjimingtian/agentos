/**
 * Evaluation Bridge 测试
 */
import { WorkingMemory } from '../../src/memory/working';
import { EvaluationBridge, resetEvaluationBridge } from '../../src/adapters/evaluation-bridge';

describe('EvaluationBridge', () => {
  let bridge: EvaluationBridge;
  let wm: WorkingMemory;

  beforeEach(() => {
    wm = new WorkingMemory(50000);
    // 先填充一些上下文
    wm.addMessage('user', 'read projects/coderev/src/index.ts');
    wm.addOpenFile('projects/coderev/src/index.ts');
    wm.cacheToolResult('read_file', 'export class Main {}');

    bridge = new EvaluationBridge(wm, 'test-session');
  });

  afterEach(() => {
    resetEvaluationBridge();
  });

  it('should complete a full pre→post evaluation cycle', () => {
    const opId = bridge.preExec('read', {
      path: 'projects/coderev/src/index.ts',
      limit: 50,
    });

    expect(opId).toContain('op_');

    bridge.postExec(opId, {
      verifyPassed: true,
      verifyChecks: 1,
      verifyFailures: 0,
      result: { content: 'export class Main {}' },
    });

    const profile = bridge.getProfile();
    expect(profile.totalOps).toBe(1);
    expect(profile.overallScore).toBeGreaterThanOrEqual(0);
    expect(profile.breakdown.preExec).toBeGreaterThan(0);
  });

  it('should detect low-quality parameters', () => {
    const opId = bridge.preExec('write', {
      path: 'somefile.txt',
      content: '',
    });

    bridge.postExec(opId);
    const profile = bridge.getProfile();
    // 空内容应该降低评分
    expect(profile.breakdown.preExec).toBeLessThanOrEqual(80);
  });

  it('should detect high-quality context-aware parameters', () => {
    const opId = bridge.preExec('read', {
      path: 'projects/coderev/src/index.ts',
      offset: 0,
      limit: 100,
    });

    bridge.postExec(opId, { verifyPassed: true });
    const profile = bridge.getProfile();
    // 路径匹配打开的文件 = 高评分
    expect(profile.breakdown.preExec).toBeGreaterThan(50);
  });

  it('should penalize retries and timeouts', () => {
    const opId = bridge.preExec('exec', { command: 'npm test' });
    bridge.postExec(opId, {
      retryCount: 3,
      hadTimeout: true,
    });

    const profile = bridge.getProfile();
    expect(profile.breakdown.runtime).toBeLessThanOrEqual(50);
    expect(profile.warnings.length).toBeGreaterThan(0);
  });

  it('should record and query feedback', () => {
    bridge.recordFeedback('user_used_result');
    bridge.recordFeedback('user_explicit_approval');

    const stats = bridge.getFeedbackStats();
    expect(stats.totalSignals).toBe(2);
    expect(stats.positiveSignals).toBe(2);

    const satisfaction = bridge.getSatisfaction();
    expect(satisfaction).toBeGreaterThan(0);
  });

  it('should generate readable report', () => {
    const opId = bridge.preExec('write', {
      path: 'test.ts',
      content: 'console.log("hello");',
    });
    bridge.postExec(opId, { verifyPassed: true });

    const report = bridge.generateReport();
    expect(report).toContain('综合评分');
    expect(report).toContain('/100');
  });

  it('should generate compact report', () => {
    const opId = bridge.preExec('exec', { command: 'npm test' });
    bridge.postExec(opId);

    const compact = bridge.generateCompactReport();
    expect(compact).toContain('综合评分');
  });

  it('should track tool accuracy', () => {
    // 两次成功
    for (let i = 0; i < 2; i++) {
      const opId = bridge.preExec('read', { path: 'file.ts' });
      bridge.postExec(opId, { verifyPassed: true, result: 'ok' });
    }

    const acc = bridge.getToolAccuracy();
    expect(acc['read']).toBeDefined();
    expect(acc['read'].calls).toBe(2);
  });

  it('should export state', () => {
    const opId = bridge.preExec('write', { path: 'test.ts', content: 'x' });
    bridge.postExec(opId, { verifyPassed: true });

    const state = bridge.exportState();
    expect((state as any).sessionId).toBe('test-session');
    expect((state as any).profile).toBeDefined();
  });
});
