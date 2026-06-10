import { RiskAction, RiskScore } from '../types';

/**
 * Impact level — how broadly the operation affects the system.
 */
export type ImpactLevel = 'local' | 'workspace' | 'project' | 'system';

const IMPACT_VALUES: Record<ImpactLevel, number> = {
  local: 1,
  workspace: 3,
  project: 6,
  system: 10,
};

/**
 * Sensitivity level — how sensitive the data involved is.
 */
export type SensitivityLevel = 'none' | 'low' | 'medium' | 'high' | 'critical';

const SENSITIVITY_VALUES: Record<SensitivityLevel, number> = {
  none: 0.0,
  low: 0.3,
  medium: 0.6,
  high: 0.9,
  critical: 1.0,
};

/**
 * Default error rates by tool category (cold start).
 */
const DEFAULT_ERROR_RATES: Record<string, number> = {
  read: 0.01,
  write: 0.05,
  delete: 0.10,
  network: 0.08,
  compute: 0.02,
};

/**
 * Tool-level risk profile — users define this per tool.
 */
export interface ToolRiskProfile {
  /** Tool name to match */
  tool: string;
  /** Impact level of this tool */
  impact: ImpactLevel;
  /** How reversible the operation is (0 = irreversible, 1 = fully reversible) */
  reversibility: number;
  /** Sensitivity of data this tool accesses */
  sensitivity: SensitivityLevel;
  /** Tool category for default error rate */
  category?: 'read' | 'write' | 'delete' | 'network' | 'compute';
  /** Optional override for initial error rate (skips category default) */
  initialErrorRate?: number;
}

/**
 * Tool call statistics for dynamic error-rate tracking.
 */
interface ToolStats {
  totalCalls: number;
  failures: number;
  errorRate: number;
  lastUpdated: number;
}

/**
 * Threshold configuration for risk-based actions.
 */
export interface RiskThresholds {
  /** Score ≤ autoApprove → execute immediately */
  autoApprove: number;
  /** Score ≤ notify → execute but notify user */
  notify: number;
  /** Score ≤ confirm → pause and ask for user confirmation */
  confirm: number;
  /** Score > deny → block entirely */
  deny: number;
}

/**
 * Default thresholds — conservative but workable.
 */
export const DEFAULT_RISK_THRESHOLDS: RiskThresholds = {
  autoApprove: 0.5,
  notify: 1.0,
  confirm: 3.0,
  deny: 8.0,
};

/**
 * Risk Gate — deterministic, pure-math risk scoring.
 *
 * Formula: RiskScore = Impact × (1 - Reversibility) × Sensitivity × (1 + ErrorRate)
 *
 * Zero LLM dependency. The formula, thresholds, and mappings are all
 * explicit and auditable.
 */
export class RiskGate {
  private profiles: Map<string, ToolRiskProfile> = new Map();
  private stats: Map<string, ToolStats> = new Map();
  private thresholds: RiskThresholds;

  constructor(thresholds: RiskThresholds = DEFAULT_RISK_THRESHOLDS) {
    this.thresholds = thresholds;
  }

  /** Register a risk profile for a tool */
  registerProfile(profile: ToolRiskProfile): void {
    this.profiles.set(profile.tool, profile);
    // Initialize stats if not already tracked
    if (!this.stats.has(profile.tool)) {
      const errorRate: number =
        profile.initialErrorRate ??
        (profile.category ? (DEFAULT_ERROR_RATES[profile.category] ?? 0.05) : 0.05);
      this.stats.set(profile.tool, {
        totalCalls: 0,
        failures: 0,
        errorRate,
        lastUpdated: Date.now(),
      });
    }
  }

  /** Register multiple profiles at once */
  registerProfiles(profiles: ToolRiskProfile[]): void {
    profiles.forEach((p) => this.registerProfile(p));
  }

  /** Get all registered profiles */
  getProfiles(): ToolRiskProfile[] {
    return Array.from(this.profiles.values());
  }

  /** Check if a tool has a registered profile */
  hasProfile(tool: string): boolean {
    return this.profiles.has(tool);
  }

  /**
   * Compute the risk score for a tool call.
   *
   * If no profile is registered, returns a default moderate-risk score
   * (auto-approve with notification).
   */
  evaluate(tool: string, _params?: Record<string, unknown>): RiskScore {
    const profile = this.profiles.get(tool);

    // Fallback for unregistered tools — moderate risk, allow but notify
    if (!profile) {
      const fallbackScore = this.thresholds.autoApprove + 0.1;
      return {
        score: fallbackScore,
        action: 'auto',
        dimensions: {
          impact: 1,
          reversibility: 1,
          sensitivity: 0,
          errorRate: 0,
        },
      };
    }

    const impact = IMPACT_VALUES[profile.impact];
    const reversibility = Math.min(1, Math.max(0, profile.reversibility));
    const sensitivity = SENSITIVITY_VALUES[profile.sensitivity];
    const stats = this.stats.get(profile.tool);
    const errorRate = stats?.errorRate ?? 0.05;

    const score =
      impact * (1 - reversibility) * sensitivity * (1 + errorRate);

    const action = this.scoreToAction(score);

    return {
      score: Math.round(score * 100) / 100, // round to 2 decimal places
      action,
      dimensions: {
        impact,
        reversibility,
        sensitivity,
        errorRate: Math.round(errorRate * 1000) / 1000,
      },
    };
  }

  /** Record the outcome of a tool call to update stats */
  recordOutcome(tool: string, success: boolean): void {
    const stats = this.stats.get(tool);
    if (!stats) return;

    stats.totalCalls++;
    if (!success) stats.failures++;
    stats.errorRate =
      stats.totalCalls > 0 ? stats.failures / stats.totalCalls : 0;
    stats.lastUpdated = Date.now();
  }

  /** Get tool statistics */
  getStats(tool: string): ToolStats | undefined {
    return this.stats.get(tool);
  }

  /** Get all tool statistics */
  getAllStats(): Map<string, ToolStats> {
    return new Map(this.stats);
  }

  /** Update thresholds at runtime */
  setThresholds(thresholds: Partial<RiskThresholds>): void {
    this.thresholds = { ...this.thresholds, ...thresholds };
  }

  /** Get current thresholds */
  getThresholds(): RiskThresholds {
    return { ...this.thresholds };
  }

  /**
   * Map a numeric risk score to the appropriate action.
   */
  private scoreToAction(score: number): RiskAction {
    if (score <= this.thresholds.autoApprove) return 'auto';
    if (score <= this.thresholds.notify) return 'notify';
    if (score <= this.thresholds.confirm) return 'confirm';
    return 'deny';
  }
}
