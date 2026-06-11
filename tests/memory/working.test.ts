import { WorkingMemory } from '../../src';
import type { WorkingMemoryState } from '../../src';

describe('WorkingMemory', () => {
  let wm: WorkingMemory;

  beforeEach(() => {
    wm = new WorkingMemory(1000);
  });

  // ──────────────────────────────────────────────
  // Constructor & Session
  // ──────────────────────────────────────────────

  it('should create a WorkingMemory with a unique session ID and default budget', () => {
    expect(wm.sessionId).toMatch(/^wm_\d+_[a-f0-9]+$/);
    expect(wm.maxTokens).toBe(1000);
    expect(wm.budget).toEqual({ used: 0, limit: 1000 });
    expect(wm.recentMessages).toEqual([]);
    expect(wm.openFiles).toEqual([]);
    expect(wm.currentTask).toBeUndefined();
  });

  it('should create two WorkingMemory instances with different session IDs', () => {
    const wm2 = new WorkingMemory();
    expect(wm.sessionId).not.toBe(wm2.sessionId);
  });

  // ──────────────────────────────────────────────
  // addMessage
  // ──────────────────────────────────────────────

  it('should add a user message and increment token budget', () => {
    wm.addMessage('user', 'Hello world');

    expect(wm.recentMessages).toHaveLength(1);
    expect(wm.recentMessages[0]!.role).toBe('user');
    expect(wm.recentMessages[0]!.content).toBe('Hello world');
    expect(wm.recentMessages[0]!.timestamp).toBeGreaterThan(0);
    expect(wm.budget.used).toBeGreaterThan(0);
    expect(wm.budget.used).toBeLessThanOrEqual(wm.budget.limit);
  });

  it('should add agent, user and tool messages with correct roles', () => {
    wm.addMessage('user', 'What is this?');
    wm.addMessage('agent', 'This is AgentOS.');
    wm.addMessage('tool', '{"result":"ok"}');

    expect(wm.recentMessages).toHaveLength(3);
    expect(wm.recentMessages[0]!.role).toBe('user');
    expect(wm.recentMessages[1]!.role).toBe('agent');
    expect(wm.recentMessages[2]!.role).toBe('tool');
  });

  it('should estimate tokens as ceil(content.length / 2) for English text', () => {
    // estimateTokens is private, but we can observe budget.used after addMessage
    wm.addMessage('user', 'abcd'); // 4 chars -> ceil(4/2) = 2 tokens
    expect(wm.budget.used).toBe(2);

    wm.addMessage('user', 'abc'); // 3 chars -> ceil(3/2) = 2 tokens
    expect(wm.budget.used).toBe(4);
  });

  it('should estimate tokens for Chinese text (each char ≈ 1 token via length/2+)', () => {
    wm.addMessage('user', '你好'); // 2 Chinese chars -> ceil(2/2) = 1 token
    expect(wm.budget.used).toBe(1);

    wm.addMessage('user', '你好世界'); // 4 Chinese chars -> ceil(4/2) = 2 tokens
    expect(wm.budget.used).toBe(3);
  });

  it('should trim old messages when token budget is exceeded', () => {
    // Add messages with known size: 200 chars each -> 100 tokens each
    wm = new WorkingMemory(300); // 300 token limit

    wm.addMessage('user', 'a'); // small, 1 token
    wm.addMessage('user', 'X'.repeat(200)); // 100 tokens -> total 101
    wm.addMessage('agent', 'X'.repeat(200)); // 100 tokens -> total 201
    wm.addMessage('user', 'X'.repeat(200)); // 100 tokens -> would reach 301 > 300, should trim

    // After adding the 4th message, budget should be <= 300
    expect(wm.budget.used).toBeLessThanOrEqual(wm.budget.limit);
    // The oldest message should have been trimmed (budget exceeded → trim loop ran)
    // Small 'a' message (1 token) is trimmed, leaving 3 messages at 301→201 tokens
    expect(wm.recentMessages.length).toBe(3);
  });

  it('should preserve at least 2 messages even when both exceed budget', () => {
    wm = new WorkingMemory(10); // tiny budget

    wm.addMessage('user', 'AAAAAAAAAAAAAAAAAAAA'); // 20 chars = 10 tokens; hits limit
    wm.addMessage('agent', 'BBBBBBBBBBBBBBBBBBBB'); // 20 chars = 10 tokens; exceeds, will trim

    // Must still keep at least 2 messages
    expect(wm.recentMessages.length).toBe(2);
    // Budget will likely exceed limit (2 * 10 = 20 > 10), but that's the invariant
    expect(wm.recentMessages.length).toBeGreaterThanOrEqual(2);
  });

  it('should trim multiple old messages if budget is severely exceeded', () => {
    wm = new WorkingMemory(250);

    wm.addMessage('user', 'short'); // 5 chars -> 3 tokens
    wm.addMessage('agent', 'short'); // 3 tokens
    wm.addMessage('user', 'X'.repeat(200)); // 100 tokens -> total 106
    wm.addMessage('agent', 'X'.repeat(200)); // 100 tokens -> total 206
    wm.addMessage('user', 'X'.repeat(200)); // 100 tokens -> would be 306 > 250, trim

    expect(wm.budget.used).toBeLessThanOrEqual(wm.budget.limit);
    // msg1, msg2 should have been removed; msg3-msg5 remain (or at least 2)
    expect(wm.recentMessages.length).toBeGreaterThanOrEqual(2);
  });

  it('should not trim messages when under budget', () => {
    wm = new WorkingMemory(10000);

    for (let i = 0; i < 50; i++) {
      wm.addMessage('user', 'short msg');
    }

    // All 50 messages should remain
    expect(wm.recentMessages).toHaveLength(50);
    expect(wm.budget.used).toBeLessThanOrEqual(wm.budget.limit);
  });

  // ──────────────────────────────────────────────
  // Tasks
  // ──────────────────────────────────────────────

  it('should set a task and update step statuses individually', () => {
    wm.setTask({
      description: 'Deploy to production',
      steps: [
        { step: 'Build', status: 'pending' },
        { step: 'Test', status: 'pending' },
        { step: 'Deploy', status: 'pending' },
      ],
    });

    expect(wm.currentTask).toBeDefined();
    expect(wm.currentTask!.description).toBe('Deploy to production');
    expect(wm.currentTask!.steps).toHaveLength(3);

    // Update step 0
    wm.updateStepStatus(0, 'in_progress');
    expect(wm.currentTask!.steps[0]!.status).toBe('in_progress');

    // Update step 0 again
    wm.updateStepStatus(0, 'done');
    expect(wm.currentTask!.steps[0]!.status).toBe('done');

    // Update step 1
    wm.updateStepStatus(1, 'in_progress');
    expect(wm.currentTask!.steps[1]!.status).toBe('in_progress');

    // Step 2 should still be pending
    expect(wm.currentTask!.steps[2]!.status).toBe('pending');
  });

  it('should no-op when updateStepStatus is called with an out-of-range index', () => {
    wm.setTask({
      description: 'Simple',
      steps: [{ step: 'Only step', status: 'pending' }],
    });

    // Should not throw
    expect(() => wm.updateStepStatus(1, 'in_progress')).not.toThrow();
    expect(() => wm.updateStepStatus(5, 'done')).not.toThrow();
    expect(wm.currentTask!.steps[0]!.status).toBe('pending');
  });

  it('should no-op when updateStepStatus is called with no current task', () => {
    expect(() => wm.updateStepStatus(0, 'in_progress')).not.toThrow();
  });

  it('should overwrite the current task when setTask is called again', () => {
    wm.setTask({
      description: 'First task',
      steps: [{ step: 'A', status: 'pending' }],
    });

    wm.setTask({
      description: 'Second task',
      steps: [{ step: 'B', status: 'pending' }],
    });

    expect(wm.currentTask!.description).toBe('Second task');
    expect(wm.currentTask!.steps).toHaveLength(1);
    expect(wm.currentTask!.steps[0]!.step).toBe('B');
  });

  // ──────────────────────────────────────────────
  // Open Files
  // ──────────────────────────────────────────────

  it('should add files to openFiles avoiding duplicates', () => {
    wm.addOpenFile('src/index.ts');
    wm.addOpenFile('src/core.ts');
    wm.addOpenFile('src/index.ts'); // duplicate — should be ignored
    wm.addOpenFile('src/core.ts'); // duplicate

    expect(wm.openFiles).toEqual(['src/index.ts', 'src/core.ts']);
  });

  it('should remove a tracked file', () => {
    wm.addOpenFile('a.ts');
    wm.addOpenFile('b.ts');
    wm.addOpenFile('c.ts');

    wm.removeOpenFile('b.ts');
    expect(wm.openFiles).toEqual(['a.ts', 'c.ts']);

    // Removing non-existent file should no-op
    wm.removeOpenFile('d.ts');
    expect(wm.openFiles).toEqual(['a.ts', 'c.ts']);
  });

  it('should remove all files one by one', () => {
    wm.addOpenFile('x.ts');
    wm.addOpenFile('y.ts');

    wm.removeOpenFile('x.ts');
    expect(wm.openFiles).toEqual(['y.ts']);

    wm.removeOpenFile('y.ts');
    expect(wm.openFiles).toEqual([]);
  });

  // ──────────────────────────────────────────────
  // Tool Result Cache
  // ──────────────────────────────────────────────

  it('should cache and retrieve a tool result', () => {
    wm.cacheToolResult('read_file', 'file contents here');
    const result = wm.getCachedResult('read_file', 60000);

    expect(result).toBeDefined();
    expect(result!.toolName).toBe('read_file');
    expect(result!.result).toBe('file contents here');
    expect(result!.timestamp).toBeGreaterThan(0);
  });

  it('should cache results for different tools independently', () => {
    wm.cacheToolResult('read', 'read data');
    wm.cacheToolResult('write', { ok: true });

    expect(wm.getCachedResult('read', 5000)?.result).toBe('read data');
    expect(wm.getCachedResult('write', 5000)?.result).toEqual({ ok: true });
  });

  it('should return undefined for expired cache', () => {
    wm.cacheToolResult('search', 'results');

    // maxAgeMs = 0 means immediately expired
    expect(wm.getCachedResult('search', 0)).toBeUndefined();

    // maxAgeMs = -1 should also be expired
    expect(wm.getCachedResult('search', -1)).toBeUndefined();
  });

  it('should return undefined for never-cached tool', () => {
    expect(wm.getCachedResult('nonexistent', 60000)).toBeUndefined();
  });

  it('should overwrite cache for the same tool name', () => {
    wm.cacheToolResult('read', 'original');
    wm.cacheToolResult('read', 'updated');

    expect(wm.getCachedResult('read', 60000)?.result).toBe('updated');
  });

  // ──────────────────────────────────────────────
  // getState
  // ──────────────────────────────────────────────

  it('should return an immutable snapshot of the current state', () => {
    wm.addMessage('user', 'Hello');
    wm.addOpenFile('src/main.ts');
    wm.setTask({
      description: 'Review PR',
      steps: [{ step: 'Check diff', status: 'pending' }],
    });
    wm.cacheToolResult('lint', 'no errors');

    const snapshot: WorkingMemoryState = wm.getState();

    expect(snapshot.sessionId).toBe(wm.sessionId);
    expect(snapshot.recentMessages).toHaveLength(1);
    expect(snapshot.recentMessages[0]!.content).toBe('Hello');
    expect(snapshot.currentTask).toBeDefined();
    expect(snapshot.currentTask!.description).toBe('Review PR');
    expect(snapshot.recentToolResults.get('lint')).toBeDefined();
    expect(snapshot.openFiles).toEqual(['src/main.ts']);
    expect(snapshot.budget.used).toBeGreaterThan(0);

    // Mutate snapshot — should NOT affect original
    snapshot.recentMessages.push({
      role: 'agent',
      content: 'mutated',
      timestamp: 999,
    });
    snapshot.openFiles.push('evil.ts');
    snapshot.recentToolResults.set('hack', {
      toolName: 'hack',
      result: 'bad',
      timestamp: 1,
    });
    (snapshot as any).budget.used = 99999;

    expect(wm.recentMessages).toHaveLength(1);
    expect(wm.openFiles).toEqual(['src/main.ts']);
    expect(wm.recentToolResults.has('hack')).toBe(false);
    expect(wm.budget.used).not.toBe(99999);
  });

  // ──────────────────────────────────────────────
  // clear
  // ──────────────────────────────────────────────

  it('should clear all working memory state (messages, task, files, cache, budget)', () => {
    wm.addMessage('user', 'msg1');
    wm.addMessage('agent', 'msg2');
    wm.setTask({
      description: 'Active task',
      steps: [{ step: 'Do something', status: 'in_progress' }],
    });
    wm.addOpenFile('a.ts');
    wm.addOpenFile('b.ts');
    wm.cacheToolResult('search', 'some data');
    wm.cacheToolResult('fetch', 'more data');

    // Verify pre-clear state
    expect(wm.recentMessages).toHaveLength(2);
    expect(wm.currentTask).toBeDefined();
    expect(wm.openFiles).toHaveLength(2);
    expect(wm.recentToolResults.size).toBe(2);
    expect(wm.budget.used).toBeGreaterThan(0);

    wm.clear();

    expect(wm.recentMessages).toEqual([]);
    expect(wm.currentTask).toBeUndefined();
    expect(wm.openFiles).toEqual([]);
    expect(wm.recentToolResults.size).toBe(0);
    expect(wm.budget.used).toBe(0);
    // sessionId should survive clear
    expect(wm.sessionId).toMatch(/^wm_\d+_[a-f0-9]+$/);
  });

  it('should be reusable after clear', () => {
    wm.addMessage('user', 'before clear');
    wm.clear();

    wm.addMessage('user', 'after clear');
    wm.addOpenFile('new.ts');
    wm.setTask({ description: 'New task', steps: [] });

    expect(wm.recentMessages).toHaveLength(1);
    expect(wm.recentMessages[0]!.content).toBe('after clear');
    expect(wm.openFiles).toEqual(['new.ts']);
    expect(wm.currentTask!.description).toBe('New task');
    expect(wm.budget.used).toBeGreaterThan(0);
  });
});
