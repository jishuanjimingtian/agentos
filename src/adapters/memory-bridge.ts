/**
 * Memory Bridge — 将 AgentOS Memory 三层接入 OpenClaw 工作流
 *
 * ┌─────────────┐     ┌──────────────┐     ┌──────────────┐
 * │  MEMORY.md   │ →   │  Semantic    │ ←   │ 会话中学习   │
 * │  旧文件系统   │     │  Memory      │     │ 新规则/偏好   │
 * └─────────────┘     └──────┬───────┘     └──────────────┘
 *                            │
 *     ┌──────────────────────┼──────────────────────┐
 *     │                      │                      │
 *     ▼                      ▼                      ▼
 *  Session启动          Session运行             Session结束
 *  注入上下文            工具结果缓存            事件→Episodic
 *                      消息→Working             偏好→Semantic
 *
 * 用法:
 *   1. Session 启动: MemoryBridge.onSessionStart(workspaceRoot)
 *      → 返回要注入的上下文字符串
 *   2. Session 中:   MemoryBridge.getWorkingMemory()
 *      → 获取 Working Memory 实例
 *   3. Session 结束: MemoryBridge.onSessionEnd()
 *      → 清空 Working、同步 Episodic
 */

import { WorkingMemory } from '../memory/working';
import { EpisodicMemory } from '../memory/episodic';
import { SemanticMemoryStore } from '../memory/semantic';
import { EventType } from '../types';
import * as fs from 'fs';

export interface MemorySnapshot {
  semantic: Record<string, unknown>;
  episodic: Record<string, unknown>;
  working: Record<string, unknown>;
}

export class MemoryBridge {
  private working: WorkingMemory;
  private episodic: EpisodicMemory;
  private semantic: SemanticMemoryStore;
  private started = false;
  private startTime: number;

  constructor(workspaceRoot: string) {
    this.working = new WorkingMemory(50000);
    this.episodic = new EpisodicMemory(500);
    this.semantic = new SemanticMemoryStore();
    this.startTime = Date.now();

    // 持久化到 .agentos/ 目录
    this.episodic.enablePersistence(workspaceRoot);
    this.semantic.enablePersistence(workspaceRoot);
  }

  /**
   * Session 启动时调用
   * 返回要注入到系统提示的上下文摘要
   */
  onSessionStart(): string {
    this.started = true;
    this.startTime = Date.now();

    const parts: string[] = [];

    // 1. Semantic Memory 上下文（替代 MEMORY.md）
    const semanticCtx = this.semantic.generateContextSummary();
    if (semanticCtx) {
      parts.push(semanticCtx);
    }

    // 2. Episodic Memory 上下文（最近7天+高重要性事件）
    const episodicCtx = this.episodic.generateContextSummary();
    if (episodicCtx) {
      parts.push(episodicCtx);
    }

    return parts.join('\n\n---\n\n');
  }

  /**
   * Session 运行中：记录一条消息到 Working Memory
   */
  recordMessage(role: 'user' | 'agent' | 'tool', content: string): void {
    this.working.addMessage(role, content);
  }

  /**
   * Session 运行中：缓存工具调用结果
   */
  cacheToolResult(toolName: string, result: unknown): void {
    this.working.cacheToolResult(toolName, result);
  }

  /**
   * Session 结束：清空 Working + 同步到 Episodic
   *
   * @param autoRecord 是否自动从 Working 提取事件到 Episodic
   */
  onSessionEnd(autoRecord = true): void {
    if (!this.started) return;

    if (autoRecord) {
      this.autoRecordFromWorking();
    }

    this.episodic.record('note', `Session ended`, ['session'], [], 0);
    this.working.clear();
    this.started = false;
  }

  /**
   * 记录自定义事件到 Episodic Memory
   */
  recordEvent(
    type: EventType,
    content: string,
    tags: string[] = [],
    relatedEntities: string[] = [],
    importanceBoost = 0,
  ): void {
    this.episodic.record(type, content, tags, relatedEntities, importanceBoost);
  }

  // === Semantic Memory 快捷方法 ===

  /** 学习新规则 */
  learnRule(rule: string, source: string): void {
    this.semantic.learnRule(rule, source);
  }

  /** 设置用户偏好 */
  setPreference(key: string, value: unknown): void {
    this.semantic.setPreference(key, value);
  }

  /** 添加用户事实 */
  addFact(fact: string): void {
    this.semantic.addFact(fact);
  }

  /** 更新项目上下文 */
  setProjectContext(
    name: string,
    ctx: {
      description?: string;
      techStack?: string[];
      conventions?: string[];
      architecture?: string;
      knownIssues?: string[];
    },
  ): void {
    this.semantic.setProjectContext(name, ctx);
  }

  /** 获取项目上下文 */
  getProjectContext(name: string) {
    return this.semantic.getProjectContext(name);
  }

  // === 查询方法 ===

  /** 获取完整记忆状态快照 */
  getSnapshot(): MemorySnapshot {
    return {
      semantic: this.semantic.getMemory() as unknown as Record<string, unknown>,
      episodic: { events: this.episodic.getAll(), count: this.episodic.count },
      working: this.working.getState() as unknown as Record<string, unknown>,
    };
  }

  /** 获取 Working Memory 实例（供中间件使用） */
  getWorkingMemory(): WorkingMemory {
    return this.working;
  }

  /** 获取 Semantic Memory 实例 */
  getSemanticMemory(): SemanticMemoryStore {
    return this.semantic;
  }

  /** 获取 Episodic Memory 实例 */
  getEpisodicMemory(): EpisodicMemory {
    return this.episodic;
  }

  /** 获取 session 持续时间（ms） */
  getElapsedMs(): number {
    return Date.now() - this.startTime;
  }

  // === 私有方法 ===

  /**
   * 从 Working Memory 自动提取关键事件到 Episodic
   */
  private autoRecordFromWorking(): void {
    const state = this.working.getState();

    // 记录消息数
    if (state.recentMessages.length > 0) {
      const userMsgs = state.recentMessages.filter((m) => m.role === 'user').length;
      const agentMsgs = state.recentMessages.filter((m) => m.role === 'agent').length;
      this.episodic.record(
        'note',
        `Session: ${userMsgs} user msgs, ${agentMsgs} agent responses`,
        ['session', 'messages'],
        [],
        0,
      );
    }

    // 记录工具调用
    if (state.recentToolResults.size > 0) {
      const toolNames = Array.from(state.recentToolResults.keys());
      this.episodic.record(
        'tool_call',
        `Tools used: ${toolNames.join(', ')}`,
        ['tools', ...toolNames],
        [],
        0,
      );
    }
  }

  /** 刷新所有持久化（确保写入磁盘） */
  flush(): void {
    this.semantic.flush();
  }

  /** 生成状态报告 */
  statusReport(): string {
    const snapshot = this.getSnapshot();
    const sessionMinutes = Math.round(this.getElapsedMs() / 60000);

    return [
      '═══ AgentOS Memory Bridge ═══',
      `⏱  Session: ${sessionMinutes} min`,
      `🧠 Working: ${(snapshot.working as Record<string, unknown>).recentMessages ? (snapshot.working as Record<string, unknown>).recentMessages?.toString().length : 0} messages`,
      `📖 Episodic: ${this.episodic.count} events`,
      `💎 Semantic: ${Object.keys(this.semantic.getMemory().userPreferences || {}).length} prefs, ${this.semantic.getMemory().userFacts.length} facts`,
      '══════════════════════════════',
    ].join('\n');
  }

  // === 迁移 ===

  /**
   * 从现有的 MEMORY.md 文件迁移数据到 Semantic Memory
   * 只运行一次，迁移后旧文件可以保留或删除
   */
  migrateFromMemoryMd(memoryPath: string): { imported: number; skipped: number } {
    const result = { imported: 0, skipped: 0 };

    if (!fs.existsSync(memoryPath)) {
      console.warn('MEMORY.md not found at', memoryPath);
      return result;
    }

    // 简单解析 MEMORY.md 的 Markdown 结构
    const content = fs.readFileSync(memoryPath, 'utf-8');
    const lines = content.split('\n');

    let currentSection = '';
    const sections: Record<string, string[]> = {};

    for (const line of lines) {
      if (line.startsWith('## ')) {
        currentSection = line.replace('## ', '').trim();
        sections[currentSection] = [];
      } else if (currentSection && line.trim().startsWith('- ')) {
        sections[currentSection]?.push(line.trim().replace(/^-\s*/, ''));
      }
    }

    // 导入项目上下文
    const coderevSection = sections['📦 核心项目：coderev'] || sections['📦 coderev'] || [];
    if (coderevSection.length > 0) {
      this.semantic.setProjectContext('coderev', {
        description: 'AI 驱动的代码审查 CLI 工具',
        techStack: ['TypeScript', 'Node.js', 'CLI'],
        conventions: coderevSection.slice(0, 5),
      });
      result.imported++;
    }

    const agentosSection = sections['📦 Sentinel AgentOS'] || sections['AgentOS'] || [];
    if (agentosSection.length > 0 || sections['Sentinel AgentOS（项目 #2）']) {
      this.semantic.setProjectContext('agentos', {
        description: 'AI Agent 操作系统 — 确定性 Guard + 分层记忆 + 自动评估',
        techStack: ['TypeScript', 'Node.js', 'Jest'],
      });
      result.imported++;
    }

    // 导入用户事实
    if (sections['👤 关于老板']) {
      for (const fact of sections['👤 关于老板']) {
        this.semantic.addFact(fact);
        result.imported++;
      }
    }

    if (sections['🆔 关于我']) {
      for (const fact of sections['🆔 关于我']) {
        this.semantic.addFact(fact);
        result.imported++;
      }
    }

    // 导入工作方式中的规则
    const workwaySection = sections['🤖 我的工作方式'] || [];
    for (const rule of workwaySection) {
      this.semantic.learnRule(rule, 'MEMORY.md migration');
      result.imported++;
    }

    // 导入环境记录
    if (sections['💻 环境记录']) {
      for (const env of sections['💻 环境记录']) {
        this.semantic.addFact(env);
        result.imported++;
      }
    }

    // 导入关键决策
    const decisionsSection = sections['💡 关键决策记录'] || [];
    if (decisionsSection.length > 0) {
      for (const decision of decisionsSection) {
        this.episodic.record('decision', decision, ['memigration'], []);
        result.imported++;
      }
    }

    this.semantic.flush();
    return result;
  }
}

// ============= Singleton =============
let _bridge: MemoryBridge | null = null;

/** 获取全局 MemoryBridge 实例 */
export function getMemoryBridge(workspaceRoot?: string): MemoryBridge {
  if (!_bridge && workspaceRoot) {
    _bridge = new MemoryBridge(workspaceRoot);
  }
  if (!_bridge) {
    throw new Error('MemoryBridge not initialized. Call getMemoryBridge(workspaceRoot) first.');
  }
  return _bridge;
}

/** 重置全局实例（用于测试） */
export function resetMemoryBridge(): void {
  if (_bridge) {
    _bridge.flush();
    _bridge = null;
  }
}
