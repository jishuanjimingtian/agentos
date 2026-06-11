/**
 * Evaluation Bridge — Evaluator 三阶段评估接入 OpenClaw
 *
 * 职责：在每个 tool call 的 preCheck/postCheck 中自动采集指标，
 *      累积到 Profiler，定期生成质量报告注入 daily log。
 *
 * 数据流：
 *   Guard preCheck → PreExecEvaluator → 参数质量+上下文利用评分
 *   tool 执行     → RuntimeEvaluator → 重试/超时/自纠正评分
 *   Guard postCheck → PostExecEvaluator → 验证通过/用户接受评分
 *   ↓
 *   AgentProfiler → 综合评分(0-100) + 趋势 + 警告/亮点
 *   ↓
 *   ImplicitFeedback → 从 audit log 推断用户满意度
 */

import { SchemaGate } from '../guard/schema-gate';
import { RiskGate } from '../guard/risk-gate';
import { WorkingMemory } from '../memory/working';
import { PreExecEvaluator } from '../evaluator/exec-evaluator';
import { RuntimeEvaluator } from '../evaluator/exec-evaluator';
import { PostExecEvaluator } from '../evaluator/exec-evaluator';
import { AgentProfiler, AgentProfile } from '../evaluator/profiler';
import { ImplicitFeedbackEngine } from '../evaluator/feedback';
import * as fs from 'fs';
import * as path from 'path';

export class EvaluationBridge {
  private schemaGate: SchemaGate;
  private riskGate: RiskGate;
  private working: WorkingMemory;
  private preEvaluator: PreExecEvaluator;
  private runtimeEvaluator: RuntimeEvaluator;
  private postEvaluator: PostExecEvaluator;
  private feedback: ImplicitFeedbackEngine;
  private profiler: AgentProfiler;
  private sessionId: string;

  // 待完成的评估周期（pre 已记录，等待 post）
  private pending: Map<string, { preMetric: any; startTime: number; toolName: string }> = new Map();

  constructor(working: WorkingMemory, sessionId?: string) {
    this.schemaGate = new SchemaGate();
    this.riskGate = new RiskGate();
    this.working = working;
    this.preEvaluator = new PreExecEvaluator(this.schemaGate, this.riskGate, this.working);
    this.runtimeEvaluator = new RuntimeEvaluator();
    this.postEvaluator = new PostExecEvaluator();
    this.feedback = new ImplicitFeedbackEngine();
    this.profiler = new AgentProfiler(this.feedback);
    this.sessionId = sessionId || `eval_${Date.now()}`;
  }

  // ============== 生命周期 ==============

  /** tool 执行前：采集 PreExec 指标，返回操作 ID */
  preExec(toolName: string, params: Record<string, unknown>): string {
    const opId = `op_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const preMetric = this.preEvaluator.evaluate(toolName, params);

    this.pending.set(opId, {
      preMetric,
      startTime: Date.now(),
      toolName,
    });

    return opId;
  }

  /** tool 执行后：采集 Runtime + PostExec 指标，计入 Profiler */
  postExec(opId: string, options: {
    hadTimeout?: boolean;
    retryCount?: number;
    wasSelfCorrected?: boolean;
    verifyPassed?: boolean;
    verifyChecks?: number;
    verifyFailures?: number;
    result?: unknown;
  } = {}): void {
    const entry = this.pending.get(opId);
    if (!entry) return;

    const endTime = Date.now();
    const { preMetric, startTime, toolName } = entry;
    this.pending.delete(opId);

    // Runtime 评估
    const runtime = this.runtimeEvaluator.evaluate({
      toolName,
      startTime,
      endTime,
      retryCount: options.retryCount ?? 0,
      wasSelfCorrected: options.wasSelfCorrected ?? false,
      hadTimeout: options.hadTimeout ?? false,
      toolResult: options.result,
    });

    // Post 评估
    const post = this.postEvaluator.evaluate({
      verifyPassed: options.verifyPassed ?? true,
      verifyChecks: options.verifyChecks ?? 1,
      verifyFailures: options.verifyFailures ?? 0,
      userAccepted: true, // 默认 true，feedback 会修正
      userProvidedEdit: false,
      resultWasUsed: false,
    });

    // 追踪结果（后续 detected usage）
    if (options.result !== undefined) {
      this.postEvaluator.trackResult(opId, options.result);
    }

    // 入 Profiler
    this.profiler.recordCycle(this.sessionId, preMetric, runtime, post);
  }

  // ============== Feedback ==============

  /** 记录隐式反馈信号 */
  recordFeedback(signal: string, confidence?: number): void {
    const validSignals = [
      'user_deleted_code', 'user_modified_output', 'user_repeated_instruction',
      'user_immediate_continue', 'user_used_result', 'user_silence_then_praise',
      'user_interrupted', 'agent_self_corrected', 'user_explicit_approval',
      'user_shared_output', 'user_provided_correction', 'user_ignored_result',
    ];

    if (!validSignals.includes(signal)) {
      console.warn(`[Evaluator] Unknown signal: ${signal}`);
      return;
    }

    this.feedback.record(signal as any, this.sessionId, undefined, confidence ?? 0.8);
  }

  // ============== 查询 ==============

  /** 获取综合质量画像 */
  getProfile(): AgentProfile {
    return this.profiler.getProfile(this.sessionId);
  }

  /** 获取满意度分数 */
  getSatisfaction(): number {
    return this.feedback.getSatisfactionScore(this.sessionId);
  }

  /** 获取反馈统计 */
  getFeedbackStats() {
    return this.feedback.stats();
  }

  /** 获取工具准确率 */
  getToolAccuracy() {
    return this.runtimeEvaluator.getToolAccuracy();
  }

  /** 获取结果利用率 */
  getUtilizationRate(): number {
    return this.postEvaluator.getUtilizationRate();
  }

  /** 获取本次会话的操作数 */
  getOperationCount(): number {
    return this.pending.size + (this.getProfile().totalOps || 0);
  }

  // ============== 报告生成 ==============

  /** 生成人类可读的评估报告 */
  generateReport(): string {
    const profile = this.getProfile();
    const feedbackStats = this.getFeedbackStats();
    const toolAcc = this.getToolAccuracy();
    const satisfaction = this.getSatisfaction();

    const lines: string[] = [
      '═══ 📊 AgentOS Evaluator 报告 ═══',
      '',
      `🎯 综合评分: ${profile.overallScore}/100`,
      '',
      '📈 分项评分:',
      `  ├─ 参数质量:   ${profile.breakdown.preExec}/100`,
      `  ├─ 执行质量:   ${profile.breakdown.runtime}/100`,
      `  ├─ 结果验证:   ${profile.breakdown.postExec}/100`,
      `  └─ 用户满意度: ${profile.breakdown.userSatisfaction}/100`,
      '',
      `📊 趋势: ${profile.trends.improving ? '📈 上升' : '📉 下降'} (最近${profile.trends.recentOps}次: ${Math.round(profile.trends.recentScore)}/100)`,
      '',
    ];

    if (profile.strengths.length > 0) {
      lines.push('✅ 亮点:');
      for (const s of profile.strengths) lines.push(`  · ${s}`);
      lines.push('');
    }

    if (profile.warnings.length > 0) {
      lines.push('⚠️ 需改进:');
      for (const w of profile.warnings) lines.push(`  · ${w}`);
      lines.push('');
    }

    lines.push(`💬 反馈: ${feedbackStats.totalSignals} 信号 (${feedbackStats.positiveSignals}正 / ${feedbackStats.negativeSignals}负)`);
    lines.push(`🛠 工具准确率: ${Object.entries(toolAcc).map(([t,v]) => `${t}:${v.successRate}`).join(', ')}`);
    lines.push(`📐 满意度: ${satisfaction}`);
    lines.push('');
    lines.push('══════════════════════════════');

    return lines.join('\n');
  }

  /** 生成精简版报告（注入 daily log） */
  generateCompactReport(): string {
    const profile = this.getProfile();

    return [
      `## 📊 AgentOS Evaluator 今日评估`,
      '',
      `**综合评分**: ${profile.overallScore}/100 | Pre:${profile.breakdown.preExec}/100 | Run:${profile.breakdown.runtime}/100 | Post:${profile.breakdown.postExec}/100`,
      `**趋势**: ${profile.trends.improving ? '📈 上升' : '📉 下降'} | **操作数**: ${profile.totalOps}`,
      profile.warnings.length > 0 ? `**⚠️**: ${profile.warnings.join('; ')}` : '',
      profile.strengths.length > 0 ? `**✅**: ${profile.strengths.join('; ')}` : '',
      '',
    ].filter(Boolean).join('\n');
  }

  /** 追加报告到 daily log */
  appendToDailyLog(workspaceRoot: string): void {
    const dateKey = new Date().toISOString().split('T')[0];
    const dailyFile = path.join(workspaceRoot, 'memory', `${dateKey}.md`);
    const report = this.generateCompactReport();

    try {
      const existing = fs.existsSync(dailyFile) ? fs.readFileSync(dailyFile, 'utf-8') : '';
      if (!existing.includes('AgentOS Evaluator')) {
        fs.appendFileSync(dailyFile, `\n${report}\n`, 'utf-8');
      }
    } catch (e) {
      console.warn('[Evaluator] Failed to append report:', e);
    }
  }

  // ============== 持久化 ==============

  /** 导出可序列化的状态 */
  exportState(): object {
    return {
      sessionId: this.sessionId,
      profile: this.getProfile(),
      feedback: this.getFeedbackStats(),
      toolAccuracy: this.getToolAccuracy(),
      utilizationRate: this.getUtilizationRate(),
      exportedAt: new Date().toISOString(),
    };
  }

  /** 导入之前的状态（用于恢复） */
  importState(state: any): void {
    if (state.sessionId) this.sessionId = state.sessionId;
    // Profiler/Feedback 不支持完整恢复，只恢复 sessionId
  }
}

// ============== Singleton ==============
let _evalBridge: EvaluationBridge | null = null;

export function getEvaluationBridge(working?: WorkingMemory, sessionId?: string): EvaluationBridge {
  if (!_evalBridge) {
    if (!working) throw new Error('First call requires WorkingMemory instance');
    _evalBridge = new EvaluationBridge(working, sessionId);
  }
  return _evalBridge;
}

export function resetEvaluationBridge(): void {
  _evalBridge = null;
}
