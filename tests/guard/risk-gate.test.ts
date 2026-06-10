import {
  RiskGate,
  DEFAULT_RISK_THRESHOLDS,
} from '../../src/guard/risk-gate';

describe('RiskGate', () => {
  // --- Registration ---

  it('should register a risk profile', () => {
    const gate = new RiskGate();
    gate.registerProfile({
      tool: 'read_file',
      impact: 'local',
      reversibility: 1.0,
      sensitivity: 'none',
      category: 'read',
    });
    expect(gate.hasProfile('read_file')).toBe(true);
  });

  it('should register multiple profiles', () => {
    const gate = new RiskGate();
    gate.registerProfiles([
      { tool: 'read_file', impact: 'local', reversibility: 1.0, sensitivity: 'none', category: 'read' },
      { tool: 'write_file', impact: 'workspace', reversibility: 0.8, sensitivity: 'low', category: 'write' },
    ]);
    expect(gate.getProfiles()).toHaveLength(2);
  });

  // --- Default thresholds ---

  it('should use default thresholds', () => {
    const gate = new RiskGate();
    expect(gate.getThresholds()).toEqual(DEFAULT_RISK_THRESHOLDS);
  });

  it('should accept custom thresholds', () => {
    const gate = new RiskGate({ autoApprove: 1, notify: 2, confirm: 5, deny: 10 });
    expect(gate.getThresholds().autoApprove).toBe(1);
  });

  it('should update thresholds at runtime', () => {
    const gate = new RiskGate();
    gate.setThresholds({ autoApprove: 0.8 });
    expect(gate.getThresholds().autoApprove).toBe(0.8);
    // Other thresholds unchanged
    expect(gate.getThresholds().deny).toBe(8.0);
  });

  // --- Risk evaluation: registered tools ---

  it('should auto-approve safe read operations', () => {
    const gate = new RiskGate();
    gate.registerProfile({
      tool: 'read_file',
      impact: 'local',
      reversibility: 1.0,
      sensitivity: 'none',
      category: 'read',
    });
    const result = gate.evaluate('read_file');
    // Score = 1 * (1-1) * 0 * (1+0.01) = 0
    expect(result.score).toBe(0);
    expect(result.action).toBe('auto');
  });

  it('should auto-approve web_search', () => {
    const gate = new RiskGate();
    gate.registerProfile({
      tool: 'web_search',
      impact: 'local',
      reversibility: 1.0,
      sensitivity: 'low',
      category: 'network',
    });
    const result = gate.evaluate('web_search');
    // Score = 1 * (1-1) * 0.3 * (1+0.08) = 0
    expect(result.score).toBe(0);
    expect(result.action).toBe('auto');
  });

  it('should flag write_file with low score', () => {
    const gate = new RiskGate();
    gate.registerProfile({
      tool: 'write_file',
      impact: 'workspace',
      reversibility: 0.8,
      sensitivity: 'low',
      category: 'write',
    });
    const result = gate.evaluate('write_file');
    // Score = 3 * (1-0.8) * 0.3 * (1+0.05) = 3 * 0.2 * 0.3 * 1.05 = 0.189
    expect(result.action).toBe('auto');
    expect(result.score).toBeLessThan(DEFAULT_RISK_THRESHOLDS.autoApprove);
  });

  it('should notify for git_push', () => {
    const gate = new RiskGate();
    gate.registerProfile({
      tool: 'git_push',
      impact: 'project',
      reversibility: 0.5,
      sensitivity: 'low',
      category: 'write',
    });
    const result = gate.evaluate('git_push');
    // Score = 6 * (1-0.5) * 0.3 * (1+0.05) = 6 * 0.5 * 0.3 * 1.05 = 0.945
    expect(result.score).toBe(0.95);
    expect(result.action).toBe('notify');
  });

  it('should confirm for npm_publish', () => {
    const gate = new RiskGate();
    gate.registerProfile({
      tool: 'npm_publish',
      impact: 'system',
      reversibility: 0.2,
      sensitivity: 'medium',
      category: 'write',
    });
    const result = gate.evaluate('npm_publish');
    // Score = 10 * (1-0.2) * 0.6 * (1+0.05) = 10 * 0.8 * 0.6 * 1.05 = 5.04
    expect(result.score).toBe(5.04);
    expect(result.action).toBe('deny');
  });

  it('should deny shell_rm_rf', () => {
    const gate = new RiskGate();
    gate.registerProfile({
      tool: 'shell_rm_rf',
      impact: 'system',
      reversibility: 0.0,
      sensitivity: 'high',
      category: 'delete',
    });
    const result = gate.evaluate('shell_rm_rf');
    // Score = 10 * (1-0) * 0.9 * (1+0.10) = 10 * 1 * 0.9 * 1.10 = 9.9
    expect(result.action).toBe('deny');
    expect(result.score).toBeGreaterThan(DEFAULT_RISK_THRESHOLDS.deny);
  });

  it('should deny delete_prod_db', () => {
    const gate = new RiskGate();
    gate.registerProfile({
      tool: 'delete_prod_db',
      impact: 'system',
      reversibility: 0.0,
      sensitivity: 'critical',
      category: 'delete',
    });
    const result = gate.evaluate('delete_prod_db');
    // Score = 10 * 1 * 1.0 * 1.10 = 11.0
    expect(result.score).toBe(11.0);
    expect(result.action).toBe('deny');
  });

  it('should handle delete_dir with confirm action', () => {
    const gate = new RiskGate();
    gate.registerProfile({
      tool: 'delete_dir',
      impact: 'project',
      reversibility: 0.2,
      sensitivity: 'medium',
      category: 'delete',
    });
    const result = gate.evaluate('delete_dir');
    // Score = 6 * 0.8 * 0.6 * 1.10 = 3.168
    expect(result.score).toBe(3.17);
    expect(result.action).toBe('deny'); // > 3.0 confirm, so deny (with defaults)
  });

  // --- Fallback for unregistered tools ---

  it('should return fallback score for unregistered tools', () => {
    const gate = new RiskGate();
    const result = gate.evaluate('unknown_tool');
    expect(result.action).toBe('auto');
    expect(result.score).toBeGreaterThan(DEFAULT_RISK_THRESHOLDS.autoApprove);
  });

  // --- Stats tracking ---

  it('should track success and update error rate', () => {
    const gate = new RiskGate();
    gate.registerProfile({
      tool: 'test_tool',
      impact: 'workspace',
      reversibility: 0.8,
      sensitivity: 'low',
      category: 'write',
    });
    // Record 1 failure out of 2 calls → errorRate = 0.5
    gate.recordOutcome('test_tool', true);
    gate.recordOutcome('test_tool', false);
    const stats = gate.getStats('test_tool');
    expect(stats).toBeDefined();
    expect(stats!.totalCalls).toBe(2);
    expect(stats!.failures).toBe(1);
    expect(stats!.errorRate).toBe(0.5);
  });

  it('should not break recording outcome for unregistered tools', () => {
    const gate = new RiskGate();
    expect(() => gate.recordOutcome('nonexistent', true)).not.toThrow();
  });

  it('should increase risk score as error rate grows', () => {
    const gate = new RiskGate();
    gate.registerProfile({
      tool: 'risky_tool',
      impact: 'project',
      reversibility: 0.5,
      sensitivity: 'medium',
      category: 'write',
    });

    const before = gate.evaluate('risky_tool');
    // Simulate many failures
    for (let i = 0; i < 10; i++) {
      gate.recordOutcome('risky_tool', false);
    }
    const after = gate.evaluate('risky_tool');
    expect(after.score).toBeGreaterThan(before.score);
  });

  it('should allow initialErrorRate override', () => {
    const gate = new RiskGate();
    gate.registerProfile({
      tool: 'custom_error',
      impact: 'workspace',
      reversibility: 0.8,
      sensitivity: 'low',
      initialErrorRate: 0.5,
    });
    const result = gate.evaluate('custom_error');
    // Score = 3 * 0.2 * 0.3 * 1.50 = 0.27
    expect(result.dimensions.errorRate).toBe(0.5);
  });

  // --- Dimension exposure ---

  it('should expose all risk dimensions', () => {
    const gate = new RiskGate();
    gate.registerProfile({
      tool: 'dim_check',
      impact: 'local',
      reversibility: 0.8,
      sensitivity: 'low',
      category: 'read',
    });
    const result = gate.evaluate('dim_check');
    expect(result.dimensions.impact).toBe(1);
    expect(result.dimensions.reversibility).toBe(0.8);
    expect(result.dimensions.sensitivity).toBe(0.3);
    expect(typeof result.dimensions.errorRate).toBe('number');
  });

  // --- getAllStats ---

  it('should return all stats', () => {
    const gate = new RiskGate();
    gate.registerProfile({ tool: 'a', impact: 'local', reversibility: 1, sensitivity: 'none', category: 'read' });
    gate.registerProfile({ tool: 'b', impact: 'local', reversibility: 1, sensitivity: 'none', category: 'read' });
    const all = gate.getAllStats();
    expect(all.size).toBe(2);
  });
});
