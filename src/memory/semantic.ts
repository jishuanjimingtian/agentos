import { SemanticMemory, LearnedRule } from '../types';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Semantic Memory — durable, distilled knowledge.
 *
 * Stores user preferences, project context, learned rules, and glossary
 * extracted from Episodic Memory over time. This is what persists
 * across all sessions and gets injected at startup.
 */
export class SemanticMemoryStore {
  private memory: SemanticMemory;
  private storagePath?: string;
  private _saveTimer: NodeJS.Timeout | null = null;
  private _dirty = false;

  constructor() {
    this.memory = {
      userPreferences: {},
      userFacts: [],
      projectContext: {},
      learnedRules: [],
      glossary: {},
    };
  }

  /** Enable disk persistence */
  enablePersistence(workspaceRoot: string): void {
    this.storagePath = path.join(workspaceRoot, '.agentos', 'semantic.json');
    this.load();
  }

  /** Get the full semantic memory */
  getMemory(): Readonly<SemanticMemory> {
    return this.memory;
  }

  // === User Preferences ===

  /** Set a user preference */
  setPreference(key: string, value: unknown): void {
    this.memory.userPreferences[key] = value;
    this.save();
  }

  /** Get a user preference */
  getPreference<T = unknown>(key: string): T | undefined {
    return this.memory.userPreferences[key] as T | undefined;
  }

  /** Get all preferences */
  getAllPreferences(): Record<string, unknown> {
    return { ...this.memory.userPreferences };
  }

  /** Remove a preference */
  removePreference(key: string): void {
    delete this.memory.userPreferences[key];
    this.save();
  }

  // === User Facts ===

  /** Add a fact about the user */
  addFact(fact: string): void {
    if (!this.memory.userFacts.includes(fact)) {
      this.memory.userFacts.push(fact);
      this.save();
    }
  }

  /** Get all user facts */
  getFacts(): string[] {
    return [...this.memory.userFacts];
  }

  // === Project Context ===

  /** Set or update project context */
  setProjectContext(
    projectName: string,
    context: {
      description?: string;
      techStack?: string[];
      conventions?: string[];
      architecture?: string;
      knownIssues?: string[];
    },
  ): void {
    const existing = this.memory.projectContext[projectName] ?? {
      description: '',
      techStack: [],
      conventions: [],
      architecture: '',
      knownIssues: [],
    };

    this.memory.projectContext[projectName] = {
      description: context.description ?? existing.description,
      techStack: context.techStack ?? existing.techStack,
      conventions: context.conventions ?? existing.conventions,
      architecture: context.architecture ?? existing.architecture,
      knownIssues: context.knownIssues ?? existing.knownIssues,
    };

    this.save();
  }

  /** Get project context */
  getProjectContext(projectName: string) {
    return this.memory.projectContext[projectName];
  }

  /** Get all project contexts */
  getAllProjects(): string[] {
    return Object.keys(this.memory.projectContext);
  }

  // === Learned Rules ===

  /** Learn a new rule or reinforce an existing one */
  learnRule(rule: string, source: string): void {
    const existing = this.memory.learnedRules.find((r) => r.rule === rule);

    if (existing) {
      // Reinforce: increase confidence and add source
      existing.confidence = Math.min(1.0, existing.confidence + 0.1);
      if (!existing.source.includes(source)) {
        existing.source.push(source);
      }
    } else {
      this.memory.learnedRules.push({
        rule,
        confidence: 0.5, // Start at 50% — needs repetition to solidify
        source: [source],
      });
    }

    this.save();
  }

  /** Get rules above a confidence threshold */
  getRules(minConfidence = 0.5): LearnedRule[] {
    return this.memory.learnedRules
      .filter((r) => r.confidence >= minConfidence)
      .sort((a, b) => b.confidence - a.confidence);
  }

  /** Get all rules regardless of confidence */
  getAllRules(): LearnedRule[] {
    return [...this.memory.learnedRules];
  }

  // === Glossary ===

  /** Add or update a glossary term */
  defineTerm(term: string, meaning: string): void {
    this.memory.glossary[term] = meaning;
    this.save();
  }

  /** Look up a glossary term */
  lookupTerm(term: string): string | undefined {
    return this.memory.glossary[term];
  }

  /** Get the entire glossary */
  getGlossary(): Record<string, string> {
    return { ...this.memory.glossary };
  }

  /**
   * Generate a context summary for injection into the session prompt.
   * Concise but informative — designed to fit in a system prompt prefix.
   */
  generateContextSummary(maxChars = 3000): string {
    const parts: string[] = ['[AgentOS Semantic Memory]', ''];

    // User facts
    if (this.memory.userFacts.length > 0) {
      parts.push('## About the User');
      for (const fact of this.memory.userFacts.slice(0, 5)) {
        parts.push(`- ${fact}`);
      }
      parts.push('');
    }

    // Preferences
    const prefs = Object.entries(this.memory.userPreferences);
    if (prefs.length > 0) {
      parts.push('## Preferences');
      for (const [key, value] of prefs.slice(0, 10)) {
        parts.push(`- ${key}: ${JSON.stringify(value)}`);
      }
      parts.push('');
    }

    // Project context
    const projects = Object.keys(this.memory.projectContext);
    if (projects.length > 0) {
      parts.push('## Project Context');
      for (const proj of projects.slice(0, 3)) {
        const ctx = this.memory.projectContext[proj]!;
        parts.push(`### ${proj}`);
        parts.push(`- Description: ${ctx.description}`);
        parts.push(`- Tech: ${ctx.techStack.join(', ')}`);
        if (ctx.conventions.length > 0) {
          parts.push(`- Conventions: ${ctx.conventions.slice(0, 5).join(', ')}`);
        }
        parts.push('');
      }
    }

    // Learned rules (high confidence only)
    const rules = this.getRules(0.7);
    if (rules.length > 0) {
      parts.push('## Learned Rules');
      for (const r of rules.slice(0, 5)) {
        parts.push(`- [${Math.round(r.confidence * 100)}%] ${r.rule}`);
      }
      parts.push('');
    }

    const summary = parts.join('\n');
    return summary.length > maxChars ? summary.slice(0, maxChars) + '\n...' : summary;
  }

  /** Persist to disk */
  private markDirty(): void {
    this._dirty = true;
    if (!this._saveTimer) {
      this._saveTimer = setTimeout(() => {
        this._saveTimer = null;
        if (this._dirty) {
          this.persist();
          this._dirty = false;
        }
      }, 300);
    }
  }

  /** Persist to disk */
  private persist(): void {
    if (!this.storagePath) return;

    const dir = path.dirname(this.storagePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(this.storagePath, JSON.stringify(this.memory, null, 2), 'utf-8');
  }

  private save(): void {
    this.markDirty();
  }

  /** Force immediate write to disk (for testing / shutdown) */
  flush(): void {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    if (this._dirty) {
      this.persist();
      this._dirty = false;
    }
  }

  /** Load from disk */
  private load(): void {
    try {
      if (fs.existsSync(this.storagePath!)) {
        const data = fs.readFileSync(this.storagePath!, 'utf-8');
        this.memory = JSON.parse(data);
      }
    } catch {
      // Keep defaults
    }
  }
}
