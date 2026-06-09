# AgentOS

> Deterministic Guard Layer + Layered Memory + Automated Evaluation for any AI Agent

## What is AgentOS?

AgentOS is **not an Agent**. It's an **operating system for agents** — providing guardrails, memory, and evaluation as infrastructure that any agent framework can use.

| Module | Purpose |
|--------|---------|
| **Guard** | Schema validation, risk scoring, audit logging (zero LLM dependency) |
| **Memory** | Working → Episodic → Semantic three-layer memory architecture |
| **Evaluator** | Pre-exec / Runtime / Post-exec automated quality assessment |

## Install

```bash
npm install @agentos/core
```

## Quick Start

```typescript
import { AgentOS } from '@agentos/core';

const aos = new AgentOS({
  guard: {
    schemaGate: true,
    riskGate: { autoApprove: 0.5, deny: 8.0 },
  },
  memory: {
    working: { maxTokens: 50000 },
    episodic: { maxSizeKb: 500 },
    semantic: { enabled: true },
  },
});

// Wrap any tool call with Guard protection
const result = await aos.guard.execute(
  'write_file',
  { path: 'src/main.ts', content: 'console.log("hello")' }
);
```

## License

MIT
