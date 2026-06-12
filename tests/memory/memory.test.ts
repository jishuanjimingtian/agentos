import { WorkingMemory, EpisodicMemory, SemanticMemoryStore } from '../../src';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('WorkingMemory', () => {
  let wm: WorkingMemory;

  beforeEach(() => {
    wm = new WorkingMemory(1000);
  });

  it('should create with a session ID', () => {
    expect(wm.sessionId).toMatch(/^wm_\d+_[a-f0-9]+$/);
  });

  it('should add messages and track token budget', () => {
    wm.addMessage('user', 'Hello world');
    expect(wm.recentMessages).toHaveLength(1);
    expect(wm.budget.used).toBeGreaterThan(0);
    expect(wm.budget.limit).toBe(1000);
  });

  it('should trim old messages when over budget', () => {
    // Fill with large content to exceed 1000 token budget
    for (let i = 0; i < 20; i++) {
      wm.addMessage('user', 'X'.repeat(200));
    }

    // Should have trimmed
    expect(wm.budget.used).toBeLessThanOrEqual(wm.budget.limit);
  });

  it('should set and manage tasks', () => {
    wm.setTask({
      description: 'Test task',
      steps: [
        { step: 'step1', status: 'pending' },
        { step: 'step2', status: 'pending' },
      ],
    });

    expect(wm.currentTask).toBeDefined();
    wm.updateStepStatus(0, 'in_progress');
    expect(wm.currentTask!.steps[0]!.status).toBe('in_progress');
  });

  it('should track open files', () => {
    wm.addOpenFile('src/main.ts');
    wm.addOpenFile('src/utils.ts');
    wm.addOpenFile('src/main.ts'); // duplicate
    expect(wm.openFiles).toHaveLength(2);
  });

  it('should cache and retrieve tool results', () => {
    wm.cacheToolResult('read_file', 'file content');
    const cached = wm.getCachedResult('read_file', 5000);
    expect(cached).toBeDefined();
    expect(cached?.result).toBe('file content');
  });

  it('should return undefined for expired cache', () => {
    wm.cacheToolResult('read_file', 'old');
    const cached = wm.getCachedResult('read_file', 0); // 0ms = expired
    expect(cached).toBeUndefined();
  });

  it('should get full state snapshot', () => {
    wm.addMessage('user', 'Hi');
    wm.addOpenFile('test.ts');
    const state = wm.getState();
    expect(state.recentMessages).toHaveLength(1);
    expect(state.openFiles).toHaveLength(1);
  });

  it('should clear everything', () => {
    wm.addMessage('user', 'Hi');
    wm.addOpenFile('test.ts');
    wm.setTask({ description: 'task', steps: [] });
    wm.cacheToolResult('test', 'result');

    wm.clear();

    expect(wm.recentMessages).toHaveLength(0);
    expect(wm.openFiles).toHaveLength(0);
    expect(wm.currentTask).toBeUndefined();
    expect(wm.budget.used).toBe(0);
  });
});

describe('EpisodicMemory', () => {
  let memory: EpisodicMemory;

  beforeEach(() => {
    memory = new EpisodicMemory(100); // Small max for compression tests
  });

  it('should record events with auto importance scoring', () => {
    const event = memory.record('correction', 'User corrected the output');

    expect(event.id).toMatch(/^ep_\d+_[a-f0-9]+$/);
    expect(event.type).toBe('correction');
    expect(event.importance).toBeGreaterThan(0.7);
    expect(event.compression).toBe('full');
  });

  it('should score low-importance events lower', () => {
    const toolCall = memory.record('tool_call', 'Read a file');
    const correction = memory.record('correction', 'Fix bug');

    expect(correction.importance).toBeGreaterThan(toolCall.importance);
  });

  it('should query events by type', () => {
    memory.record('tool_call', 'Call A');
    memory.record('tool_call', 'Call B');
    memory.record('decision', 'Decide X');

    const toolCalls = memory.query({ type: 'tool_call' });
    expect(toolCalls).toHaveLength(2);
  });

  it('should query events by importance threshold', () => {
    memory.record('tool_call', 'Low impact'); // ~0.2
    memory.record('correction', 'Important fix'); // ~0.9

    const high = memory.query({ minImportance: 0.5 });
    expect(high).toHaveLength(1);
    expect(high[0]!.type).toBe('correction');
  });

  it('should query events by time range', () => {
    memory.record('note', 'Past event');
    // Can't easily test timestamp queries without mocking Date.now,
    // but query with since=0 should return all
    const all = memory.query({ since: 0 });
    expect(all.length).toBeGreaterThanOrEqual(1);
  });

  it('should query events by tags', () => {
    memory.record('tool_call', 'File write', ['file', 'write']);
    memory.record('tool_call', 'File read', ['file', 'read']);
    memory.record('decision', 'Plan', ['planning']);

    const fileEvents = memory.query({ tags: ['file'] });
    expect(fileEvents).toHaveLength(2);
  });

  it('should get contextual events for session startup', () => {
    memory.record('correction', 'Important correction');
    memory.record('milestone', 'v1.0 released');
    memory.record('tool_call', 'Low-priority call');

    const contextual = memory.getContextualEvents();
    // High-importance + recent events
    expect(contextual.length).toBeGreaterThanOrEqual(2);
  });

  it('should generate context summary string', () => {
    memory.record('milestone', 'AgentOS v0.1.0 released');
    memory.record('correction', 'User prefers concise responses');

    const summary = memory.generateContextSummary();
    expect(summary).toContain('AgentOS');
    expect(summary).toContain('Episodic');
  });

  it('should compress old low-importance events', () => {
    // Fill with many low-importance events to trigger compression
    for (let i = 0; i < 20; i++) {
      memory.record('tool_call', `Call ${i} with lots of extra detail to make the content bigger`);
    }

    // Add one high-importance event at the end
    memory.record('milestone', 'Important milestone');

    const contextual = memory.getContextualEvents();
    // The milestone should still be there
    expect(contextual.some((e) => e.type === 'milestone')).toBe(true);
  });

  it('should persist and load from disk', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-episodic-'));
    const diskMemory = new EpisodicMemory(500);
    diskMemory.enablePersistence(tmpDir);
    diskMemory.record('milestone', 'Persisted event');

    // Load in a new instance
    const loaded = new EpisodicMemory(500);
    loaded.enablePersistence(tmpDir);
    expect(loaded.count).toBeGreaterThanOrEqual(1);
    expect(loaded.query({ type: 'milestone' })).toHaveLength(1);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('SemanticMemoryStore', () => {
  let store: SemanticMemoryStore;

  beforeEach(() => {
    store = new SemanticMemoryStore();
  });

  it('should set and get user preferences', () => {
    store.setPreference('language', 'zh-CN');
    store.setPreference('theme', 'dark');

    expect(store.getPreference('language')).toBe('zh-CN');
    expect(store.getPreference('missing')).toBeUndefined();
    expect(Object.keys(store.getAllPreferences())).toHaveLength(2);
  });

  it('should remove preferences', () => {
    store.setPreference('key', 'value');
    store.removePreference('key');
    expect(store.getPreference('key')).toBeUndefined();
  });

  it('should add and retrieve user facts', () => {
    store.addFact('User is based in Shanghai');
    store.addFact('User prefers TypeScript');
    store.addFact('User prefers TypeScript'); // duplicate

    expect(store.getFacts()).toHaveLength(2);
  });

  it('should set and get project context', () => {
    store.setProjectContext('agentos', {
      description: 'AI Agent OS',
      techStack: ['TypeScript', 'Node.js'],
      conventions: ['camelCase', 'semicolons'],
      architecture: 'Layered',
      knownIssues: ['Memory leak in guard'],
    });

    const ctx = store.getProjectContext('agentos')!;
    expect(ctx.description).toBe('AI Agent OS');
    expect(ctx.techStack).toContain('TypeScript');
    expect(ctx.conventions).toContain('camelCase');
    expect(ctx.knownIssues).toHaveLength(1);
  });

  it('should partial update project context', () => {
    store.setProjectContext('test', { description: 'initial' });
    store.setProjectContext('test', { techStack: ['Python'] });

    const ctx = store.getProjectContext('test')!;
    expect(ctx.description).toBe('initial'); // preserved
    expect(ctx.techStack).toContain('Python'); // updated
  });

  it('should learn and reinforce rules', () => {
    store.learnRule('Always test before committing', 'session_1');
    store.learnRule('Always test before committing', 'session_2');
    store.learnRule('Never push directly to main', 'session_1');

    const rules = store.getRules();
    expect(rules).toHaveLength(2);
    expect(rules[0]!.confidence).toBeGreaterThan(rules[1]!.confidence);
  });

  it('should filter rules by confidence', () => {
    store.learnRule('Test first', 's1');
    store.learnRule('Test first', 's2');
    store.learnRule('Test first', 's3'); // confidence = 0.7

    store.learnRule('Never push to main', 's1'); // 0.5

    const highConf = store.getRules(0.6);
    expect(highConf).toHaveLength(1);
    expect(highConf[0]!.rule).toBe('Test first');
  });

  it('should manage glossary terms', () => {
    store.defineTerm('AgentOS', 'AI Agent Operating System');
    expect(store.lookupTerm('AgentOS')).toBe('AI Agent Operating System');
    expect(store.lookupTerm('missing')).toBeUndefined();
    expect(Object.keys(store.getGlossary())).toHaveLength(1);
  });

  it('should generate context summary', () => {
    store.addFact('User in Shanghai');
    store.setPreference('language', 'zh-CN');
    store.setProjectContext('agentos', {
      description: 'Agent OS project',
      techStack: ['TypeScript'],
    });
    store.learnRule('Test first', 's1');
    store.learnRule('Test first', 's2'); // 0.6
    store.learnRule('Test first', 's3'); // 0.806

    const summary = store.generateContextSummary();
    expect(summary).toContain('Shanghai');
    expect(summary).toContain('Agent OS');
    expect(summary).toContain('Test first');
  });

  it('should persist and load from disk', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-semantic-'));
    const diskStore = new SemanticMemoryStore();
    diskStore.enablePersistence(tmpDir);
    diskStore.setPreference('key', 'value');
    diskStore.learnRule('Test rule', 's1');
    diskStore.flush();  // force write before reading

    const loaded = new SemanticMemoryStore();
    loaded.enablePersistence(tmpDir);
    expect(loaded.getPreference('key')).toBe('value');
    expect(loaded.getAllRules()).toHaveLength(1);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
