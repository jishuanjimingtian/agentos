import {
  AgentOSConfig,
  GuardConfig,
  Snapshot,
  AuditEntry,
  PreExecMetrics,
  RuntimeMetrics,
  PostExecMetrics,
} from './types';
import { SchemaGate } from './guard/schema-gate';
import { RiskGate } from './guard/risk-gate';
import { SnapshotGate, VerifyGate } from './guard/snapshot-verify';
import { AuditLog } from './guard/audit-log';
import { WorkingMemory } from './memory/working';
import { EpisodicMemory } from './memory/episodic';
import { SemanticMemoryStore } from './memory/semantic';
import { PreExecEvaluator, RuntimeEvaluator, PostExecEvaluator } from './evaluator/exec-evaluator';
import { ImplicitFeedbackEngine } from './evaluator/feedback';
import { AgentProfiler } from './evaluator/profiler';
import type { AgentProfile } from './evaluator/profiler';

/**
 * AgentOS — the complete AI Agent Operating System.
 *
 * Architecture:
 * ```
 * User Request
 *     ↓
 * ┌─────────────┐
 * │ Memory Layer │ ← Semantic + Episodic + Working memory
 * ├─────────────┤
 * │ Guard Layer  │ ← Schema → Risk → Snapshot
 * ├─────────────┤         ↓
 * │ Execute      │ ← Tool call execution
 * ├─────────────┤         ↓
 * │ Verify Layer │ ← Snapshot diff → Verify checks
 * ├─────────────┤         ↓
 * │ Audit Log    │ ← Immutable operation record
 * ├─────────────┤
 * │ Evaluator    │ ← Three-phase metrics + feedback
 * └─────────────┘
 * ```
 */
export class AgentOS {
  private config: AgentOSConfig;

  // Memory Layer
  readonly memory: {
    working: WorkingMemory;
    episodic: EpisodicMemory;
    semantic: SemanticMemoryStore;
  };

  // Guard Layer
  readonly guard: {
    schema: SchemaGate;
    risk: RiskGate;
    snapshot: SnapshotGate;
    verify: VerifyGate;
    audit: AuditLog;
  };

  // Evaluator Layer
  readonly evaluator: {
    preExec: PreExecEvaluator;
    runtime: RuntimeEvaluator;
    postExec: PostExecEvaluator;
    feedback: ImplicitFeedbackEngine;
    profiler: AgentProfiler;
  };

  constructor(config?: Partial<AgentOSConfig>) {
    this.config = {
      workspaceRoot: process.cwd(),
      maxWorkingTokens: 50000,
      maxEpisodicSizeKb: 500,
      guardConfig: {},
      ...config,
    };

    // --- Memory Layer Init ---
    const semantic = new SemanticMemoryStore();
    semantic.enablePersistence(this.config.workspaceRoot!);

    const episodic = new EpisodicMemory(this.config.maxEpisodicSizeKb);
    episodic.enablePersistence(this.config.workspaceRoot!);

    const working = new WorkingMemory(this.config.maxWorkingTokens);

    this.memory = { working, episodic, semantic };

    // --- Guard Layer Init ---
    const schema = new SchemaGate();

    const risk = new RiskGate();

    const snapshot = new SnapshotGate(this.config.workspaceRoot!);

    const verify = new VerifyGate(this.config.workspaceRoot!);

    const audit = new AuditLog(
      this.config.workspaceRoot!,
      schema,
      risk,
    );

    this.guard = { schema, risk, snapshot, verify, audit };

    // --- Evaluator Layer Init ---
    const preExecEval = new PreExecEvaluator(schema, risk, working);
    const runtimeEval = new RuntimeEvaluator();
    const postExecEval = new PostExecEvaluator();
    const feedbackEngine = new ImplicitFeedbackEngine();
    const profiler = new AgentProfiler(feedbackEngine);

    this.evaluator = {
      preExec: preExecEval,
      runtime: runtimeEval,
      postExec: postExecEval,
      feedback: feedbackEngine,
      profiler,
    };
  }

  /**
   * Get the current AgentOS configuration.
   */
  getConfig(): Readonly<AgentOSConfig> {
    return this.config;
  }

  /**
   * Full pipeline: process a tool call through all layers.
   *
   * This is the main AgentOS orchestration method.
   * In production this would be called by the agent runtime
   * before/after every tool call.
   */
  executePipeline(options: {
    sessionId: string;
    agentId: string;
    toolName: string;
    parameters: Record<string, unknown>;
    affectedFiles?: string[];
    guardConfig?: GuardConfig;
  }): {
    preExec: PreExecMetrics;
    runtime?: RuntimeMetrics;
    postExec?: PostExecMetrics;
    snapshot: Snapshot | null;
    auditEntry?: AuditEntry;
    profile: AgentProfile;
  } {
    const { sessionId, toolName, parameters, affectedFiles } = options;

    // --- Phase 1: Pre-exec evaluation ---
    const preExec = this.evaluator.preExec.evaluate(toolName, parameters);
    this.memory.working.addMessage('tool', JSON.stringify(parameters));

    // Auto-detect if this call references a previous result
    this.detectResultUtilization(parameters, sessionId);

    // --- Phase 2: Snapshot before execution ---
    const snapshot = this.guard.snapshot.takeSnapshot(
      `call_${Date.now()}`,
      toolName,
      affectedFiles ?? [],
      'file',
    );

    // --- Phase 3: Execute (delegated to runtime — here we return pre-exec state) ---

    // Return the pre-exec state so the runtime can complete
    return {
      preExec,
      snapshot,
      profile: this.evaluator.profiler.getProfile(sessionId),
    };
  }

  /**
   * Complete the pipeline after tool execution.
   *
   * Called by the runtime after the tool call completes
   * (or fails, or times out).
   */
  completeExecution(options: {
    sessionId: string;
    agentId: string;
    toolName: string;
    toolParameters: Record<string, unknown>;
    toolResult: unknown;
    snapshot: Snapshot | null;
    startTime: number;
    endTime: number;
    retryCount: number;
    wasSelfCorrected: boolean;
    hadTimeout: boolean;
    userAccepted: boolean;
    userProvidedEdit: boolean;
    resultWasUsed: boolean;
  }): {
    runtime: RuntimeMetrics;
    postExec: PostExecMetrics;
    auditEntry: AuditEntry;
    profile: AgentProfile;
  } {
    const {
      sessionId, agentId, toolName, toolParameters, toolResult,
      snapshot, startTime, endTime,
      retryCount, wasSelfCorrected, hadTimeout,
      userAccepted, userProvidedEdit, resultWasUsed,
    } = options;

    // --- Phase 1: Runtime evaluation ---
    const runtime = this.evaluator.runtime.evaluate({
      toolName,
      startTime,
      endTime,
      retryCount,
      wasSelfCorrected,
      hadTimeout,
      toolResult,
    });

    // --- Phase 2: Post-exec verification ---
    const verifyResult = this.guard.verify.verify(
      toolName,
      snapshot!,
      { files: toolParameters['path'] ? [String(toolParameters['path'])] : undefined },
    );

    // --- Phase 3: Post-exec evaluation ---
    const postExec = this.evaluator.postExec.evaluate({
      verifyPassed: verifyResult.status === 'PASS',
      verifyChecks: verifyResult.checks.length,
      verifyFailures: verifyResult.checks.filter((c) => c.status === 'FAIL').length,
      userAccepted,
      userProvidedEdit,
      resultWasUsed,
    });

    // --- Phase 4: Audit log ---
    const auditEntry = this.guard.audit.record({
      sessionId,
      agentId,
      startedAt: startTime,
      completedAt: endTime,
      toolName,
      toolParameters,
      toolResult,
      snapshot,
      verifyStatus: verifyResult.status,
      verifyChecks: verifyResult.checks,
    });

    // --- Phase 5: Track result for utilization scoring ---
    this.evaluator.postExec.trackResult(auditEntry.id, toolResult);

    // --- Phase 6: Record in profiler (reuse pre-exec from pipeline start) ---
    const preExecMetric = this.evaluator.preExec.evaluate(toolName, toolParameters);
    this.evaluator.profiler.recordCycle(
      sessionId,
      preExecMetric,
      runtime,
      postExec,
    );

    return {
      runtime,
      postExec,
      auditEntry,
      profile: this.evaluator.profiler.getProfile(sessionId),
    };
  }

  /**
   * Record implicit user feedback.
   */
  recordFeedback(
    signal: Parameters<ImplicitFeedbackEngine['record']>[0],
    sessionId: string,
    operationId?: string,
    confidence?: number,
    source?: string,
  ): void {
    this.evaluator.feedback.record(signal, sessionId, operationId, confidence, source);
  }

  /**
   * Get a JSON report for dashboard consumption.
   */
  getReport(): Record<string, unknown> {
    const profile = this.getProfile();
    const audit = this.getAuditStats();
    return {
      quality: { overallScore: Math.round(profile.overallScore), ...profile.breakdown },
      audit: { ...audit },
      satisfaction: profile.breakdown.userSatisfaction || 0,
      workingMemory: { messages: this.memory.working.getState().recentMessages.length },
      episodicEvents: this.memory.episodic.count || 0,
      warnings: profile.warnings,
      strengths: profile.strengths,
    };
  }

  /**
   * Inject memory context at session startup.
   *
   * Call this at the beginning of every session to load
   * semantic + episodic context into the session prompt.
   */
  injectContext(): string {
    const semanticSummary = this.memory.semantic.generateContextSummary(2000);
    const episodicSummary = this.memory.episodic.generateContextSummary(1500);

    const parts: string[] = [];

    if (semanticSummary) parts.push(semanticSummary);
    if (episodicSummary) parts.push(episodicSummary);

    return parts.join('\n\n---\n\n');
  }

  /**
   * End current session — auto-detect feedback, promote events to episodic,
   * append daily log, clear working memory.
   */
  endSession(sessionId: string, workspaceRoot?: string): void {
    // Phase 1: Auto-detect feedback from audit log
    const recentAudit = this.guard.audit.query({ sessionId, limit: 100 });
    const detected = this.evaluator.feedback.autoDetect(recentAudit, sessionId);

    // Phase 2: Promote important working memory items to episodic
    if (this.memory.working.currentTask) {
      this.memory.episodic.record(
        'milestone',
        `Task completed: ${this.memory.working.currentTask.description}`,
        ['task', 'session-end'],
        [sessionId],
      );
    }

    // Phase 3: Log learned rules from this session
    const rules = this.memory.semantic.getRules(0.6);
    for (const rule of rules.slice(0, 3)) {
      this.memory.episodic.record(
        'note',
        `Rule: ${rule.rule} (confidence: ${Math.round(rule.confidence * 100)}%)`,
        ['rule', 'semantic'],
        [],
      );
    }

    // Phase 4: Record session end event with stats
    const profile = this.evaluator.profiler.getProfile(sessionId);
    const auditStats = this.guard.audit.stats();
    this.memory.episodic.record(
      'note',
      `Session ended — Score: ${profile.overallScore}/100 | Ops: ${auditStats.totalOperations} | Feedback signals detected: ${detected}`,
      ['session-end', 'summary'],
      [sessionId],
    );

    // Phase 5: Append daily log if workspaceRoot provided
    if (workspaceRoot) {
      this.appendDailyLog(sessionId, workspaceRoot);
    }

    // Phase 5: Decay unused semantic rules
    this.memory.semantic.decayUnusedRules();

    // Phase 6: Clear working memory for next session
    this.memory.working.clear();
  }

  /**
   * Append evaluation summary to daily log file.
   */
  private appendDailyLog(sessionId: string, workspaceRoot: string): void {
    try {
      const { appendFileSync, existsSync, mkdirSync } = require('fs');
      const path = require('path');
      const dateKey = new Date().toISOString().split('T')[0];
      const memDir = path.join(workspaceRoot, 'memory');
      if (!existsSync(memDir)) mkdirSync(memDir, { recursive: true });

      const dailyFile = path.join(memDir, `${dateKey}.md`);
      const profile = this.evaluator.profiler.getProfile(sessionId);
      const auditStats = this.guard.audit.stats();
      const satisfaction = this.evaluator.feedback.getSatisfactionScore(sessionId);

      const report = [
        '',
        '## 📊 AgentOS Evaluator 今日评估',
        '',
        `**综合评分**: ${profile.overallScore}/100 | Pre:${profile.breakdown.preExec ?? 'N/A'}/100 | Run:${profile.breakdown.runtime ?? 'N/A'}/100 | Post:${profile.breakdown.postExec ?? 'N/A'}/100`,
        `**趋势**: ${profile.trends.improving ? '📈 上升' : '📉 下降'} | **操作数**: ${auditStats.totalOperations} | **满意度**: ${satisfaction}`,
        profile.warnings.length > 0 ? `**⚠️**: ${profile.warnings.join('; ')}` : '',
        profile.strengths.length > 0 ? `**✅**: ${profile.strengths.join('; ')}` : '',
        '',
      ].filter(Boolean).join('\n');

      const existing = existsSync(dailyFile) ? require('fs').readFileSync(dailyFile, 'utf-8') : '';
      if (!existing.includes('AgentOS Evaluator')) {
        appendFileSync(dailyFile, report, 'utf-8');
      }
    } catch (e) {
      console.warn('[AgentOS] Failed to append daily log:', e);
    }
  }

  /**
   * Detect if this tool call's parameters reference a previous result.
   */
  private detectResultUtilization(params: Record<string, unknown>, sessionId: string): void {
    try {
      const allValues = Object.values(params).join(' ');
      const tracker = this.evaluator.postExec['resultReferenceTracker'];
      if (!tracker) return;

      for (const [opId, entry] of tracker) {
        if (entry.referenced) continue;
        const resultStr = JSON.stringify(entry.result);
        // Check if parameters contain a reference to previous result
        if (resultStr.length > 10 && allValues.includes(resultStr.substring(0, 20))) {
          this.evaluator.postExec.markResultReferenced(opId);
          this.evaluator.feedback.record('user_used_result', sessionId, opId, 0.5, 'auto-param-match');
        }
      }
    } catch {
      // Non-critical, silently ignore detection failures
    }
  }

  /**
   * Get audit statistics.
   */
  getAuditStats(): ReturnType<AuditLog['stats']> {
    return this.guard.audit.stats();
  }

  /**
   * Get the current agent quality profile.
   */
  getProfile(sessionId?: string): AgentProfile {
    return this.evaluator.profiler.getProfile(sessionId);
  }

  /**
   * Get a summarized status report.
   */
  statusReport(): string {
    const profile = this.getProfile();
    const audit = this.getAuditStats();

    const lines = [
      '=== AgentOS Status Report ===',
      '',
      `Quality Score: ${Math.round(profile.overallScore)}/100 ${profile.trends.improving ? '📈' : '📉'}`,
      `Total Operations: ${profile.totalOps} (${profile.trends.recentOps} in last 24h)`,
      '',
      '--- Breakdown ---',
      `Pre-Exec:   ${profile.breakdown.preExec}/100`,
      `Runtime:    ${profile.breakdown.runtime}/100`,
      `Post-Exec:  ${profile.breakdown.postExec}/100`,
      `Satisfaction: ${profile.breakdown.userSatisfaction}/100`,
      '',
      '--- Audit ---',
      `Total: ${audit.totalOperations} | Failures: ${audit.verifyFailures} | High-Risk: ${audit.highRiskOps}`,
    ];

    if (profile.warnings.length > 0) {
      lines.push('', '--- ⚠️ Warnings ---');
      for (const w of profile.warnings) lines.push(`- ${w}`);
    }

    if (profile.strengths.length > 0) {
      lines.push('', '--- ✅ Strengths ---');
      for (const s of profile.strengths) lines.push(`- ${s}`);
    }

    return lines.join('\n');
  }
}
