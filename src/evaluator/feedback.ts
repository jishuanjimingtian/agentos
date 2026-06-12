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
    this.globalAuditPath = path.join(agentosDir, 'audit.jsonl');
    this.load();
  }

  /** Persist the current feedbackLog and detectedKeys to disk. */
  private persist(): void {
    if (!this.persistPath) return;
    try {
      const snapshot = {
        feedbackLog: this.feedbackLog,
        detectedKeys: Array.from(this.detectedKeys),
        updatedAt: Date.now(),
      };
      fs.writeFileSync(this.persistPath, JSON.stringify(snapshot) + '\n', 'utf-8');
    } catch {
      // Non-critical, silently ignore persist failures
    }
  }

  /** Load persisted feedback log from disk. */
  private load(): void {
    if (!this.persistPath) return;
    try {
      if (!fs.existsSync(this.persistPath)) return;
      const content = fs.readFileSync(this.persistPath, 'utf-8').trim();
      if (!content) return;
      const snapshot = JSON.parse(content);
      if (Array.isArray(snapshot.feedbackLog)) {
        this.feedbackLog = snapshot.feedbackLog;
        // Remove stale signals older than 7 days to prevent unbounded growth
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
