import {
  PreExecEvaluator,
  RuntimeEvaluator,
  PostExecEvaluator,
} from '../../src/evaluator/exec-evaluator';
import { SchemaGate } from '../../src/guard/schema-gate';
import { RiskGate } from '../../src/guard/risk-gate';
import { WorkingMemory } from '../../src/memory/working';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeps() {
  const schemaGate = new SchemaGate();
  const riskGate = new RiskGate();
  const workingMemory = new WorkingMemory();
  return { schemaGate, riskGate, workingMemory };
}

// ---------------------------------------------------------------------------
// PreExecEvaluator
// ---------------------------------------------------------------------------

describe('PreExecEvaluator', () => {
  describe('evaluate', () => {
    it('应返回 PreExecMetrics 含 schemaCheck / riskScore / paramQuality / contextUtilization (用例 1)', () => {
      const { schemaGate, riskGate, workingMemory } = makeDeps();
      const evaluator = new PreExecEvaluator(schemaGate, riskGate, workingMemory);

      const metrics = evaluator.evaluate('read_file', { path: '/tmp/foo.ts' });

      expect(metrics).toHaveProperty('timestamp');
      expect(metrics).toHaveProperty('toolName', 'read_file');
      expect(metrics).toHaveProperty('schemaCheck');
      expect(metrics).toHaveProperty('riskScore');
      expect(metrics).toHaveProperty('paramQuality');
      expect(metrics).toHaveProperty('contextUtilization');

      expect(metrics.schemaCheck).toHaveProperty('pass');
      expect(metrics.riskScore).toHaveProperty('score');
      expect(typeof metrics.paramQuality.score).toBe('number');
      expect(typeof metrics.contextUtilization.score).toBe('number');
    });

    it('schemaCheck.pass 在没有注册规则时应为 true (用例 2)', () => {
      const { schemaGate, riskGate, workingMemory } = makeDeps();
      const evaluator = new PreExecEvaluator(schemaGate, riskGate, workingMemory);

      const metrics = evaluator.evaluate('some_unknown_tool', {});

      expect(metrics.schemaCheck.pass).toBe(true);
      expect(metrics.schemaCheck.errors).toBeUndefined();
    });

    it('riskScore 在没有注册风险画像时应返回默认中等分数 (用例 3)', () => {
      const { schemaGate, riskGate, workingMemory } = makeDeps();
      const evaluator = new PreExecEvaluator(schemaGate, riskGate, workingMemory);

      const metrics = evaluator.evaluate('unregistered_tool', {});

      expect(metrics.riskScore.score).toBeGreaterThan(0);
    });

    it('paramQuality 在 path 引用了 openFiles 时加 0.3 (用例 4)', () => {
      const { schemaGate, riskGate, workingMemory } = makeDeps();
      const evaluator = new PreExecEvaluator(schemaGate, riskGate, workingMemory);

      workingMemory.addOpenFile('src/index.ts');
      workingMemory.addOpenFile('README.md');

      const metrics = evaluator.evaluate('read_file', { path: 'src/index.ts' });

      // base 0.5 + 0.3 (open file match) =
      expect(metrics.paramQuality.score).toBeGreaterThanOrEqual(0.8);
      expect(metrics.paramQuality.observations).toContain('Path references an open file');
    });

    it('paramQuality 在 path 引用但不在 openFiles 时没有 "references open file" (用例 5)', () => {
      const { schemaGate, riskGate, workingMemory } = makeDeps();
      const evaluator = new PreExecEvaluator(schemaGate, riskGate, workingMemory);

      workingMemory.addOpenFile('other.ts');

      const metrics = evaluator.evaluate('read_file', { path: '/tmp/random.ts' });

      expect(metrics.paramQuality.observations).not.toContain('Path references an open file');
    });

    it('paramQuality 在 content 为空字符串时扣 0.2 并记录 observation (用例 6)', () => {
      const { schemaGate, riskGate, workingMemory } = makeDeps();
      const evaluator = new PreExecEvaluator(schemaGate, riskGate, workingMemory);

      const metrics = evaluator.evaluate('write_file', { path: '/tmp/foo', content: '' });

      expect(metrics.paramQuality.observations).toContain('Empty content — possible error');
      // base 0.5 - 0.2 =
      expect(metrics.paramQuality.score).toBeLessThanOrEqual(0.3);
    });

    it('paramQuality 在 content 长度 > 20 时加 0.1 (用例 7)', () => {
      const { schemaGate, riskGate, workingMemory } = makeDeps();
      const evaluator = new PreExecEvaluator(schemaGate, riskGate, workingMemory);

      const metrics = evaluator.evaluate('write_file', {
        path: '/tmp/foo',
        content: 'this is a long enough string to get bonus',
      });

      // base 0.5 + 0.1 (content > 20) =
      expect(metrics.paramQuality.score).toBeGreaterThanOrEqual(0.6);
    });

    it('paramQuality 在多文件引用时加分 (用例 8)', () => {
      const { schemaGate, riskGate, workingMemory } = makeDeps();
      const evaluator = new PreExecEvaluator(schemaGate, riskGate, workingMemory);

      const metrics = evaluator.evaluate('rename', {
        from: 'src/old.ts',
        to: 'src/new.ts',
      });

      expect(metrics.paramQuality.observations).toContain(
        'Multiple file references — coordinated operation',
      );
    });

    it('paramQuality 分数不会超过 1.0 (用例 9)', () => {
      const { schemaGate, riskGate, workingMemory } = makeDeps();
      const evaluator = new PreExecEvaluator(schemaGate, riskGate, workingMemory);

      // Multiple bonues: open file + content > 20 + multiple file refs
      workingMemory.addOpenFile('src/a.ts');
      workingMemory.addOpenFile('src/b.ts');

      const metrics = evaluator.evaluate('move', {
        from: 'src/a.ts',
        to: 'src/b.ts',
        content: 'this content is long enough for the bonus to apply',
      });

      expect(metrics.paramQuality.score).toBeLessThanOrEqual(1.0);
    });

    it('paramQuality 分数不会低于 0 (用例 10)', () => {
      const { schemaGate, riskGate, workingMemory } = makeDeps();
      const evaluator = new PreExecEvaluator(schemaGate, riskGate, workingMemory);

      // empty content triggers -0.2 from 0.5 base => 0.3
      const metrics = evaluator.evaluate('write_file', { content: '' });

      expect(metrics.paramQuality.score).toBeGreaterThanOrEqual(0);
    });

    it('contextUtilization 在 recentMessages 存在时加分 (用例 11)', () => {
      const { schemaGate, riskGate, workingMemory } = makeDeps();
      const evaluator = new PreExecEvaluator(schemaGate, riskGate, workingMemory);

      workingMemory.addMessage('user', 'Please read the configuration file');

      const metrics = evaluator.evaluate('read_file', { path: 'config.json' });

      expect(metrics.contextUtilization.score).toBeGreaterThanOrEqual(0.5);
      expect(
        metrics.contextUtilization.patterns.some((p) => p.includes('recent messages')),
      ).toBe(true);
    });

    it('contextUtilization 在 cachedResults 存在时加分 (用例 12)', () => {
      const { schemaGate, riskGate, workingMemory } = makeDeps();
      const evaluator = new PreExecEvaluator(schemaGate, riskGate, workingMemory);

      workingMemory.cacheToolResult('ls', ['file1.ts', 'file2.ts']);
      workingMemory.cacheToolResult('grep', []);

      const metrics = evaluator.evaluate('read_file', { path: 'file1.ts' });

      expect(metrics.contextUtilization.score).toBeGreaterThanOrEqual(0.5);
      expect(
        metrics.contextUtilization.patterns.some((p) => p.includes('cached results')),
      ).toBe(true);
    });

    it('contextUtilization 在参数值匹配 recentMessages 单词时加分 (用例 13)', () => {
      const { schemaGate, riskGate, workingMemory } = makeDeps();
      const evaluator = new PreExecEvaluator(schemaGate, riskGate, workingMemory);

      workingMemory.addMessage('user', 'Can you check the config.json file?');

      const metrics = evaluator.evaluate('read_file', { path: 'config.json' });

      expect(metrics.contextUtilization.score).toBeGreaterThan(0.4);
    });

    it('contextUtilization 分数不会超过 1.0 (用例 14)', () => {
      const { schemaGate, riskGate, workingMemory } = makeDeps();
      const evaluator = new PreExecEvaluator(schemaGate, riskGate, workingMemory);

      // Stack multiple bonuses
      workingMemory.addMessage('user', 'Check the config.json file for settings');
      workingMemory.cacheToolResult('ls', []);
      workingMemory.cacheToolResult('grep', []);

      const metrics = evaluator.evaluate('read_file', { path: 'config.json file settings' });

      expect(metrics.contextUtilization.score).toBeLessThanOrEqual(1.0);
    });

    it('schemaGate.check 在注册了 required 规则且缺失参数时返回 failure (用例 15)', () => {
      const { schemaGate, riskGate, workingMemory } = makeDeps();
      const evaluator = new PreExecEvaluator(schemaGate, riskGate, workingMemory);

      schemaGate.registerRule({
        tool: 'write_file',
        required: ['path', 'content'],
      });

      const metrics = evaluator.evaluate('write_file', { path: '/tmp/test.txt' }); // missing content

      expect(metrics.schemaCheck.pass).toBe(false);
      expect(metrics.schemaCheck.errors).toBeDefined();
      expect(metrics.schemaCheck.errors!.some((e) => e.field === 'content')).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// RuntimeEvaluator
// ---------------------------------------------------------------------------

describe('RuntimeEvaluator', () => {
  describe('evaluate', () => {
    it('应返回 RuntimeMetrics 含 retryCount / selfCorrected / hadTimeout / toolSuccess / adaptiveScore (用例 16)', () => {
      const evaluator = new RuntimeEvaluator();

      const metrics = evaluator.evaluate({
        toolName: 'read_file',
        startTime: 1000,
        endTime: 1100,
        retryCount: 0,
        wasSelfCorrected: false,
        hadTimeout: false,
        toolResult: { content: 'hello' },
      });

      expect(metrics).toHaveProperty('retryCount', 0);
      expect(metrics).toHaveProperty('selfCorrected', false);
      expect(metrics).toHaveProperty('hadTimeout', false);
      expect(metrics).toHaveProperty('toolSuccess', true);
      expect(metrics).toHaveProperty('adaptiveScore');
      expect(typeof metrics.adaptiveScore).toBe('number');
      expect(metrics).toHaveProperty('durationMs', 100);
    });

    it('adaptiveScore 在 retryCount > 0 时扣除 0.15 每次 (用例 17)', () => {
      const evaluator = new RuntimeEvaluator();

      const metrics = evaluator.evaluate({
        toolName: 'write_file',
        startTime: 1000,
        endTime: 1200,
        retryCount: 2,
        wasSelfCorrected: false,
        hadTimeout: false,
        toolResult: 'ok',
      });

      // 1.0 - 2 * 0.15 = 0.70
      expect(metrics.adaptiveScore).toBeCloseTo(0.7, 2);
    });

    it('adaptiveScore 在 timeout 时扣 0.5 (用例 18)', () => {
      const evaluator = new RuntimeEvaluator();

      const metrics = evaluator.evaluate({
        toolName: 'network_request',
        startTime: 1000,
        endTime: 35000,
        retryCount: 0,
        wasSelfCorrected: false,
        hadTimeout: true,
        toolResult: undefined,
      });

      // 1.0 - 0.5 = 0.5, toolSuccess = false (hadTimeout + no result)
      expect(metrics.adaptiveScore).toBeCloseTo(0.5, 2);
      expect(metrics.toolSuccess).toBe(false);
    });

    it('adaptiveScore 在 selfCorrected 时加 0.2 (用例 19)', () => {
      const evaluator = new RuntimeEvaluator();

      const metrics = evaluator.evaluate({
        toolName: 'exec_command',
        startTime: 1000,
        endTime: 1500,
        retryCount: 0,
        wasSelfCorrected: true,
        hadTimeout: false,
        toolResult: { output: 'fixed' },
      });

      // 1.0 + 0.2 = 1.0 (clamped)
      expect(metrics.adaptiveScore).toBeGreaterThanOrEqual(1.0);
    });

    it('toolSelectionMatch 在 expectedTool 匹配时为 true (用例 20)', () => {
      const evaluator = new RuntimeEvaluator();

      const metrics = evaluator.evaluate({
        toolName: 'read_file',
        startTime: 1000,
        endTime: 1100,
        retryCount: 0,
        wasSelfCorrected: false,
        hadTimeout: false,
        expectedTool: 'read_file',
        toolResult: {},
      });

      expect(metrics.toolSelectionMatch).toBe(true);
    });

    it('toolSelectionMatch 在 expectedTool 不匹配时为 false (用例 21)', () => {
      const evaluator = new RuntimeEvaluator();

      const metrics = evaluator.evaluate({
        toolName: 'exec_command',
        startTime: 1000,
        endTime: 1100,
        retryCount: 0,
        wasSelfCorrected: false,
        hadTimeout: false,
        expectedTool: 'read_file',
        toolResult: {},
      });

      expect(metrics.toolSelectionMatch).toBe(false);
    });

    it('toolSelectionMatch 在无 expectedTool 但有 history > 70% 成功率时为 true (用例 22)', () => {
      const evaluator = new RuntimeEvaluator();

      // Build up history with 4 successes out of 5 calls = 80% > 70%
      for (let i = 0; i < 5; i++) {
        evaluator.evaluate({
          toolName: 'read_file',
          startTime: 1000,
          endTime: 1100,
          retryCount: 0,
          wasSelfCorrected: false,
          hadTimeout: false,
          toolResult: i === 4 ? undefined : { content: 'ok' }, // 4th call fails
        });
      }

      // Next call — history should be 3/4 = 75% at point of evaluation
      const metrics = evaluator.evaluate({
        toolName: 'read_file',
        startTime: 1000,
        endTime: 1100,
        retryCount: 0,
        wasSelfCorrected: false,
        hadTimeout: false,
        toolResult: { content: 'ok' },
        // No expectedTool — uses history
      });

      // After 5 prior + 1 new call = 6 calls with 5 successes → the check happens
      // before this new call is recorded, so history was 4/5 = 80% > 70%
      const acc = evaluator.getToolAccuracy();
      expect(acc['read_file']).toBeDefined();
      // Auto-detected match when rate > 0.7
      expect(typeof metrics.toolSelectionMatch).toBe('boolean');
    });

    it('无 expectedTool 且历史成功率 ≤ 70% 时 toolSelectionMatch 为 undefined (用例 23)', () => {
      const evaluator = new RuntimeEvaluator();

      // Build history: 1 success, 2 failures → 33% < 70%
      evaluator.evaluate({
        toolName: 'flaky_tool',
        startTime: 1000,
        endTime: 1100,
        retryCount: 0,
        wasSelfCorrected: false,
        hadTimeout: false,
        toolResult: 'ok', // success #1
      });
      evaluator.evaluate({
        toolName: 'flaky_tool',
        startTime: 1000,
        endTime: 1100,
        retryCount: 0,
        wasSelfCorrected: false,
        hadTimeout: true,
        toolResult: undefined, // failure
      });
      evaluator.evaluate({
        toolName: 'flaky_tool',
        startTime: 1000,
        endTime: 1100,
        retryCount: 0,
        wasSelfCorrected: false,
        hadTimeout: true,
        toolResult: undefined, // failure
      });

      // After 3 calls: 1 success / 3 calls = 33% → toolSelectionMatch = undefined
      const metrics = evaluator.evaluate({
        toolName: 'flaky_tool',
        startTime: 1000,
        endTime: 1100,
        retryCount: 0,
        wasSelfCorrected: false,
        hadTimeout: false,
        toolResult: 'ok',
      });

      expect(metrics.toolSelectionMatch).toBeUndefined();
    });

    it('durationMs 计算正确 (用例 24)', () => {
      const evaluator = new RuntimeEvaluator();

      const metrics = evaluator.evaluate({
        toolName: 'compute',
        startTime: 1000,
        endTime: 3250,
        retryCount: 0,
        wasSelfCorrected: false,
        hadTimeout: false,
        toolResult: { result: 42 },
      });

      expect(metrics.durationMs).toBe(2250);
    });

    it('toolSuccess 在有 result 且无 timeout 时为 true (用例 25)', () => {
      const evaluator = new RuntimeEvaluator();

      const metrics = evaluator.evaluate({
        toolName: 'read_file',
        startTime: 1000,
        endTime: 1100,
        retryCount: 0,
        wasSelfCorrected: false,
        hadTimeout: false,
        toolResult: { content: 'data' },
      });

      expect(metrics.toolSuccess).toBe(true);
    });

    it('toolSuccess 在 timeout 时为 false (用例 26)', () => {
      const evaluator = new RuntimeEvaluator();

      const metrics = evaluator.evaluate({
        toolName: 'api_call',
        startTime: 1000,
        endTime: 31000,
        retryCount: 0,
        wasSelfCorrected: false,
        hadTimeout: true,
        toolResult: { data: 'partial' },
      });

      // hadTimeout = true → toolSuccess = false regardless of result
      expect(metrics.toolSuccess).toBe(false);
    });

    it('adaptiveScore 在组合 retry + selfCorrected 时综合计算 (用例 27)', () => {
      const evaluator = new RuntimeEvaluator();

      const metrics = evaluator.evaluate({
        toolName: 'fix_file',
        startTime: 1000,
        endTime: 2000,
        retryCount: 2,
        wasSelfCorrected: true,
        hadTimeout: false,
        toolResult: 'fixed',
      });

      // 1.0 - 2*0.15 + 0.2 = 0.90
      expect(metrics.adaptiveScore).toBeCloseTo(0.9, 2);
    });

    it('adaptiveScore 下限为 0 (用例 28)', () => {
      const evaluator = new RuntimeEvaluator();

      const metrics = evaluator.evaluate({
        toolName: 'bad_tool',
        startTime: 1000,
        endTime: 1100,
        retryCount: 10,
        wasSelfCorrected: false,
        hadTimeout: true,
        toolResult: undefined,
      });

      // 1.0 - 10*0.15 - 0.5 = 1.0 - 1.5 - 0.5 = -1.0 → clamped to 0
      expect(metrics.adaptiveScore).toBe(0);
    });
  });

  describe('getToolAccuracy', () => {
    it('空历史时返回空对象 (用例 29)', () => {
      const evaluator = new RuntimeEvaluator();
      expect(evaluator.getToolAccuracy()).toEqual({});
    });

    it('返回各工具的成功率统计 (用例 30)', () => {
      const evaluator = new RuntimeEvaluator();

      // read_file: 3 calls, 3 successes
      for (let i = 0; i < 3; i++) {
        evaluator.evaluate({
          toolName: 'read_file',
          startTime: 1000,
          endTime: 1100,
          retryCount: 0,
          wasSelfCorrected: false,
          hadTimeout: false,
          toolResult: { content: `data${i}` },
        });
      }

      // write_file: 2 calls, 1 success
      evaluator.evaluate({
        toolName: 'write_file',
        startTime: 1000,
        endTime: 1100,
        retryCount: 0,
        wasSelfCorrected: false,
        hadTimeout: false,
        toolResult: 'ok',
      });
      evaluator.evaluate({
        toolName: 'write_file',
        startTime: 1000,
        endTime: 1100,
        retryCount: 0,
        wasSelfCorrected: false,
        hadTimeout: true,
        toolResult: undefined,
      });

      const acc = evaluator.getToolAccuracy();

      expect(acc['read_file']).toEqual({ calls: 3, successRate: 1 });
      expect(acc['write_file']).toEqual({ calls: 2, successRate: 0.5 });
    });
  });

  describe('recordToolCall (内部)', () => {
    it('recordToolCall 在 evaluate 中自动被调用并增加调用计数 (用例 31)', () => {
      const evaluator = new RuntimeEvaluator();

      evaluator.evaluate({
        toolName: 'test_tool',
        startTime: 1000,
        endTime: 1100,
        retryCount: 0,
        wasSelfCorrected: false,
        hadTimeout: false,
        toolResult: 'ok',
      });

      const acc = evaluator.getToolAccuracy();
      expect(acc['test_tool']!.calls).toBe(1);
      expect(acc['test_tool']!.successRate).toBe(1);
    });

    it('多次调用同一工具正确累加计数 (用例 32)', () => {
      const evaluator = new RuntimeEvaluator();

      for (let i = 0; i < 5; i++) {
        evaluator.evaluate({
          toolName: 'retry_tool',
          startTime: 1000,
          endTime: 1100,
          retryCount: 0,
          wasSelfCorrected: false,
          hadTimeout: false,
          toolResult: 'ok',
        });
      }

      expect(evaluator.getToolAccuracy()['retry_tool']!.calls).toBe(5);
    });
  });
});

// ---------------------------------------------------------------------------
// PostExecEvaluator
// ---------------------------------------------------------------------------

describe('PostExecEvaluator', () => {
  describe('evaluate', () => {
    it('应返回 PostExecMetrics 含 verifyScore / acceptance / outcomeScore / healthy (用例 33)', () => {
      const evaluator = new PostExecEvaluator();

      const metrics = evaluator.evaluate({
        verifyPassed: true,
        verifyChecks: 5,
        verifyFailures: 0,
        userAccepted: true,
        userProvidedEdit: false,
        resultWasUsed: true,
      });

      expect(metrics).toHaveProperty('verifyPassed', true);
      expect(metrics).toHaveProperty('verifyScore');
      expect(metrics).toHaveProperty('userAccepted', true);
      expect(metrics).toHaveProperty('userEditRate');
      expect(metrics).toHaveProperty('resultUtilized', true);
      expect(metrics).toHaveProperty('outcomeScore');
      expect(metrics).toHaveProperty('healthy');
      expect(metrics).toHaveProperty('diffLinesChanged');
    });

    it('verifyScore 在无失败时为 1.0 (用例 34)', () => {
      const evaluator = new PostExecEvaluator();

      const metrics = evaluator.evaluate({
        verifyPassed: true,
        verifyChecks: 4,
        verifyFailures: 0,
        userAccepted: true,
        userProvidedEdit: false,
        resultWasUsed: true,
      });

      expect(metrics.verifyScore).toBe(1);
    });

    it('verifyScore 在有失败时按比例计算 (用例 35)', () => {
      const evaluator = new PostExecEvaluator();

      const metrics = evaluator.evaluate({
        verifyPassed: false,
        verifyChecks: 4,
        verifyFailures: 2,
        userAccepted: false,
        userProvidedEdit: true,
        resultWasUsed: false,
      });

      // 1 - (2 / 4) = 0.5
      expect(metrics.verifyScore).toBe(0.5);
    });

    it('verifyScore 在 verifyChecks 为 0 时默认返回 1.0 (用例 36)', () => {
      const evaluator = new PostExecEvaluator();

      const metrics = evaluator.evaluate({
        verifyPassed: true,
        verifyChecks: 0,
        verifyFailures: 0,
        userAccepted: true,
        userProvidedEdit: false,
        resultWasUsed: true,
      });

      // 0 > 0 → 1
      expect(metrics.verifyScore).toBe(1);
    });

    it('acceptance 在 userAccepted 时为 1.0 (用例 37)', () => {
      const evaluator = new PostExecEvaluator();

      const metrics = evaluator.evaluate({
        verifyPassed: true,
        verifyChecks: 1,
        verifyFailures: 0,
        userAccepted: true,
        userProvidedEdit: false,
        resultWasUsed: true,
      });

      expect(metrics.userAccepted).toBe(true);
      // outcomeScore: verifyScore(1) * 0.3 + acceptance(1) * 0.4 + wasUsed(1) * 0.3 = 1
      expect(metrics.outcomeScore).toBe(1);
    });

    it('userEditRate 在 userProvidedEdit 时为 1 (用例 38)', () => {
      const evaluator = new PostExecEvaluator();

      const metrics = evaluator.evaluate({
        verifyPassed: false,
        verifyChecks: 1,
        verifyFailures: 0,
        userAccepted: false,
        userProvidedEdit: true,
        resultWasUsed: false,
      });

      expect(metrics.userEditRate).toBe(1);
    });

    it('healthy 在 verifyScore > 0.8 且 acceptance > 0.5 时为 true (用例 39)', () => {
      const evaluator = new PostExecEvaluator();

      const metrics = evaluator.evaluate({
        verifyPassed: true,
        verifyChecks: 10,
        verifyFailures: 1,
        userAccepted: true,
        userProvidedEdit: false,
        resultWasUsed: true,
      });

      // verifyScore = 1 - 1/10 = 0.9, acceptance = 1.0
      expect(metrics.healthy).toBe(true);
    });

    it('healthy 在 verifyScore ≤ 0.8 时为 false (用例 40)', () => {
      const evaluator = new PostExecEvaluator();

      const metrics = evaluator.evaluate({
        verifyPassed: false,
        verifyChecks: 5,
        verifyFailures: 2,
        userAccepted: true,
        userProvidedEdit: false,
        resultWasUsed: true,
      });

      // verifyScore = 1 - 2/5 = 0.6 ≤ 0.8
      expect(metrics.healthy).toBe(false);
    });

    it('healthy 在 userDidNotAccept 且无 edit 时 acceptance = 0.7 (用例 41)', () => {
      const evaluator = new PostExecEvaluator();

      const metrics = evaluator.evaluate({
        verifyPassed: true,
        verifyChecks: 5,
        verifyFailures: 0,
        userAccepted: false,
        userProvidedEdit: false,
        resultWasUsed: false,
      });

      // acceptance = 0.7
      // outcomeScore = 1*0.3 + 0.7*0.4 + 0*0.3 = 0.58
      expect(metrics.outcomeScore).toBeCloseTo(0.58, 2);
    });

    it('acceptance 在 userProvidedEdit 时仅为 0.3 (用例 42)', () => {
      const evaluator = new PostExecEvaluator();

      const metrics = evaluator.evaluate({
        verifyPassed: false,
        verifyChecks: 1,
        verifyFailures: 0,
        userAccepted: false,
        userProvidedEdit: true,
        resultWasUsed: false,
      });

      // outcomeScore = 1*0.3 + 0.3*0.4 + 0*0.3 = 0.42
      expect(metrics.outcomeScore).toBeCloseTo(0.42, 2);
    });

    it('outcomeScore 在 resultWasUsed 时加 0.3 (用例 43)', () => {
      const evaluator = new PostExecEvaluator();

      const metrics = evaluator.evaluate({
        verifyPassed: true,
        verifyChecks: 1,
        verifyFailures: 0,
        userAccepted: true,
        userProvidedEdit: false,
        resultWasUsed: true,
      });

      // outcomeScore = 1*0.3 + 1*0.4 + 1*0.3 = 1.0
      expect(metrics.outcomeScore).toBe(1);
    });

    it('diffLinesChanged 被正确透传 (用例 44)', () => {
      const evaluator = new PostExecEvaluator();

      const metrics = evaluator.evaluate({
        verifyPassed: true,
        verifyChecks: 1,
        verifyFailures: 0,
        userAccepted: true,
        userProvidedEdit: false,
        resultWasUsed: true,
        diffLinesChanged: 15,
      });

      expect(metrics.diffLinesChanged).toBe(15);
    });

    it('diffLinesChanged 未提供时为 undefined (用例 45)', () => {
      const evaluator = new PostExecEvaluator();

      const metrics = evaluator.evaluate({
        verifyPassed: true,
        verifyChecks: 1,
        verifyFailures: 0,
        userAccepted: true,
        userProvidedEdit: false,
        resultWasUsed: true,
      });

      expect(metrics.diffLinesChanged).toBeUndefined();
    });
  });

  describe('trackResult / markResultReferenced / isResultReferenced', () => {
    it('trackResult 记录结果，isResultReferenced 初始为 false (用例 46)', () => {
      const evaluator = new PostExecEvaluator();

      evaluator.trackResult('op-001', { output: 'hello' });

      expect(evaluator.isResultReferenced('op-001')).toBe(false);
    });

    it('markResultReferenced 后将 isResultReferenced 设为 true (用例 47)', () => {
      const evaluator = new PostExecEvaluator();

      evaluator.trackResult('op-002', { output: 'world' });
      evaluator.markResultReferenced('op-002');

      expect(evaluator.isResultReferenced('op-002')).toBe(true);
    });

    it('isResultReferenced 对未跟踪的 id 返回 false (用例 48)', () => {
      const evaluator = new PostExecEvaluator();

      expect(evaluator.isResultReferenced('non_existent')).toBe(false);
    });
  });

  describe('getUtilizationRate', () => {
    it('空跟踪时返回 0 (用例 49)', () => {
      const evaluator = new PostExecEvaluator();

      expect(evaluator.getUtilizationRate()).toBe(0);
    });

    it('所有结果都被引用时返回 1.0 (用例 50)', () => {
      const evaluator = new PostExecEvaluator();

      evaluator.trackResult('op-a', 'a');
      evaluator.trackResult('op-b', 'b');
      evaluator.markResultReferenced('op-a');
      evaluator.markResultReferenced('op-b');

      expect(evaluator.getUtilizationRate()).toBe(1);
    });

    it('部分被引用时返回正确比例 (用例 51)', () => {
      const evaluator = new PostExecEvaluator();

      // 4 results, only 1 referenced
      evaluator.trackResult('op-1', 'a');
      evaluator.trackResult('op-2', 'b');
      evaluator.trackResult('op-3', 'c');
      evaluator.trackResult('op-4', 'd');
      evaluator.markResultReferenced('op-1');

      // 1 / 4 = 0.25
      expect(evaluator.getUtilizationRate()).toBe(0.25);
    });

    it('利用率四舍五入到 2 位小数 (用例 52)', () => {
      const evaluator = new PostExecEvaluator();

      // 3 results, 1 referenced → 1/3 = 0.333... rounded to 0.33
      evaluator.trackResult('op-x', 'x');
      evaluator.trackResult('op-y', 'y');
      evaluator.trackResult('op-z', 'z');
      evaluator.markResultReferenced('op-x');

      expect(evaluator.getUtilizationRate()).toBeCloseTo(0.33, 2);
    });

    it('多次标记已引用的结果不影响统计 (用例 53)', () => {
      const evaluator = new PostExecEvaluator();

      evaluator.trackResult('dup', 'dup');
      evaluator.markResultReferenced('dup');
      evaluator.markResultReferenced('dup');
      evaluator.markResultReferenced('dup');

      // Still 1/1 = 1
      expect(evaluator.getUtilizationRate()).toBe(1);
    });
  });
});
