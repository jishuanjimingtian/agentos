import { AgentOS } from '../src';

describe('AgentOS', () => {
  it('should initialize with config', () => {
    const aos = new AgentOS({
      guard: {
        schemaGate: true,
        riskGate: {
          autoApprove: 0.5,
          notify: 1.0,
          confirm: 3.0,
          deny: 8.0,
        },
      },
      memory: {
        working: { maxTokens: 50000 },
        episodic: { maxSizeKb: 500 },
        semantic: { enabled: true },
      },
    });

    expect(aos.getConfig().guard.schemaGate).toBe(true);
    expect(aos.getConfig().guard.riskGate.deny).toBe(8.0);
    expect(aos.getConfig().memory.working.maxTokens).toBe(50000);
  });

  it('should return readonly config', () => {
    const aos = new AgentOS({
      guard: {
        schemaGate: false,
        riskGate: { autoApprove: 0, notify: 0, confirm: 0, deny: 0 },
      },
      memory: {
        working: { maxTokens: 10000 },
        episodic: { maxSizeKb: 100 },
        semantic: { enabled: false },
      },
    });

    const config = aos.getConfig();
    expect(config.memory.semantic.enabled).toBe(false);
  });
});
