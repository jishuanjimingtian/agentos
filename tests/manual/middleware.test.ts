/**
 * Middleware / Plugin tests — ts-jest compiled from source
 */
import { sentinelPlugin, OpenClawPlugin } from '../../src/middleware/openclaw';

describe('sentinelPlugin', () => {
  let plugin: OpenClawPlugin;

  beforeAll(() => { plugin = sentinelPlugin(); });

  it('should create plugin with wrapped agent', () => {
    expect(plugin).toBeDefined();
    expect(plugin.wrapped).toBeDefined();
  });

  it('should call onBeforeTool for safe command', () => {
    const r = plugin.onBeforeTool('exec', { command: 'npm test' });
    expect(typeof r.allowed).toBe('boolean');
    expect(typeof r.riskScore).toBe('number');
  });

  it('should call onBeforeTool for dangerous command', () => {
    const r = plugin.onBeforeTool('exec', { command: 'rm -rf /' });
    expect(r.riskScore).toBeGreaterThan(0);
  });

  it('should call onAfterTool', () => {
    const r = plugin.onAfterTool('exec', { command: 'ls' }, 'ok', Date.now() - 100);
    expect(r.auditId).toBeDefined();
    expect(typeof r.verifyPassed).toBe('boolean');
  });

  it('should get quality report', () => {
    const report = plugin.getQualityReport();
    expect(typeof report.overallScore).toBe('number');
  });

  it('should inject memory context', () => {
    plugin.wrapped.learnRule('lint before commit', 'test');
    const ctx = plugin.injectMemoryContext();
    expect(typeof ctx).toBe('string');
  });

  it('should reset profile', () => {
    plugin.resetProfile();
    const r = plugin.getQualityReport();
    expect(r.totalOps).toBe(0);
  });

  it('should create with custom workspace', () => {
    const p2 = sentinelPlugin({ workspaceRoot: '/tmp/t' });
    expect(p2).toBeDefined();
  });
});
