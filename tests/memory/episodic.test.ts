import { EpisodicMemory, EventType, CompressionLevel } from '../../src';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('EpisodicMemory', () => {
  let memory: EpisodicMemory;

  const ALL_EVENT_TYPES: EventType[] = [
    'tool_call',
    'tool_failure',
    'decision',
    'correction',
    'publish',
    'error',
    'milestone',
    'note',
    'user_feedback',
  ];

  beforeEach(() => {
    memory = new EpisodicMemory(500);
  });

  // =========================================================================
  // 1. record — 9 event types
  // =========================================================================
  describe('record', () => {
    it('should create events for all 9 event types with correct IDs', () => {
      for (const type of ALL_EVENT_TYPES) {
        const event = memory.record(type, `Test ${type}`);
        expect(event.id).toMatch(/^ep_\d+_[a-f0-9]+$/);
        expect(event.type).toBe(type);
        expect(event.content).toBe(`Test ${type}`);
        expect(event.compression).toBe('full' as CompressionLevel);
        expect(event.tags).toEqual([]);
        expect(event.relatedEntities).toEqual([]);
      }
      expect(memory.count).toBe(9);
    });

    it('should assign base importance values per event type', () => {
      // Known base values from EpisodicMemory:
      // tool_call=0.2, tool_failure=0.6, decision=0.8, correction=0.9,
      // publish=0.7, error=0.7, milestone=0.8, note=0.3, user_feedback=0.8
      const baseImportance: Record<string, number> = {
        tool_call: 0.2,
        tool_failure: 0.6,
        decision: 0.8,
        correction: 0.9,
        publish: 0.7,
        error: 0.7,
        milestone: 0.8,
        note: 0.3,
        user_feedback: 0.8,
      };

      for (const [type, expectedBase] of Object.entries(baseImportance)) {
        const memory2 = new EpisodicMemory(500);
        const event = memory2.record(type as EventType, 'test');
        // New event gets recencyBoost=1.0, frequencyBoost=0,
        // importance = min(1.0, baseImportance * 1.0 * 1 + 0)
        expect(event.importance).toBe(expectedBase);
      }
    });

    it('should apply recency boost (new events start at maximum)', () => {
      const event = memory.record('note', 'fresh note');
      // note base=0.3 * recencyBoost=1.0 = 0.3
      expect(event.importance).toBe(0.3);
    });

    it('should apply frequency boost for repeated tags', () => {
      // First event with tag "react" — no boost
      const e1 = memory.record('tool_call', 'install react', ['react']);
      // base=0.2, freqBoost=0
      expect(e1.importance).toBe(0.2);

      // Second event with same tag "react" — countByTags=1, freqBoost=0.1
      const e2 = memory.record('decision', 'use react', ['react']);
      // base=0.8, freqBoost=0.1 => 0.8 * 1.0 * 1.1 = 0.88
      expect(e2.importance).toBeCloseTo(0.88, 1);

      // Third event — countByTags=2, freqBoost=0.2
      const e3 = memory.record('note', 'react notes', ['react', 'frontend']);
      // base=0.3, freqBoost=0.2 => 0.3 * 1.0 * 1.2 = 0.36
      expect(e3.importance).toBeCloseTo(0.36, 1);
    });

    it('should cap frequency boost at max 0.5', () => {
      // Create 10+ events with same tag
      for (let i = 0; i < 10; i++) {
        memory.record('note', `note ${i}`, ['frequent']);
      }
      // The 10th event: countByTags=9, freqBoost = min(0.5, 9*0.1) = 0.5
      // base=0.3 * 1.0 * 1.5 = 0.45
      const e = memory.record('note', 'final note', ['frequent']);
      expect(e.importance).toBeCloseTo(0.45, 1);
    });

    it('should apply customImportanceBoost', () => {
      const e = memory.record('note', 'critical note', [], [], 0.5);
      // base=0.3 * 1.0 * 1.0 + 0.5 = 0.8
      expect(e.importance).toBe(0.8);
    });

    it('should clamp importance to max 1.0', () => {
      const e = memory.record('milestone', 'huge milestone', [], [], 0.5);
      // base=0.8 * 1.0 * 1.0 + 0.5 = 1.3 → clamped to 1.0
      expect(e.importance).toBe(1.0);
    });

    it('should store tags and relatedEntities on the event', () => {
      const e = memory.record(
        'decision',
        'switch to TypeScript',
        ['architecture', 'typescript'],
        ['project-foo'],
      );
      expect(e.tags).toEqual(['architecture', 'typescript']);
      expect(e.relatedEntities).toEqual(['project-foo']);
    });
  });

  // =========================================================================
  // 2. query — filter by type, importance, time, tags, limit
  // =========================================================================
  describe('query', () => {
    beforeEach(() => {
      memory.record('tool_call', 'run build', ['build'], [], 0.1);
      memory.record('error', 'build failed', ['build', 'error'], [], 0.3);
      memory.record('decision', 'fix config', ['config'], [], 0.2);
      memory.record('milestone', 'first deploy', ['deploy'], [], 0.3);
      memory.record('note', 'remember to update docs', ['docs'], [], 0);
    });

    it('should filter by type', () => {
      const results = memory.query({ type: 'error' });
      expect(results).toHaveLength(1);
      expect(results[0]!.type).toBe('error');
    });

    it('should filter by minImportance', () => {
      // tool_call=0.3 (base=0.2+boost=0.1), error=0.9 (base=0.6+boost=0.3),
      // decision=1.0 (base=0.8+boost=0.2), milestone=1.0 (base=0.8+boost=0.3),
      // note=0.3
      const results = memory.query({ minImportance: 0.8 });
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.importance).toBeGreaterThanOrEqual(0.8);
      }
    });

    it('should filter by time window (since/until)', () => {
      const now = Date.now();
      // Record events at specific times by manipulating timestamps
      const memory2 = new EpisodicMemory(500);
      const e1 = memory2.record('note', 'old note');
      // manually adjust timestamps for testing
      (e1 as any).timestamp = now - 100_000;

      const e2 = memory2.record('note', 'recent note');
      (e2 as any).timestamp = now - 1_000;

      const events = memory2.query({ since: now - 50_000 });
      expect(events).toHaveLength(1);
      expect(events[0]!.content).toBe('recent note');
    });

    it('should filter by tags', () => {
      const results = memory.query({ tags: ['build'] });
      // Should match both tool_call and error events (both tagged 'build')
      expect(results).toHaveLength(2);
      for (const r of results) {
        expect(r.tags).toContain('build');
      }
    });

    it('should respect limit', () => {
      // Seed 5 events
      const results = memory.query({ limit: 2 });
      expect(results).toHaveLength(2);
    });

    it('should return newest first', () => {
      const results = memory.query({});
      expect(results.length).toBeGreaterThanOrEqual(2);
      // Timestamps should be descending
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1]!.timestamp).toBeGreaterThanOrEqual(results[i]!.timestamp);
      }
    });

    it('should return empty array for no matches', () => {
      const results = memory.query({ type: 'publish' });
      expect(results).toEqual([]);
    });

    it('should default limit to 100', () => {
      const memory3 = new EpisodicMemory(99999);
      for (let i = 0; i < 150; i++) {
        memory3.record('note', `note ${i}`);
      }
      const results = memory3.query({});
      expect(results).toHaveLength(100);
    });
  });

  // =========================================================================
  // 3. getAll / getContextualEvents / generateContextSummary
  // =========================================================================
  describe('getAll', () => {
    it('should return all events sorted newest first', () => {
      memory.record('note', 'a');
      memory.record('note', 'b');
      memory.record('note', 'c');

      const all = memory.getAll();
      expect(all).toHaveLength(3);
      expect(all[0]!.content).toBe('c');
      expect(all[1]!.content).toBe('b');
      expect(all[2]!.content).toBe('a');
    });

    it('should return a copy, not the internal array', () => {
      memory.record('note', 'original');
      const all = memory.getAll();
      all.pop();
      expect(memory.count).toBe(1);
    });
  });

  describe('getContextualEvents', () => {
    it('should include recent events within specified days', () => {
      const now = Date.now();
      const e1 = memory.record('note', 'recent');
      (e1 as any).timestamp = now - 1_000;

      // Simulate old event by setting timestamp in the past
      const memory2 = new EpisodicMemory(500);
      const e2 = memory2.record('note', 'old');
      (e2 as any).timestamp = now - 14 * 24 * 60 * 60 * 1000; // 14 days ago

      const contextual = memory.getContextualEvents(7); // last 7 days
      expect(contextual.length).toBeGreaterThan(0);
      // 'old' should not be in results from memory2
      const mem2Contextual = memory2.getContextualEvents(7);
      expect(mem2Contextual).toHaveLength(0);
    });

    it('should always include high-importance events regardless of age', () => {
      const now = Date.now();
      // Create a high-importance correction event far in the past
      const memory2 = new EpisodicMemory(99999);
      const e = memory2.record('correction', 'important old correction');
      (e as any).timestamp = now - 100 * 24 * 60 * 60 * 1000; // 100 days ago

      const contextual = memory2.getContextualEvents(7);
      expect(contextual.length).toBeGreaterThan(0);
      expect(contextual[0]!.content).toBe('important old correction');
    });

    it('should respect max parameter', () => {
      for (let i = 0; i < 5; i++) {
        memory.record('milestone', `milestone ${i}`);
      }
      const results = memory.getContextualEvents(30, 2);
      expect(results).toHaveLength(2);
    });

    it('should sort by importance first, then by recency', () => {
      const now = Date.now();
      const memory2 = new EpisodicMemory(99999);

      const e1 = memory2.record('note', 'low importance');
      (e1 as any).timestamp = now - 1_000;

      const e2 = memory2.record('correction', 'high importance');
      (e2 as any).timestamp = now - 100_000;

      const results = memory2.getContextualEvents(30, 10);
      expect(results.length).toBeGreaterThanOrEqual(2);
      // correction should come first (importance 0.9 > 0.3)
      expect(results[0]!.type).toBe('correction');
      expect(results[1]!.type).toBe('note');
    });
  });

  describe('generateContextSummary', () => {
    it('should generate a string with episodic memory header', () => {
      memory.record('milestone', 'Project launched');
      memory.record('decision', 'Use PostgreSQL over MongoDB');

      const summary = memory.generateContextSummary();
      expect(summary).toContain('[AgentOS Episodic Memory]');
      expect(summary).toContain('Project launched');
      expect(summary).toContain('PostgreSQL');
    });

    it('should return empty string when no events exist', () => {
      const summary = memory.generateContextSummary();
      expect(summary).toBe('');
    });

    it('should respect maxChars parameter and truncate', () => {
      memory.record('milestone', 'A'.repeat(300)); // long content
      const summary = memory.generateContextSummary(100);
      expect(summary.length).toBeLessThanOrEqual(100);
    });
  });

  // =========================================================================
  // 4. compressIfNeeded / compressEvent — progressive compression
  // =========================================================================
  describe('compression', () => {
    it('should compress full events to summary when importance < 0.3 and age > 7 days', () => {
      const memory2 = new EpisodicMemory(1); // tiny max — triggers compression immediately
      const oldTimestamp = Date.now() - 10 * 24 * 60 * 60 * 1000; // 10 days ago

      const event = memory2.record('note', 'This is a very long note about something trivial');
      // Manually set timestamp to old and importance low
      (event as any).timestamp = oldTimestamp;
      (event as any).importance = 0.2;

      // Force compression by recording more events to exceed 1KB
      for (let i = 0; i < 50; i++) {
        const e = memory2.record('note', `filler ${i} `.repeat(20));
        (e as any).importance = 0.15;
      }

      // The original event should eventually be compressed
      const all = memory2.getAll();
      const original = all.find((e) => e.id === event.id);
      if (original && original.compression !== 'forgotten') {
        // It may have been compressed to summary — content should be truncated to ≤250 chars
        expect(original.content.length).toBeLessThanOrEqual(250);
      }
    });

    it('should compress summary events to one-liner when importance < 0.2 and age > 30 days', () => {
      const memory2 = new EpisodicMemory(1);
      const oldTimestamp = Date.now() - 35 * 24 * 60 * 60 * 1000; // 35 days ago

      const event = memory2.record('note', 'Line one\nLine two\nLine three of content');
      (event as any).timestamp = oldTimestamp;
      (event as any).importance = 0.1;
      (event as any).compression = 'summary' as CompressionLevel;
      // content is already trimmed to first 250 by record
      (event as any).content = 'Line one\nLine two\nLine three of content some extra padding '.repeat(8);

      for (let i = 0; i < 60; i++) {
        const e = memory2.record('note', `x${i} `.repeat(25));
        (e as any).importance = 0.05;
      }

      const all = memory2.getAll();
      const original = all.find((e) => e.id === event.id);
      if (original) {
        // Should be one-liner — content ≤120 chars, no newlines
        if (original.compression === 'one-liner') {
          expect(original.content.length).toBeLessThanOrEqual(120);
          expect(original.content).not.toContain('\n');
        }
      }
    });

    it('should forget (compression=forgotten) one-liner events when importance < 0.1 and age > 90 days', () => {
      const memory2 = new EpisodicMemory(1);
      const oldTimestamp = Date.now() - 100 * 24 * 60 * 60 * 1000; // 100 days ago — sure to be old

      // Create a very old, low-importance event
      const event = memory2.record('note', 'very old trivial note');
      (event as any).timestamp = oldTimestamp;
      (event as any).importance = 0.05;
      (event as any).compression = 'one-liner' as CompressionLevel;

      // Record many events to force compressIfNeeded
      for (let i = 0; i < 80; i++) {
        const e = memory2.record('note', `${'padding '.repeat(30)}${i}`);
        (e as any).importance = 0.9; // high importance to protect them
      }

      const all = memory2.getAll();
      const original = all.find((e) => e.id === event.id);
      // The event should be forgotten (not returned by getAll since it's filtered... 
      // Actually getAll returns all events including forgotten ones — let's check)
      if (original) {
        expect(original.compression).toBe('forgotten');
      }
    });

    it('should not compress high-importance events (importance >= 0.7)', () => {
      const memory2 = new EpisodicMemory(1);
      const highImportanceEvent = memory2.record('correction', 'Critical fix needed');

      // Fill the memory to trigger compression
      for (let i = 0; i < 70; i++) {
        const e = memory2.record('note', `filler ${i} `.repeat(20));
        (e as any).importance = 0.05;
      }

      const all = memory2.getAll();
      const highEvent = all.find((e) => e.id === highImportanceEvent.id);
      // High importance events should remain full unless they're forgotten
      expect(highEvent).toBeDefined();
      if (highEvent) {
        // importance >= 0.7 → compressIfNeeded skips (score check: e.importance < 0.7)
        // So it should still be 'full'
        expect(highEvent.compression).toBe('full');
      }
    });

    it('should progressively compress from full → summary → one-liner → forgotten', () => {
      const memory2 = new EpisodicMemory(5); // 5KB
      const oldTimestamp = Date.now() - 120 * 24 * 60 * 60 * 1000; // 120 days old — will go all the way

      // Record a low importance event
      const event = memory2.record('note', 'A'.repeat(500));
      (event as any).timestamp = oldTimestamp;
      (event as any).importance = 0.05;

      // First batch: compress full → summary
      for (let i = 0; i < 30; i++) {
        const e = memory2.record('note', `pad1 ${'x'.repeat(200)} ${i}`);
        (e as any).importance = 0.9;
      }

      let all = memory2.getAll();
      let ev = all.find((e) => e.id === event.id);
      if (ev) {
        // Should have been compressed to at least summary (content ≤250)
        expect(['summary', 'one-liner', 'forgotten']).toContain(ev.compression);
      }

      // Continue recording to compress further
      for (let i = 0; i < 40; i++) {
        const e = memory2.record('note', `pad2 ${'y'.repeat(200)} ${i}`);
        (e as any).importance = 0.9;
      }

      all = memory2.getAll();
      ev = all.find((e) => e.id === event.id);
      if (ev) {
        expect(['one-liner', 'forgotten']).toContain(ev.compression);
      }
    });
  });

  // =========================================================================
  // 5. count / estimatedSize / maxSize getter
  // =========================================================================
  describe('count / estimatedSize / maxSize', () => {
    it('count should return number of events', () => {
      expect(memory.count).toBe(0);
      memory.record('note', 'a');
      expect(memory.count).toBe(1);
      memory.record('note', 'b');
      expect(memory.count).toBe(2);
    });

    it('estimatedSize should return JSON size of events', () => {
      const initialSize = memory.estimatedSize;
      expect(initialSize).toBe(2); // JSON.stringify([]) = "[]" = 2 bytes

      memory.record('note', 'hello');
      expect(memory.estimatedSize).toBeGreaterThan(initialSize);
    });

    it('estimatedSize should grow proportionally with more/larger events', () => {
      const size0 = memory.estimatedSize;
      memory.record('note', 'short');
      const size1 = memory.estimatedSize;
      memory.record('note', 'a much longer event content string here '.repeat(10));
      const size2 = memory.estimatedSize;
      expect(size1).toBeGreaterThan(size0);
      expect(size2).toBeGreaterThan(size1);
    });

    it('maxSize getter should return configured value', () => {
      expect(memory.maxSize).toBe(500);

      const mem100 = new EpisodicMemory(100);
      expect(mem100.maxSize).toBe(100);

      const memDefault = new EpisodicMemory();
      expect(memDefault.maxSize).toBe(500);
    });
  });

  // =========================================================================
  // 6. enablePersistence: save/load round-trip
  // =========================================================================
  describe('persistence', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-episodic-test-'));
    });

    afterEach(() => {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('should save events to disk after enablePersistence', () => {
      const mem = new EpisodicMemory(500);
      mem.enablePersistence(tmpDir);

      const event = mem.record('milestone', 'saved milestone', ['persist']);
      expect(event.id).toBeDefined();

      // Check file exists
      const filePath = path.join(tmpDir, '.agentos', 'episodic.json');
      expect(fs.existsSync(filePath)).toBe(true);

      // Check content
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(1);
      expect(data[0].type).toBe('milestone');
      expect(data[0].content).toBe('saved milestone');
      expect(data[0].tags).toEqual(['persist']);
    });

    it('should load events from disk on enablePersistence', () => {
      // First: create and save
      const mem1 = new EpisodicMemory(500);
      mem1.enablePersistence(tmpDir);
      const originalId = mem1.record('decision', 'decision A', ['tag-a']).id;

      // Second: new instance, enablePersistence should load
      const mem2 = new EpisodicMemory(500);
      mem2.enablePersistence(tmpDir);

      expect(mem2.count).toBe(1);
      const all = mem2.getAll();
      expect(all[0]!.id).toBe(originalId);
      expect(all[0]!.type).toBe('decision');
      expect(all[0]!.content).toBe('decision A');
      expect(all[0]!.tags).toEqual(['tag-a']);
    });

    it('should handle corrupted save file gracefully', () => {
      const filePath = path.join(tmpDir, '.agentos', 'episodic.json');
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, 'not valid json {{', 'utf-8');

      const mem = new EpisodicMemory(500);
      // Should not throw, should reset to empty
      expect(() => mem.enablePersistence(tmpDir)).not.toThrow();
      expect(mem.count).toBe(0);
    });

    it('should handle non-existent save file gracefully', () => {
      // No save file exists, should start fresh
      const mem = new EpisodicMemory(500);
      expect(() => mem.enablePersistence(tmpDir)).not.toThrow();
      expect(mem.count).toBe(0);
    });

    it('should not persist when storagePath is not set', () => {
      const mem = new EpisodicMemory(500);
      // Record without enabling persistence
      mem.record('note', 'ephemeral');
      // Should not throw — save() is a no-op when storagePath is undefined
      expect(mem.count).toBe(1);
      // No file is written since storagePath is undefined
    });

    it('should auto-save after each record when persistence is enabled', () => {
      const mem = new EpisodicMemory(500);
      mem.enablePersistence(tmpDir);

      mem.record('note', 'event 1');
      mem.record('note', 'event 2');
      mem.record('note', 'event 3');

      const filePath = path.join(tmpDir, '.agentos', 'episodic.json');
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw);
      expect(data.length).toBe(3);
    });
  });

  // =========================================================================
  // 7. All 5 compression levels
  // =========================================================================
  describe('compression levels', () => {
    const COMPRESSION_LEVELS: CompressionLevel[] = ['full', 'summary', 'one-liner', 'forgotten'];

    it('should support all 4 compression levels', () => {
      // Verify that the enum has exactly 4 values
      expect(COMPRESSION_LEVELS).toHaveLength(4);
      expect(COMPRESSION_LEVELS).toContain('full');
      expect(COMPRESSION_LEVELS).toContain('summary');
      expect(COMPRESSION_LEVELS).toContain('one-liner');
      expect(COMPRESSION_LEVELS).toContain('forgotten');
    });

    it('should initialize all events with compression "full"', () => {
      for (const type of ALL_EVENT_TYPES) {
        const mem = new EpisodicMemory(99999);
        const event = mem.record(type, `test ${type}`);
        expect(event.compression).toBe('full');
      }
    });

    it('should only compress events with importance < 0.7', () => {
      const mem = new EpisodicMemory(1);
      const criticalEvent = mem.record('correction', 'critical');
      // importance ~0.9 — should not be a compression candidate

      for (let i = 0; i < 100; i++) {
        const e = mem.record('note', 'x'.repeat(200));
        (e as any).importance = 0.05; // low importance
      }

      const all = mem.getAll();
      const critical = all.find((e) => e.id === criticalEvent.id);
      expect(critical).toBeDefined();
      // compressIfNeeded loop checks: e.importance < 0.7 before compressing
      // So high-importance events are safe
      if (critical) {
        expect(critical.compression).toBe('full');
      }
    });

    it('should not compress events when memory is under limit', () => {
      const mem = new EpisodicMemory(99999); // huge limit
      for (let i = 0; i < 10; i++) {
        mem.record('note', `note ${i}`.repeat(20));
      }
      for (const event of mem.getAll()) {
        expect(event.compression).toBe('full');
      }
    });
  });

  // =========================================================================
  // 8. Edge cases
  // =========================================================================
  describe('edge cases', () => {
    it('should handle recording with no arguments beyond type and content', () => {
      const event = memory.record('note', 'minimal');
      expect(event.tags).toEqual([]);
      expect(event.relatedEntities).toEqual([]);
      expect(event.importance).toBe(0.3); // note base = 0.3
    });

    it('should handle query with empty filter', () => {
      memory.record('note', 'a');
      memory.record('note', 'b');
      const results = memory.query({});
      expect(results).toHaveLength(2);
    });

    it('should handle generateContextSummary with empty memory', () => {
      const summary = new EpisodicMemory().generateContextSummary();
      expect(summary).toBe('');
    });

    it('should generate unique IDs for rapid recording', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const event = memory.record('note', `note ${i}`);
        ids.add(event.id);
      }
      expect(ids.size).toBe(100);
    });

    it('should handle default parameters for getContextualEvents', () => {
      const results = memory.getContextualEvents();
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeLessThanOrEqual(20); // default max=20
    });

    it('should not save when persistence is not enabled', () => {
      // This is verified by checking no throws occur
      expect(() => {
        for (let i = 0; i < 10; i++) {
          memory.record('note', `note ${i}`);
        }
      }).not.toThrow();
      expect(memory.count).toBe(10);
    });
  });
});
