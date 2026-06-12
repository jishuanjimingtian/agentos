import { AuditEntry, VerifyStatus, Snapshot, VerifyCheck } from '../types';
import { SnapshotGate } from './snapshot-verify';
import { RiskGate } from './risk-gate';
import { SchemaGate } from './schema-gate';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

function generateAuditId(): string {
  return `audit_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

export class AuditLog {
  private logPath: string;
  private schemaGate: SchemaGate;
  private riskGate: RiskGate;
  private snapshotGate: SnapshotGate;
  // In-memory entries + session index for fast lookups
  private entries: AuditEntry[] = [];
  private sessionIndex: Map<string, AuditEntry[]> = new Map();

  constructor(
    workspaceRoot: string,
    schemaGate: SchemaGate,
    riskGate: RiskGate,
  ) {
    this.logPath = path.join(workspaceRoot, '.agentos', 'audit.jsonl');
    this.schemaGate = schemaGate;
    this.riskGate = riskGate;
    this.snapshotGate = new SnapshotGate(workspaceRoot);
    this.loadFromDisk();
  }

  record(options: {
    sessionId: string;
    agentId: string;
    startedAt: number;
    completedAt: number;
    toolName: string;
    toolParameters: Record<string, unknown>;
    toolResult: unknown;
    snapshot: Snapshot | null;
    verifyStatus: VerifyStatus;
    verifyChecks: VerifyCheck[];
  }): AuditEntry {
    const entry: AuditEntry = {
      id: generateAuditId(),
      sessionId: options.sessionId,
      agentId: options.agentId,
      startedAt: options.startedAt,
      completedAt: options.completedAt,
      durationMs: options.completedAt - options.startedAt,
      toolName: options.toolName,
      toolParameters: this.sanitizeParams(options.toolParameters),
      toolResult: this.truncateResult(options.toolResult),
      schemaGate: this.schemaGate.check(options.toolName, options.toolParameters),
      riskGate: this.riskGate.evaluate(options.toolName, options.toolParameters),
      snapshot: options.snapshot,
      verifyGate: {
        status: options.verifyStatus,
        checks: options.verifyChecks,
      },
      diff: options.snapshot
        ? this.snapshotGate.computeDiff(options.snapshot)
        : null,
    };

    this.append(entry);
    return entry;
  }

  query(filter: {
    sessionId?: string;
    toolName?: string;
    verifyStatus?: VerifyStatus;
    minScore?: number;
    maxScore?: number;
    limit?: number;
  } = {}): AuditEntry[] {
    // Use session index for session-only queries (O(1) lookup)
    let results: AuditEntry[];
    if (filter.sessionId && !filter.toolName && !filter.verifyStatus &&
        filter.minScore === undefined && filter.maxScore === undefined) {
      results = this.sessionIndex.get(filter.sessionId) ?? [];
    } else {
      // Fall back to full scan with filters
      results = this.entries;
      if (filter.sessionId) {
        results = results.filter((e) => e.sessionId === filter.sessionId);
      }
      if (filter.toolName) {
        results = results.filter((e) => e.toolName === filter.toolName!);
      }
      if (filter.verifyStatus) {
        results = results.filter((e) => e.verifyGate.status === filter.verifyStatus);
      }
      if (filter.minScore !== undefined) {
        results = results.filter((e) => e.riskGate.score >= filter.minScore!);
      }
      if (filter.maxScore !== undefined) {
        results = results.filter((e) => e.riskGate.score <= filter.maxScore!);
      }
    }

    const limit = filter.limit ?? 100;
    return results.slice(-limit);
  }

  stats(): {
    totalOperations: number;
    byTool: Record<string, number>;
    averageRiskScore: number;
    verifyFailures: number;
    sessionsTracked: number;
    highRiskOps: number;
  } {
    const entries = this.entries;

    const byTool: Record<string, number> = {};
    let totalScore = 0;
    let verifyFailures = 0;
    let highRiskOps = 0;
    const sessions = new Set<string>();

    for (const entry of entries) {
      byTool[entry.toolName] = (byTool[entry.toolName] || 0) + 1;
      totalScore += entry.riskGate?.score ?? 0;
      if (entry.verifyGate?.status === 'FAIL') verifyFailures++;
      if ((entry.riskGate?.score ?? 0) > 3.0) highRiskOps++;
      sessions.add(entry.sessionId);
    }

    return {
      totalOperations: entries.length,
      byTool,
      averageRiskScore: entries.length > 0
        ? Math.round((totalScore / entries.length) * 100) / 100
        : 0,
      verifyFailures,
      sessionsTracked: sessions.size,
      highRiskOps,
    };
  }

  private sanitizeParams(params: Record<string, unknown>): Record<string, unknown> {
    const sensitive = ['token', 'password', 'secret', 'key', 'api_key', 'auth'];
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(params)) {
      if (sensitive.some((s) => key.toLowerCase().includes(s))) {
        sanitized[key] = '***REDACTED***';
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  private truncateResult(result: unknown, maxChars = 5000): unknown {
    const str = typeof result === 'string'
      ? result
      : JSON.stringify(result);

    if (str.length > maxChars) {
      return str.slice(0, maxChars) + `... [truncated ${str.length - maxChars} chars]`;
    }

    return result;
  }

  private append(entry: AuditEntry): void {
    // Update in-memory index
    this.entries.push(entry);
    const sessionEntries = this.sessionIndex.get(entry.sessionId) ?? [];
    sessionEntries.push(entry);
    this.sessionIndex.set(entry.sessionId, sessionEntries);

    const dir = path.dirname(this.logPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(this.logPath, line, 'utf-8');
  }

  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(this.logPath)) return;
      const content = fs.readFileSync(this.logPath, 'utf-8');
      const lines = content.split('\n').filter((l) => l.trim());
      const entries = lines.map((l) => JSON.parse(l)) as AuditEntry[];
      for (const e of entries) {
        this.entries.push(e);
        const se = this.sessionIndex.get(e.sessionId) ?? [];
        se.push(e);
        this.sessionIndex.set(e.sessionId, se);
      }
    } catch {
      // Keep empty state
    }
  }

  /** Get raw entries count (for debugging) */
  get size(): number {
    return this.entries.length;
  }
}
