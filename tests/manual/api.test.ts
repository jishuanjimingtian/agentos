/**
 * API SDK tests — ts-jest compiled from source
 */
import { AgentOSAPI } from '../../src/api';
import { AgentOS } from '../../src/core';

describe('AgentOSAPI', () => {
  let api: AgentOSAPI;
  let aos: AgentOS;

  beforeEach(() => { aos = new AgentOS(); api = new AgentOSAPI(aos); });

  it('should register a rule', () => {
    api.guardRegisterRule({ toolName: 't', rule: 'r', validate: () => ({ pass: true }) });
    expect(api.guardHasRule('t')).toBe(true);
  });

  it('should register multiple rules', () => {
    api.guardRegisterRules([
      { toolName: 'a', rule: '1', validate: () => ({ pass: true }) },
      { toolName: 'b', rule: '2', validate: () => ({ pass: true }) },
    ]);
    expect(api.guardGetRules().length).toBe(2);
  });

  it('should evaluate risk', () => {
    const r = api.guardEvaluateRisk('exec', { command: 'npm test' });
    expect(typeof r.score).toBe('number');
    expect(typeof r.action).toBe('string');
  });

  it('should set risk thresholds', () => {
    expect(() => api.guardSetRiskThresholds({ autoApprove: 30, confirm: 70 })).not.toThrow();
  });

  it('should set preference', () => {
    api.memorySetPreference('theme', 'dark');
    const ctx = api.memoryInjectContext();
    expect(ctx).toContain('theme');
  });

  it('should add fact', () => {
    api.memoryAddFact('coffee lover', 0.7);
    const ctx = api.memoryInjectContext();
    expect(ctx).toContain('coffee');
  });

  it('should query audit', () => {
    const a = api.auditQuery({ limit: 5 });
    expect(Array.isArray(a)).toBe(true);
  });

  it('should get profile', () => {
    const p = api.profileGet();
    expect(p).toBeDefined();
    expect(typeof p.overallScore).toBe('number');
  });

  it('should record feedback', () => {
    api.recordFeedback('user_used_result', 's1');
    const p = api.profileGet('s1');
    expect(p).toBeDefined();
  });

  it('should handle unknown rule gracefully', () => {
    expect(api.guardHasRule('nonexistent')).toBe(false);
  });
});
