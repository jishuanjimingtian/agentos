/**
 * Memory Bridge 测试
 *
 * 运行: npx jest tests/adapters/memory-bridge.test.ts
 */
import { MemoryBridge, resetMemoryBridge } from '../../src/adapters/memory-bridge';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('MemoryBridge', () => {
  let tmpDir: string;
  let bridge: MemoryBridge;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-test-'));
    bridge = new MemoryBridge(tmpDir);
  });

  afterEach(() => {
    resetMemoryBridge();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should start and end a session', () => {
    const ctx = bridge.onSessionStart();
    expect(typeof ctx).toBe('string');

    bridge.setPreference('test', 1);  // 触发 semantic 写入
    bridge.recordEvent('note', 'test event');  // 触发 episodic 写入
    bridge.flush();
    bridge.onSessionEnd();
    bridge.flush();

    expect(fs.existsSync(path.join(tmpDir, '.agentos', 'episodic.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.agentos', 'semantic.json'))).toBe(true);
  });

  it('should set and retrieve preferences', () => {
    bridge.setPreference('theme', 'dark');
    expect(bridge.getSemanticMemory().getPreference('theme')).toBe('dark');
  });

  it('should learn and reinforce rules', () => {
    bridge.learnRule('always lint', 's1');
    bridge.learnRule('always lint', 's2');
    bridge.learnRule('never force push', 's1');

    const rules = bridge.getSemanticMemory().getRules(0.5);
    expect(rules.length).toBeGreaterThanOrEqual(2);
    // 重复学习的规则置信度应更高
    const lintRule = rules.find((r: { rule: string }) => r.rule === 'always lint');
    expect(lintRule).toBeDefined();
    expect(lintRule!.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it('should record events to episodic memory', () => {
    bridge.recordEvent('milestone', 'v1.0 released');
    bridge.recordEvent('correction', 'Fixed a bug');
    bridge.recordEvent('tool_call', 'Ran npm test');

    expect(bridge.getEpisodicMemory().count).toBe(3);

    const highImportance = bridge.getEpisodicMemory().query({ minImportance: 0.5 });
    expect(highImportance.length).toBeGreaterThanOrEqual(2); // milestone + correction
  });

  it('should record and cache tool results', () => {
    bridge.cacheToolResult('read_file', 'file content');
    const wm = bridge.getWorkingMemory();
    const cached = wm.getCachedResult('read_file', 5000);
    expect(cached).toBeDefined();
    expect(cached?.result).toBe('file content');
  });

  it('should generate session context', () => {
    bridge.recordEvent('milestone', 'AgentOS v0.1.0 released');
    bridge.recordEvent('correction', 'User prefers concise responses');
    bridge.addFact('Test user');
    bridge.setPreference('language', 'zh-CN');

    const ctx = bridge.onSessionStart();
    expect(ctx.length).toBeGreaterThan(0);
  });

  it('should generate status report', () => {
    bridge.recordEvent('note', 'test');
    const report = bridge.statusReport();
    expect(report).toContain('Memory Bridge');
    expect(report).toContain('Episodic');
    expect(report).toContain('Semantic');
  });

  it('should clear working memory on session end', () => {
    const wm = bridge.getWorkingMemory();
    wm.addMessage('user', 'Hello');
    wm.cacheToolResult('test', 'result');
    wm.addOpenFile('test.ts');

    bridge.onSessionStart();  // 必须先 start 才能 end
    bridge.onSessionEnd(true);

    // onSessionEnd 调用 clear() 清空 Working
    expect(wm.recentMessages).toHaveLength(0);
    expect(wm.openFiles).toHaveLength(0);
  });

  it('should generate snapshot', () => {
    bridge.recordEvent('note', 'test');

    const snap = bridge.getSnapshot();
    expect(snap.semantic).toBeDefined();
    expect(snap.episodic).toBeDefined();
    expect(snap.working).toBeDefined();
  });
});
