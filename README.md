# AgentOS — AI Agent 操作系统 · AI Agent Operating System

> **确定性 Guard 层 + 分层记忆 + 自动评估，让任何 Agent 变得可靠、可审计、可改进。**
> *Deterministic Guard Layer + Layered Memory + Automated Evaluation — making any Agent reliable, auditable, and self-improving.*

[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/tests-99%2F99-brightgreen)](https://github.com/jishuanjimingtian/agentos/actions)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

---

## 🤔 为什么需要 AgentOS · Why AgentOS

AI Agent 面临五大核心问题，现有框架都没能真正解决。
*AI Agents face five critical problems that no existing framework truly solves.*

| 痛点 · Pain | 现状 · Status Quo | AgentOS 方案 · Solution |
|------|------|-------------|
| 🔴 **幻觉导致错误操作** · *Hallucinated operations* | Prompt 里说"不要删文件"——这是愿望，不是约束 · *"Please don't delete files" — that's a wish, not a constraint* | Guard 层确定性校验，不依赖 LLM 判断 · *Deterministic Guard checks, zero LLM dependency* |
| 🔴 **越权/危险操作** · *Over-privileged ops* | 无分级控制，要么全禁要么全放 · *All-or-nothing access control* | Risk Gate 四维数学公式，0-100 自动分级 · *4-dimensional risk formula with auto-thresholding* |
| 🔴 **记不住、记不对** · *Poor memory* | 把对话扔进向量库——只有检索没有理解 · *Dump conversation into vector DB — retrieval, not understanding* | 三层记忆，像人脑一样评级、压缩、遗忘 · *3-layer memory: rate, compress, forget like a brain* |
| 🔴 **出事查不到原因** · *No audit trail* | Agent 做了什么、为什么做——全不可追溯 · *What the agent did and why — completely untraceable* | 每次操作前后 diff，JSONL 不可篡改审计 · *Pre/post diff per operation, immutable JSONL audit* |
| 🔴 **不知道 Agent 好不好** · *No quality measurement* | 最多有个 success rate 计数器 · *At best, a success-rate counter* | 三阶段评估 + 隐性反馈 + 质量画像 · *3-phase evaluation + implicit feedback + quality profile* |

---

## 🏗️ 架构设计 · Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        AgentOS 架构                              │
│                                                                  │
│  任意 Agent 框架 · Any Agent Framework                           │
│  (OpenClaw / LangChain / CrewAI / 自研 · Custom)                 │
│                              │                                   │
│                              ▼                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    AgentOS 内核 · Kernel                    │  │
│  │                                                             │  │
│  │  ┌─────────┐   ┌──────────┐   ┌────────────┐              │  │
│  │  │ Guard   │   │ Memory   │   │ Evaluator  │              │  │
│  │  │ 守卫层   │   │ 记忆层    │   │ 评估层     │              │  │
│  │  ├─────────┤   ├──────────┤   ├────────────┤              │  │
│  │  │ Schema  │   │ Working  │   │ Pre-exec   │              │  │
│  │  │  Gate   │   │  工作记忆  │   │  执行前评估  │              │  │
│  │  │    ↓    │   │    ↓     │   │     ↓      │              │  │
│  │  │ Risk    │   │ Episodic │   │ Runtime    │              │  │
│  │  │  Gate   │   │  情景记忆  │   │  执行中评估  │              │  │
│  │  │    ↓    │   │    ↓     │   │     ↓      │              │  │
│  │  │Snapshot │   │ Semantic │   │ Post-exec  │              │  │
│  │  │  Gate   │   │  语义记忆  │   │  执行后评估  │              │  │
│  │  │    ↓    │   └──────────┘   │     ↓      │              │  │
│  │  │ Verify  │                  │ Feedback   │              │  │
│  │  │  Gate   │                  │  反馈引擎    │              │  │
│  │  │    ↓    │                  │     ↓      │              │  │
│  │  │ Audit   │                  │ Profiler   │              │  │
│  │  │  Log    │                  │  质量画像    │              │  │
│  │  └─────────┘                  └────────────┘              │  │
│  │                                                             │  │
│  │  ┌─────────────────────────────────────────────────────┐   │  │
│  │  │          Sandbox 沙箱 (direct/sandbox/dry-run)       │   │  │
│  │  └─────────────────────────────────────────────────────┘   │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
│              ┌───────────────┴───────────────┐                   │
│              ▼                               ▼                   │
│  安全执行 · Safe Execution            可靠记忆 · Reliable Memory │
│  全程审计 · Full Audit                持续改进 · Continuous Improve│
└─────────────────────────────────────────────────────────────────┘
```

### 设计哲学 · Design Philosophy

| 原则 · Principle | 含义 · Meaning | 反例 · Counter-example |
|------|------|------|
| **确定性优先** · *Determinism first* | 能不用 LLM 就不用，用确定性代码 · *Use deterministic code whenever possible* | 用 LLM 做安全判断 · *Using LLM for security* |
| **可审计优先** · *Auditability first* | 所有操作可追溯、可回滚、可解释 · *Every operation traceable, rollbackable, explainable* | Agent 操作后无日志 · *No log after agent operations* |
| **渐进增强** · *Progressive enhancement* | 框架无关，可增量接入，不要求替换现有架构 · *Framework-agnostic, incremental adoption* | LangChain 的强绑定 · *Hard vendor lock-in* |

### 不是 Agent，是 Agent 的操作系统 · *Not an Agent — an OS for Agents*

| 类比 · Analogy | 对应 · Implementation |
|------|------|
| 应用程序 · Applications | 任意 Agent 框架 · Any Agent Framework |
| 操作系统 · Operating System | AgentOS |
| 内核 · Kernel | Schema Gate + Risk Gate（确定性代码，零 LLM） |
| 文件系统 · File System | 分层 Memory Store |
| 日志系统 · Logging | Audit Log（不可篡改，支持回滚 · *immutable, supports rollback*） |
| 性能监控 · Performance Monitor | Evaluator 三阶段评估 · *3-phase evaluation* |

---

## ✨ 功能介绍 · Features

### 🛡️ Guard 守卫层（6 个组件，零 LLM 依赖 · *6 components, zero LLM*）

#### Schema Gate — 参数格式校验 · Parameter Validation

| 校验项 · Check | 说明 · Description | 示例 · Example |
|--------|------|------|
| 必填 · required | 字段必须存在 · *Field must exist* | `delete_file` 必须提供 `path` |
| 类型 · types | string/number/boolean/object/array | `path` 必须是 string |
| 允许值 · allowedValues | 枚举约束 · *Enum constraint* | `mode` 只能是 `read`/`write`/`append` |
| 数值范围 · min/max | 数字范围 · *Numeric range* | `max_tokens` 1-100000 |
| 长度范围 · — | 字符串/数组长度 · *String/array length* | `query` 至少 3 字符 |
| 正则 · patterns | 格式校验 · *Pattern match* | `email` 符合邮箱格式 |
| 路径约束 · pathScope | 限制在 workspace 内 · *Workspace boundary* | 禁止写系统目录 · *No system dir writes* |
| 路径黑白名单 · pathAllow/Deny | 允许/禁止的文件模式 · *File pattern allow/block* | 禁止 `.env`, `*.key`, `*.pem` |
| 参数依赖 · dependsOn | 条件必填 · *Conditional required* | `auto_merge=true` → `base_branch` 必填 |
| 参数互斥 · mutuallyExclusive | 互斥参数 · *Mutually exclusive* | `content` 和 `file_path` 不同时存在 |
| 参数大小 · maxSize | 内容字节上限 · *Max content bytes* | `content` ≤ 1MB |
| 敏感标记 · secrets | 日志中脱敏 · *Redact in logs* | |

#### Risk Gate — 风险分级 · Risk Scoring

四维数学公式，零 LLM · *4-dimensional formula:*

```
RiskScore = Impact × (1 - Reversibility) × Sensitivity × (1 + ErrorRate)
```

| 分数区间 · Score | 动作 · Action |
|----------|------|
| ≤ 0.5 | 🟢 自动放行 · *Auto-approve* |
| ≤ 1.0 | 🔵 执行后通知 · *Notify after execution* |
| ≤ 3.0 | 🟡 暂停等待确认 · *Pause for confirmation* |
| > 8.0 | 🔴 直接拒绝 · *Deny* |

#### Snapshot Gate — 执行前快照 · Pre-exec Snapshot

只记录文件 SHA-256 hash + git 状态，不做全量备份，极快。
*Records only SHA-256 hashes + git state, no full backup — extremely fast.*

#### Verify Gate — 执行后校验 · Post-exec Verification

**8 项确定性校验** · *8 deterministic checks:*

| 校验项 · Check | 说明 · Description |
|--------|------|
| 文件存在 · File existence | `fs.existsSync()` 验证声称创建的文件 |
| 文件变更 · File changed | 对比 Snapshot hash，确认真的改了 |
| Lint | ESLint 验证代码文件 |
| TypeCheck | `tsc --noEmit` TypeScript 验证 |
| 格式合法 · Valid format | JSON.parse 验证声称的 JSON 结果 |
| 返回值非空 · Non-empty result | 不应为空但为空 → WARN |
| npm 发布 · npm publish | `npm view` 真实验证 |
| git push | `git ls-remote` HEAD 对比 |

#### Audit Log — 不可篡改审计 · Immutable Audit

追加写入 JSONL 文件，每次操作前后完整记录（Schema + Risk + Snapshot + Verify + Diff）。支持按 session/tool/status 查询。
*Append-only JSONL with full pre/post state per operation. Query by session/tool/status.*

#### Rollback — 回滚

基于 Snapshot + Git 自动回滚。Verify Gate FAIL + 高风险 → 自动触发。
*Git-based auto-rollback. Triggered on Verify FAIL + high risk.*

#### Sandbox Executor — 沙箱执行器

三种模式 · *Three modes:* **direct** · **sandbox** · **dry-run**

- 网络策略 · *Network policy:* none / localhost / whitelist
- 文件系统策略 · *Filesystem policy:* writablePaths / readonlyPaths
- 内置危险命令检测（`rm -rf /`、`sudo`、fork bomb、`curl\|bash` 等）· *Built-in dangerous command detection*

---

### 🧠 Memory 记忆层（3 层，人脑模型 · *3-layer brain model*）

```
Working Memory  →  Episodic Memory  →  Semantic Memory
   工作记忆     →     情景记忆      →     语义记忆
──────────────────────────────────────────────────────
当前会话         →  跨会话事件线      →  永久知识
Current session →  Cross-session    →  Permanent knowledge
1 session 存活   →  数周-数月         →  永久
< 50KB           →  < 500KB          →  < 100KB
```

| 层 · Layer | 用途 · Purpose | 关键能力 · Key Ability |
|----|------|---------|
| **Working** | 当前会话实时上下文 · *Live session context* | 消息/任务/工具缓存/文件/token 预算 · *Messages, tasks, tool cache, open files, token budget* |
| **Episodic** | 跨会话事件时间线 · *Cross-session timeline* | 9 种事件类型、自动重要性评分、渐进压缩（full→summary→one-liner→forgotten） |
| **Semantic** | 提炼后的永久知识 · *Distilled permanent knowledge* | 用户偏好/事实、项目上下文、学习规则（含置信度）、术语表 |

#### Session 启动上下文注入 · Startup Context Injection

新 session 自动从 Semantic + Episodic 注入最相关上下文：
*Auto-injects relevant context at every new session:*

```
[AgentOS Memory Context]
你正在帮助用户"老板"处理项目"coderev"。
You are helping user "Boss" with project "coderev".
上次会话讨论了 Guard 层设计。
Last session discussed Guard layer design.
关键提醒 · Key reminders:
- 老板偏好直接、不说废话 · Boss prefers direct, no fluff
- 发布 npm 前必须更新 CHANGELOG.md · Update CHANGELOG before npm publish
```

---

### 📊 Evaluator 评估层（三阶段 + 隐性反馈 · *3-phase + Implicit Feedback*）

#### 三阶段评估 · Three-Phase Evaluation

```
Pre-exec 评估  →  Runtime 评估  →  Post-exec 评估
 执行前评估        执行中评估         执行后评估
    ↓                ↓                ↓
参数质量           重试次数           验证结果
风险分数           自适应评分         用户接受度
上下文利用         工具选择准确性      结果利用度
```

#### 隐性反馈捕获 · Implicit Feedback（核心差异点 · *Key differentiator*）

不靠"👍👎"，靠行为推断满意度。*No thumbs up/down — infer satisfaction from behavior.*

| 用户行为 · User Behavior | 隐性信号 · Signal | 强度 · Strength |
|----------|---------|------|
| 用户删除了 Agent 创建的代码 · *User deleted agent's code* | `user_deleted_code` | -0.8 |
| 用户打断了 Agent · *User interrupted agent* | `user_interrupted` | -0.6 |
| 用户修改了 Agent 输出 · *User modified agent output* | `user_modified_output` | -0.5 |
| 用户重复了相同指令 · *User repeated same command* | `user_repeated_instruction` | -0.3 |
| 用户立即继续对话 · *User immediately continued* | `user_immediate_continue` | +0.3 |
| 用户说"做得好" · *User said "good job"* | `user_explicit_approval` | +0.6 |
| 用户使用了 Agent 的结果 · *User used agent's result* | `user_used_result` | +0.7 |
| 用户分享了 Agent 输出 · *User shared agent output* | `user_shared_output` | +0.8 |

#### Agent 质量画像 · Quality Profile

```
=== AgentOS Status Report ===

Quality Score: 85/100 📈
Total Operations: 156 (12 in last 24h)

--- Breakdown ---
Pre-Exec:   92/100
Runtime:    88/100
Post-Exec:  85/100
Satisfaction: 82/100

--- Audit ---
Total: 156 | Failures: 2 | High-Risk: 3

--- ⚠️ Warnings ---
- 2 verify failures in last 24h — review session #3
  24小时内2次校验失败——检查session #3

--- ✅ Strengths 强项 ---
- Excellent execution reliability · 优秀的执行可靠性
- Strong positive user feedback · 强烈正向用户反馈
```

---

## 📦 安装 · Installation

```bash
npm install @agentos/core
```

⚠️ **npm 包尚未发布 · *not yet published***，当前从源码使用 · *use from source:*

```bash
git clone git@github.com:jishuanjimingtian/agentos.git
cd agentos
npm install
npm test        # 99 tests, all passing · 99个测试全部通过
npm run build   # 编译到 dist/
```

---

## 🚀 使用说明 · Usage

### 基础用法 · Basic

```typescript
import { AgentOS } from 'agentos';

const aos = new AgentOS({
  workspaceRoot: process.cwd(),
  maxWorkingTokens: 50000,
  maxEpisodicSizeKb: 500,
});

// 设置记忆 · Configure memory
aos.memory.semantic.setPreference('language', 'zh-CN');
aos.memory.semantic.addFact('用户在北京，偏好简洁沟通');
aos.memory.semantic.learnRule('提交前运行 npm test', 'session_1');

// 设置 Schema 规则 · Register schema rules
aos.guard.schema.registerRule({
  tool: 'write_file',
  required: ['path', 'content'],
  types: { path: 'string', content: 'string' },
  pathDeny: { path: ['.env', '*.key', '*.pem', '.git/**'] },
  maxSize: { content: 1048576 },
  secrets: ['content'],
});

// Pre-exec：校验 + 快照 · Validate + snapshot
const { preExec, snapshot } = aos.executePipeline({
  sessionId: 'session_1',
  agentId: 'main_agent',
  toolName: 'write_file',
  parameters: { path: 'src/main.ts', content: 'console.log("hello");' },
  affectedFiles: ['src/main.ts'],
});

console.log(`Risk: ${preExec.riskScore.score} → ${preExec.riskScore.action}`);
// → Risk: 0.19 → auto

// Post-exec：验证 + 审计 · Verify + audit
const result = aos.completeExecution({
  sessionId: 'session_1', agentId: 'main_agent',
  toolName: 'write_file',
  toolParameters: { path: 'src/main.ts', content: 'console.log("hello");' },
  toolResult: 'file written',
  snapshot,
  startTime: Date.now() - 500, endTime: Date.now(),
  retryCount: 0, wasSelfCorrected: false, hadTimeout: false,
  userAccepted: true, userProvidedEdit: false, resultWasUsed: true,
});

console.log(`Post-exec: ${result.postExec.outcomeScore}`);
console.log(`Audit: ${result.auditEntry.id}`);

// 记录反馈 · Record feedback
aos.recordFeedback('user_immediate_continue', 'session_1');

// 查看报告 · Status report
console.log(aos.statusReport());
```

### 接入现有 Agent 框架 · Integrate with any Agent framework

```typescript
import { AgentOS } from 'agentos';

const aos = new AgentOS({ workspaceRoot: process.cwd() });

async function safeToolCall(toolName: string, params: Record<string, unknown>) {
  const sessionId = getCurrentSessionId();

  // 1. 校验 + 风险 + 快照 · Validate + Risk + Snapshot
  const { preExec, snapshot } = aos.executePipeline({
    sessionId, agentId: 'my_agent', toolName, parameters: params,
  });

  if (preExec.riskScore.action === 'deny') {
    throw new Error(`Rejected: risk ${preExec.riskScore.score}`);
  }

  if (preExec.riskScore.action === 'confirm') {
    const ok = await askUser(`Risk ${preExec.riskScore.score}. Proceed?`);
    if (!ok) return;
  }

  const t0 = Date.now();
  const result = await yourActualCall(toolName, params);

  // 2. 验证 + 审计 · Verify + Audit
  return aos.completeExecution({
    sessionId, agentId: 'my_agent', toolName,
    toolParameters: params, toolResult: result, snapshot,
    startTime: t0, endTime: Date.now(),
    retryCount: 0, wasSelfCorrected: false, hadTimeout: false,
    userAccepted: true, userProvidedEdit: false, resultWasUsed: false,
  });
}
```

### 沙箱 · Sandbox

```typescript
import { SandboxExecutor } from 'agentos';

const sandbox = new SandboxExecutor({
  mode: 'sandbox',
  workspaceRoot: process.cwd(),
  timeoutMs: 30000,
  networkAccess: 'whitelist',
  networkWhitelist: ['api.github.com', 'registry.npmjs.org'],
  writablePaths: ['src/', 'tests/', 'dist/'],
  allowedTools: ['read_file', 'write_file', 'edit', 'exec'],
  forbiddenTools: ['rm', 'unlink'],
});

// Pre-flight · 预检
sandbox.validate('rm', { path: 'src/main.ts' });
// → { success: false, sandboxRejectReason: 'Tool "rm" is forbidden' }

// Execute · 执行
await sandbox.execute('exec', { command: 'npm test', cwd: process.cwd() });
```

### API 层 · SDK API

```typescript
import { AgentOS, AgentOSAPI } from 'agentos';

const api = new AgentOSAPI(new AgentOS());

// Guard
api.guardRegisterRule({ tool: 'delete_file', required: ['path'] });

// Memory
api.memorySetPreference('language', 'zh-CN');
api.memoryLearnRule('Never push directly to main', 'cr_1');

// Pipeline + Audit
const result = await api.pipelineExecute({...});
const audit = api.auditQuery({ toolName: 'write_file', limit: 10 });

// Profile
const report = api.getStatusReport();
api.endSession('session_1');
```

---

## 📖 使用案例 · Examples

### 1. 拦截危险命令 · Blocking dangerous commands

```typescript
const { preExec } = aos.executePipeline({
  sessionId: 's1', agentId: 'a1',
  toolName: 'exec',
  parameters: { command: 'rm -rf /home' },
});
// → { score: 9.18, action: 'deny' } 🔴 自动拒绝 · Auto-denied
```

### 2. 检测 Agent 幻觉 · Detecting hallucination

```typescript
// Agent 声称"写入了文件"，但实际没有 · Agent claims "file written" but didn't
const result = aos.completeExecution({
  ...,
  toolResult: 'file written successfully', // ← Agent 幻觉！
  snapshot,
  ...
});
console.log(result.postExec.verifyPassed); // → false
// Verify Gate 检测到文件不存在 → FAIL
```

### 3. 跨会话记忆 · Cross-session memory

```typescript
// Session 1: 学到偏好 · Learned preferences
const aos1 = new AgentOS();
aos1.memory.semantic.setPreference('language', 'zh-CN');
aos1.memory.semantic.learnRule('测试前先编译', 'session_1');
aos1.endSession('session_1');

// Session 2: 自动注入 · Auto-injected
const aos2 = new AgentOS();
console.log(aos2.injectContext());
// [AgentOS Semantic Memory]
// ## Preferences
// - language: "zh-CN"
// ## Learned Rules · 学习到的规则
// - [50%] 测试前先编译
```

### 4. 隐性反馈驱动改进 · Feedback-driven improvement

```typescript
// 用户删除了 Agent 创建的代码 · User deleted agent-created code
aos.recordFeedback('user_deleted_code', 's1');

// 连续3次修改 · Modified 3 times
aos.recordFeedback('user_modified_output', 's1');
aos.recordFeedback('user_modified_output', 's1');
aos.recordFeedback('user_modified_output', 's1');

const stats = aos.evaluator.feedback.stats();
// → { totalSignals: 4, negativeSignals: 4, averageStrength: -0.57 }

const profile = aos.getProfile();
// → warnings: ["User satisfaction declining — review recent sessions"]
```

### 5. 沙箱保护 · Sandbox protection

```typescript
const sandbox = new SandboxExecutor({
  mode: 'sandbox',
  networkAccess: 'none',           // 禁止网络 · No network
  writablePaths: ['src/', 'logs/'], // 只能写这里 · Only writable here
  forbiddenTools: ['rm', 'git_push'],
});

await sandbox.execute('exec', { command: 'npm test' });     // ✅ OK
await sandbox.execute('exec', { command: 'curl evil.com' }); // ❌ 网络被黑洞 · Blocked
```

---

## 🧪 测试 · Tests

```bash
npm test
```

```
PASS  tests/guard/schema-gate.test.ts       (21 tests)
PASS  tests/guard/risk-gate.test.ts         (20 tests)
PASS  tests/guard/snapshot-verify-audit.test.ts (17 tests)
PASS  tests/memory/memory.test.ts           (29 tests)
PASS  tests/core.test.ts                    (12 tests)
────────────────────────────────────────────────
Test Suites: 5 passed, 5 total
Tests:       99 passed, 99 total
```

---

## ⚠️ 常见问题 · FAQ

<details>
<summary><b>Q: AgentOS 和 LangChain / CrewAI 什么关系？</b></summary>

AgentOS **不是竞争对手**，是基础设施层。LangChain/CrewAI 是 Agent 框架，AgentOS 是给它们提供安全、记忆、评估的操作系统。可以增量接入任何框架。
*Not a competitor — infrastructure. LangChain/CrewAI are agent frameworks; AgentOS provides safety + memory + evaluation as an OS layer. Incrementally pluggable into any framework.*
</details>

<details>
<summary><b>Q: 为什么 Guard 层不用 LLM？ · Why no LLM in Guard?</b></summary>

LLM 做安全判断 = 用问题制造者来解决问题。Schema 校验是纯工程数学——类型检查、范围检查、hash 对比——这些 LLM 反而做不好（会幻觉）。确定性代码 = 0 幻觉。
*Using LLM for security = solving problems with the problem-maker. Schema validation is pure engineering — type/range/hash checks — things LLMs are bad at. Deterministic code = zero hallucination.*
</details>

<details>
<summary><b>Q: Memory 层和 RAG 有什么区别？ · How is this different from RAG?</b></summary>

RAG = 把对话扔进向量库做检索。AgentOS Memory = 人脑模型：Working（当前会话）、Episodic（自动评分+压缩）、Semantic（提炼后的永久知识）。最重要的是：**AgentOS 会自动写入记忆，不需要 Agent 手动管理**。
*RAG = dump conversation into vector DB. AgentOS Memory = brain model. Most importantly: **AgentOS auto-writes memory; agents don't need to manage it manually.***
</details>

<details>
<summary><b>Q: 会不会很慢？ · Is it slow?</b></summary>

不会。Guard 层所有校验都是 `fs.existsSync()`、hash 对比、数学公式，每个校验 **< 1ms**。Snapshot 只记录 hash 不复制文件。整个流水线开销可忽略。
*No. All Guard checks are fs.existsSync(), hash comparison, math formulas — each < 1ms. Snapshot records hashes only, no file copy. Pipeline overhead is negligible.*
</details>

<details>
<summary><b>Q: 能用在生产环境吗？ · Production-ready?</b></summary>

v1.0 已完成 100% 设计文档覆盖率、99 个测试全通过、TypeScript 严格模式。API 稳定，可以集成。但建议先在测试环境跑一段时间。
*v1.0 has 100% design coverage, 99 passing tests, strict TypeScript. API is stable and integrable. Recommend testing before production.*
</details>

<details>
<summary><b>Q: npm 包什么时候发布？ · When npm publish?</b></summary>

TODO。当前可以直接 `git clone` + `npm link` 使用。
*Currently use via `git clone` + `npm link`.*
</details>

<details>
<summary><b>Q: 沙箱模式安全吗？ · Is sandbox truly secure?</b></summary>

v1.0 沙箱基于环境变量 + 路径校验 + 命令模式检测，不是容器级隔离。v2.0 计划支持 Docker 沙箱。
*v1.0 sandbox uses env vars + path validation + command pattern detection — not container-level isolation. Docker sandbox planned for v2.0.*
</details>

<details>
<summary><b>Q: 怎么看 Audit Log？ · How to view audit logs?</b></summary>

```bash
cat .agentos/audit.jsonl | jq '.'
```

或通过 API · *or via API:*

```typescript
const entries = api.auditQuery({ minScore: 3.0 }); // 高风险操作 · High-risk ops
```
</details>

---

## 🗺️ 路线图 · Roadmap

| 版本 | 内容 | 状态 |
|------|------|:--:|
| v0.1 | 项目脚手架 + 类型定义 · *Scaffold + types* | ✅ |
| v0.2 | Guard 层（6 组件）· *Guard layer (6 components)* | ✅ |
| v0.3 | Memory 层（3 层）· *Memory layer (3 layers)* | ✅ |
| v0.4 | Evaluator 层（评估 + 反馈 + 画像）· *Evaluator* | ✅ |
| v1.0 | 沙箱 + API + x- 扩展 + 校验补齐 · *Sandbox + API + x-ext* | ✅ |
| v1.1 | npm 发布 · *npm publish* | 📋 |
| v2.0 | Docker 沙箱、Dashboard、SaaS · *Docker sandbox, Dashboard, SaaS* | 📋 |

---

## 📂 源码结构 · Source Layout

```
src/
├── index.ts               # 导出入口 · Exports (30+)
├── core.ts                 # AgentOS 主循环 · Main loop
├── api.ts                  # SDK 协议层 · API layer (25+ methods)
├── types/index.ts          # 完整类型定义 · Type definitions
├── guard/
│   ├── schema-gate.ts      # Schema 校验 · Validation (12 checks)
│   ├── risk-gate.ts        # 风险评分 · Risk scoring
│   ├── snapshot-verify.ts  # 快照 + 验证 + 回滚 · Snapshot + Verify + Rollback
│   ├── audit-log.ts        # 审计日志 · Audit
│   └── sandbox.ts          # 沙箱执行器 · Sandbox executor
├── memory/
│   ├── working.ts          # 工作记忆 · Working
│   ├── episodic.ts         # 情景记忆 · Episodic
│   └── semantic.ts         # 语义记忆 · Semantic
└── evaluator/
    ├── exec-evaluator.ts   # 三阶段评估器 · 3-phase evaluator
    ├── feedback.ts         # 隐性反馈引擎 · Implicit feedback
    └── profiler.ts         # Agent 质量画像 · Quality profiler
```

---

## 📄 License

MIT
