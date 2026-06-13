import { ImplicitFeedback, SignalType } from '../types';
import { AuditEntry } from '../types';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Generate a unique feedback ID.
 */
function generateFeedbackId(): string {
  return `fb_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * ImplicitFeedbackEngine — captures and interprets implicit user signals.
 *
 * Instead of relying on explicit "thumbs up/down", this engine
 * detects subtle signals from user behavior to infer satisfaction.
 *
 * Two modes:
 * - Manual: caller provides explicit signals via record()
 * - Auto-detect: scans audit log to infer signals (results unused,
 *   results modified later, repeated same tool, verify failures)
 *
 * This is the key differentiator of AgentOS: it learns from
 * what users DO, not just what they SAY.
 */
export class ImplicitFeedbackEngine {
  private feedbackLog: ImplicitFeedback[] = [];
  private persistPath: string | null = null;
  // Global audit log for cross-session auto-detection
  private globalAuditPath: string | null = null;
  // Track which auto-detected signals we've already logged (dedup key)
  private detectedKeys: Set<string> = new Set();
  // Caps for unbounded growth
  private static readonly MAX_FEEDBACK = 300;
  private static readonly MAX_DETECTED_KEYS = 500;
  // Persist as append-only JSONL (one line per record) instead of full snapshot rewrite
  private persistLinePath: string | null = null;

  /**
   * Record an implicit feedback signal.
   */
  record(
    signal: SignalType,
    sessionId: string,
    operationId?: string,
    confidence = 0.8,
    source = 'auto-detected',
  ): ImplicitFeedback {
    const strength = this.getSignalStrength(signal);

    const feedback: ImplicitFeedback = {
      id: generateFeedbackId(),
      timestamp: Date.now(),
      signal,
      strength,
      confidence,
      sessionId,
      operationId,
      source,
    };

    this.feedbackLog.push(feedback);
    // Trim oldest to prevent unbounded growth
    while (this.feedbackLog.length > ImplicitFeedbackEngine.MAX_FEEDBACK) this.feedbackLog.shift();
    // Keep detectedKeys within bounds
    if (this.detectedKeys.size > ImplicitFeedbackEngine.MAX_DETECTED_KEYS) {
      const iter = this.detectedKeys.values();
      for (let i = 0; i < 100; i++) { const n = iter.next(); if (n.done) break; this.detectedKeys.delete(n.value); }
    }
    this.persist();
    return feedback;
  }

  // ══════════════════════════════════
  //  Auto-detect feedback from audit log
  // ══════════════════════════════════

  /**
   * Scan the audit log and auto-detect implicit feedback signals.
   *
   * Detection rules (conservative — low confidence to avoid false positives):
   * - verify FAIL or WARN → user_provided_correction (agent made mistakes)
   * - same tool+params called within 60s → user_repeated_instruction (low confidence, noisy)
   * - high risk operations that were retried and eventually passed → agent_self_corrected
   *
   * Note: auto-detected signals carry lower confidence than explicit user feedback.
   * They serve as supplementary data, not primary quality indicators.
   *
   * @param entries Recent audit entries to analyze
   * @param sessionId Session to attribute signals to
   * @returns Number of signals auto-detected
   */
  /**
   * Enable persistence for feedbackLog and auto-detected signal keys.
   */
  enablePersistence(workspaceRoot: string): void {
    const agentosDir = path.join(workspaceRoot, '.agentos');
    if (!fs.existsSync(agentosDir)) {
      fs.mkdirSync(agentosDir, { recursive: true });
    }
    this.persistPath = path.join(agentosDir, 'feedback.jsonl');
    this.persistLinePath = path.join(agentosDir, 'feedback-lines.jsonl');
    this.globalAuditPath = path.join(agentosDir, 'audit.jsonl');
    this.load();
  }

  /** Persist: append one line to feedback-lines.jsonl. */
  private _writeCount = 0;
  private persist(): void {
    if (!this.persistLinePath) return;
    try {
      const last = this.feedbackLog[this.feedbackLog.length - 1];
      if (!last) return;
      const line = JSON.stringify(last) + '\n';
      fs.appendFileSync(this.persistLinePath, line, 'utf-8');
      this._writeCount++;
      // Every 50 writes, compact the file to keep only last 200 lines
      if (this._writeCount >= 50) {
        this._writeCount = 0;
        this.compactFeedbackFile();
      }
    } catch { /* non-critical */ }
  }

  /** Compact feedback-lines.jsonl: keep last 200 lines only. */
  private compactFeedbackFile(): void {
    if (!this.persistLinePath) return;
    try {
      if (!fs.existsSync(this.persistLinePath)) return;
      const all = fs.readFileSync(this.persistLinePath, 'utf-8').trim();
      if (!all) return;
      const lines = all.split('\n').filter(Boolean);
      if (lines.length <= 200) return;
      const recent = lines.slice(-200);
      fs.writeFileSync(this.persistLinePath, recent.join('\n') + '\n', 'utf-8');
    } catch { /* non-critical */ }
  }

  /** Load persisted feedback log from disk. */
  private load(): void {
    if (!this.persistPath) return;
    try {
      // Prefer new line-based format
      if (this.persistLinePath && fs.existsSync(this.persistLinePath)) {
        const content = fs.readFileSync(this.persistLinePath, 'utf-8').trim();
        if (content) {
          const lines = content.split('\n').filter(Boolean);
          const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
          this.feedbackLog = lines
            .map((l) => { try { return JSON.parse(l); } catch { return null; } })
            .filter((f): f is ImplicitFeedback => f !== null && f.timestamp >= cutoff)
            .slice(-ImplicitFeedbackEngine.MAX_FEEDBACK);
          return;
        }
      }
      // Fallback: old snapshot format
      if (!fs.existsSync(this.persistPath)) return;
      const content = fs.readFileSync(this.persistPath, 'utf-8').trim();
      if (!content) return;
      const snapshot = JSON.parse(content);
      if (Array.isArray(snapshot.feedbackLog)) {
        this.feedbackLog = snapshot.feedbackLog;
        const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
        this.feedbackLog = this.feedbackLog.filter((f) => f.timestamp >= cutoff);
      }
      if (Array.isArray(snapshot.detectedKeys)) {
        this.detectedKeys = new Set(snapshot.detectedKeys);
      }
    } catch {
      // Corrupt file — start fresh
    }
  }

  /**
   * Cross-session auto-detect: scan the global audit.jsonl for signals
   * from ALL sessions, not just the current one.
   */
  autoDetectGlobal(): number {
    if (!this.globalAuditPath) return 0;
    try {
      if (!fs.existsSync(this.globalAuditPath)) return 0;
      const content = fs.readFileSync(this.globalAuditPath, 'utf-8');
      const lines = content.split('\n').filter((l) => l.trim());
      const entries: AuditEntry[] = lines.map((l) => JSON.parse(l));
      return this.autoDetect(entries, '__global__');
    } catch {
      return 0;
    }
  }

  autoDetect(entries: AuditEntry[], sessionId: string): number {
    let detected = 0;

    // Rule 1: Verify failures → agent made errors (confidence 0.7)
    for (const entry of entries) {
      if (entry.verifyGate.status !== 'PASS') {
        const dedupKey = `verify-fail:${entry.id}`;
        if (!this.detectedKeys.has(dedupKey)) {
          this.detectedKeys.add(dedupKey);
          this.record(
            'user_provided_correction',
            sessionId,
            entry.id,
            0.7,
            'auto-audit-verify',
          );
          detected++;
        }
      }
    }

    // Rule 2: Repeated same tool call within 60s → user had to repeat
    // Low confidence (0.3) because some tools (read, exec) are legitimately called multiple times
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const ei = entries[i];
        const ej = entries[j];
        if (!ei || !ej) continue;
        if (ei.toolName === ej.toolName &&
            JSON.stringify(ei.toolParameters) === JSON.stringify(ej.toolParameters) &&
            Math.abs(ei.completedAt - ej.startedAt) < 60_000) {
          const dedupKey = `repeat:${ei.id}:${ej.id}`;
          if (!this.detectedKeys.has(dedupKey)) {
            this.detectedKeys.add(dedupKey);
            this.record(
              'user_repeated_instruction',
              sessionId,
              ej.id,
              0.3,
              'auto-audit-repeat',
            );
            detected++;
          }
          break;
        }
      }
    }

    // Rule 3: Agent self-corrected — only when retry eventually succeeded
    // (NOT "high risk passed" — that's coincidence, not demonstrated skill)
    // Detected by: same tool+params failed once, then passed later in the same session
    const failures = new Set<string>();
    for (const entry of entries) {
      if (entry.verifyGate.status !== 'PASS') {
        failures.add(JSON.stringify({ t: entry.toolName, p: entry.toolParameters }));
      }
    }
    for (const entry of entries) {
      const key = JSON.stringify({ t: entry.toolName, p: entry.toolParameters });
      if (entry.verifyGate.status === 'PASS' && failures.has(key)) {
        const dedupKey = `self-corrected:${entry.id}`;
        if (!this.detectedKeys.has(dedupKey)) {
          this.detectedKeys.add(dedupKey);
          this.record(
            'agent_self_corrected',
            sessionId,
            entry.id,
            0.5,
            'auto-audit-self-corrected',
          );
          detected++;
        }
        failures.delete(key); // one signal per correction
      }
    }

    return detected;
  }

  // ══════════════════════════════════
  //  User message analysis — detect correction signals from text
  // ══════════════════════════════════

  /**
   * Analyze user messages to detect implicit correction/feedback signals.
   *
   * Chinese corrective patterns (high precision, low recall — only matches clear signals):
   * - "不对"/"错了"/"不是这样" → user_provided_correction (confidence 0.8)
   * - "漏了"/"缺了"/"没包括"/"遗漏" → user_provided_correction (confidence 0.75)
   * - "你没"/"你怎么"/"你咋" + 负面动作(忘记/漏/没/不) → user_provided_correction (confidence 0.7)
   * - "失忆"/"忘了"/"不记得" → user_provided_correction (confidence 0.85)
   * - "重新"/"再查"/"再搜"/"再看看" → user_repeated_instruction (confidence 0.6)
   * - "不对吧"/"没音信" → user_interrupted (confidence 0.5)
   *
   * English patterns:
   * - "wrong"/"incorrect"/"not right" → user_provided_correction (confidence 0.7)
   * - "missed"/"missing"/"forgot"/"incomplete" → user_provided_correction (confidence 0.7)
   * - "redo"/"again"/"retry"/"try again" → user_repeated_instruction (confidence 0.5)
   *
   * Returns number of signals detected.
   */
  detectFromUserMessages(messages: Array<{ role: string; content: string; ts?: number }>, sessionId: string): number {
    let detected = 0;
    const userMessages = messages.filter((m) => m.role === 'user');

    for (const msg of userMessages) {
      const text = msg.content.toLowerCase();
      const dedupKey = `msg:${msg.ts ?? Date.now()}:${msg.content.substring(0, 40)}`;
      if (this.detectedKeys.has(dedupKey)) continue;

      // ── Chinese correction patterns ──

      // Strong frustration: "失忆"/"忘了"/"不记得"
      if (/失忆|忘了|(?:怎么|咋).{0,3}(?:忘|漏|没|不记得)/.test(msg.content)) {
        this.detectedKeys.add(dedupKey);
        this.record('user_provided_correction', sessionId, undefined, 0.85, 'auto-msg-correction-strong');
        detected++;
        continue;
      }

      // Direct negation: "不对"/"错了"/"不是这样" (not followed by "吗"/"吧" question)
      if (/(?:不对|错了|不是这样)(?:[吗吧]|的[吗吧])?$/.test(msg.content) ||
          /^(?:不对|错了|不是)！/.test(msg.content)) {
        this.detectedKeys.add(dedupKey);
        this.record('user_provided_correction', sessionId, undefined, 0.8, 'auto-msg-correction-direct');
        detected++;
        continue;
      }

      // Omission: "漏了"/"缺了"/"没包括"/"遗漏"
      if (/漏了|缺了|没包括|遗漏|没统计|没算|少.了/.test(msg.content)) {
        this.detectedKeys.add(dedupKey);
        this.record('user_provided_correction', sessionId, undefined, 0.75, 'auto-msg-correction-omission');
        detected++;
        continue;
      }

      // Agent capability complaint: "你没"/"你怎么"/"你咋" + negative
      if (/(?:你没|你怎么|你咋)(?:.{0,5})(?:听|做|查|看|写|记|算|说|回答|汇总|总结)/.test(msg.content)) {
        this.detectedKeys.add(dedupKey);
        this.record('user_provided_correction', sessionId, undefined, 0.7, 'auto-msg-correction-agent');
        detected++;
        continue;
      }

      // Repeat request: "重新"/"再查"/"再搜"/"再看看"/"再汇总"
      if (/重新.{0,3}(?:做|查|搜|看|写|汇总|弄|搞|来)|再.{0,2}(?:查|搜|看|汇总|弄|搞|试)/.test(msg.content)) {
        this.detectedKeys.add(dedupKey);
        this.record('user_repeated_instruction', sessionId, undefined, 0.6, 'auto-msg-repeat-request');
        detected++;
        continue;
      }

      // Mild interruption: "没音信"/"不对吧"
      if (/没音信|不对吧/.test(msg.content)) {
        this.detectedKeys.add(dedupKey);
        this.record('user_interrupted', sessionId, undefined, 0.5, 'auto-msg-interrupt');
        detected++;
        continue;
      }

      // ── English patterns ──

      // Strong negation
      if (/(?:that.?s|this is|you.?re|you are).{0,5}(?:wrong|incorrect|not right|not correct)/.test(text)) {
        this.detectedKeys.add(dedupKey);
        this.record('user_provided_correction', sessionId, undefined, 0.7, 'auto-msg-correction-en');
        detected++;
        continue;
      }

      // Omission
      if (/(?:missed|missing|forgot|forgotten|incomplete|left out|didn.?t include)/.test(text)) {
        this.detectedKeys.add(dedupKey);
        this.record('user_provided_correction', sessionId, undefined, 0.7, 'auto-msg-omission-en');
        detected++;
        continue;
      }

      // Repeat
      if (/(?:redo|do it again|try again|retry)/.test(text)) {
        this.detectedKeys.add(dedupKey);
        this.record('user_repeated_instruction', sessionId, undefined, 0.5, 'auto-msg-repeat-en');
        detected++;
      }
    }

    return detected;
  }

  // ══════════════════════════════════

  private getSignalStrength(signal: SignalType): number {
    switch (signal) {
      case 'user_deleted_code': return -0.8;
      case 'user_interrupted': return -0.6;
      case 'user_provided_correction': return -0.7;
      case 'user_modified_output': return -0.5;
      case 'user_repeated_instruction': return -0.15;
      case 'user_ignored_result': return -0.4;
      case 'user_silence_then_praise': return 0.2;
      case 'user_immediate_continue': return 0.3;
      case 'agent_self_corrected': return 0.3;
      case 'user_explicit_approval': return 0.6;
      case 'user_used_result': return 0.7;
      case 'user_shared_output': return 0.8;
      default: return 0;
    }
  }

  getSatisfactionScore(sessionId?: string, recentHours = 24): number {
    // If feedbackLog is empty, try auto-detecting from global audit log first
    if (this.feedbackLog.length === 0 && this.globalAuditPath) {
      this.autoDetectGlobal();
    }

    let relevant = this.feedbackLog;

    if (sessionId) {
      relevant = relevant.filter((f) => f.sessionId === sessionId);
    }

    const cutoff = Date.now() - recentHours * 60 * 60 * 1000;
    relevant = relevant.filter((f) => f.timestamp >= cutoff);

    // No signals: return neutral 0 (maps to 50/100 satisfaction) instead of 0
    if (relevant.length === 0) return 0;

    let weightedSum = 0;
    let totalWeight = 0;

    for (const fb of relevant) {
      const ageHours = (Date.now() - fb.timestamp) / (60 * 60 * 1000);
      const recencyWeight = Math.max(0.1, 1 - ageHours / recentHours);
      // Auto-detected signals get 0.5x weight discount to avoid polluting stats
      const sourceWeight = fb.source.startsWith('auto-') ? 0.5 : 1.0;
      const weight = fb.confidence * recencyWeight * sourceWeight;
      weightedSum += fb.strength * weight;
      totalWeight += weight;
    }

    return totalWeight > 0
      ? Math.round((weightedSum / totalWeight) * 100) / 100
      : 0;
  }

  query(filter: {
    signal?: SignalType;
    sessionId?: string;
    minStrength?: number;
    maxStrength?: number;
    since?: number;
    limit?: number;
  } = {}): ImplicitFeedback[] {
    let results = this.feedbackLog;

    if (filter.signal) results = results.filter((f) => f.signal === filter.signal);
    if (filter.sessionId) results = results.filter((f) => f.sessionId === filter.sessionId);
    if (filter.minStrength !== undefined) results = results.filter((f) => f.strength >= filter.minStrength!);
    if (filter.maxStrength !== undefined) results = results.filter((f) => f.strength <= filter.maxStrength!);
    if (filter.since !== undefined) results = results.filter((f) => f.timestamp >= filter.since!);

    results.sort((a, b) => b.timestamp - a.timestamp);
    return results.slice(0, filter.limit ?? 50);
  }

  stats(): {
    totalSignals: number;
    positiveSignals: number;
    negativeSignals: number;
    averageStrength: number;
    mostCommonSignal: SignalType | null;
  } {
    const positive = this.feedbackLog.filter((f) => f.strength > 0);
    const negative = this.feedbackLog.filter((f) => f.strength < 0);
    const avgStrength = this.feedbackLog.length > 0
      ? this.feedbackLog.reduce((s, f) => s + f.strength, 0) / this.feedbackLog.length
      : 0;

    const counts = new Map<SignalType, number>();
    for (const fb of this.feedbackLog) counts.set(fb.signal, (counts.get(fb.signal) || 0) + 1);
    let mostCommon: SignalType | null = null;
    let maxCount = 0;
    for (const [sig, count] of counts) {
      if (count > maxCount) { maxCount = count; mostCommon = sig; }
    }

    return {
      totalSignals: this.feedbackLog.length,
      positiveSignals: positive.length,
      negativeSignals: negative.length,
      averageStrength: Math.round(avgStrength * 100) / 100,
      mostCommonSignal: mostCommon,
    };
  }
}
