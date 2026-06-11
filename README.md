# Sentinel AgentOS — AI Agent 操作系统 · AI Agent Operating System

> **确定性 Guard 层 + 分层记忆 + 自动评估，让任何 Agent 变得可靠、可审计、可改进。**
> *Deterministic Guard Layer + Layered Memory + Automated Evaluation — making any Agent reliable, auditable, and self-improving.*

[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/tests-99%2F99-brightgreen)](https://github.com/jishuanjimingtian/sentinel-agentos/actions)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

---

## 🤔 为什么需要 Sentinel AgentOS · Why Sentinel AgentOS

AI Agent 面临五大核心问题，现有框架都没能真正解决。
*AI Agents face five critical problems that no existing framework truly solves.*

| 痛点 · Pain | 现状 · Status Quo | Sentinel AgentOS 方案 · Solution |
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
│                        Sentinel AgentOS 架构                              │
│                                                                  │
│  任意 Agent 框架 · Any Agent Framework                           │
│  (OpenClaw / LangChain / CrewAI / 自研 · Custom)                 │
│                              │                                   │
│                              ▼                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    Sentinel AgentOS 内核 · Kernel                    │  │
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
| 操作系统 · Operating System | Sentinel AgentOS |
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
[Sentinel AgentOS Memory Context]
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
=== Sentinel AgentOS Status Report ===

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
npm install sentinel-agentos
```

即可使用所有功能。

如果从源码开发：

```bash
git clone git@github.com:jishuanjimingtian/Sentinel AgentOS.git
cd Sentinel AgentOS
npm install
npm test        # 99 tests, all passing · 99个测试全部通过
npm run build   # 编译到 dist/
```

---

## 🚀 使用说明 · Usage

### 三种接入方式 · Three Integration Modes

Sentinel AgentOS 支持三种接入方式，从轻到重按需选择。

| 方式 | 适用场景 | 代码量 | 说明 |
|------|---------|--------|------|
| **CLI** | 快速测试 / CI/CD | 1 行命令 | 直接命令行检验工具调用 |
| **SDK** | 嵌入 Agent 框架 | 5 行代码 | `import { AgentOS }` 在进程内调用 |
| **HTTP API** | 跨语言 / 远程服务 | HTTP 请求 | 独立 HTTP 服务，任何语言都能调 |

---

### 方式一：CLI（命令行）

```bash
# 安装
npm install -g sentinel-agentos

# 校验参数
sentinel-agentos validate exec command="rm -rf /"
sentinel-agentos validate write_file path=src/main.ts content="console.log(1)"

# 风险评分
sentinel-agentos risk exec command="sudo reboot"
sentinel-agentos risk exec command="npm test"

# 查看审计日志
sentinel-agentos audit --limit 10

# 查看状态报告
sentinel-agentos status

# 启动 HTTP 服务
sentinel-agentos server --port 3300 --token ***

# 查看帮助
sentinel-agentos help
```

**支持的命令**：`validate` / `risk` / `audit` / `stats` / `profile` / `status` / `server` / `memory` / `help`

---

### 方式二：SDK（代码嵌入）

#### 2.1 基础用法 · Basic

```typescript
import { AgentOS } from 'sentinel-agentos';

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
import { AgentOS } from 'sentinel-agentos';

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
import { SandboxExecutor } from 'sentinel-agentos';

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

#### 2.2 中间件（一行接入） · Middleware (one-liner)

```typescript
import { wrapAgent } from 'sentinel-agentos';

// 一行接入——包裹你的 Agent 工具调用
const sentinel = wrapAgent({ workspaceRoot: process.cwd() });

// 每次工具调用前后调用即可
const { allowed, reason } = sentinel.preCheck('exec', { command: 'rm -rf /' });
// → { allowed: false, reason: 'Risk 9.18 → DENY' }
```

#### 2.3 OpenClaw 插件

如果你在用 OpenClaw Agent 框架，直接以插件形式集成：

```typescript
import { sentinelPlugin } from 'sentinel-agentos';

// 注册为 OpenClaw 插件，自动 hook 所有工具调用
const plugin = sentinelPlugin({
  workspaceRoot: process.cwd(),
  preRegisteredRules: true,
});
// → onBeforeTool → 校验 + 风险评分
// → onAfterTool → 验证 + 审计
```

---

### 方式三：HTTP API（远程调用，跨语言通用）

Sentinel AgentOS 可启动为独立 HTTP 服务，任何语言（Python/Go/Rust/Java...）都能调用。

#### 3.1 启动服务

```bash
# CLI 一行启动
npx sentinel-agentos server --port 3300 --token ***

# 或代码中启动
import { createServer } from 'sentinel-agentos';
createServer({ port: 3300, apiToken: '***' }).start();
```

启动后健康检查（免 token）：
```bash
curl http://localhost:3300/health
# → {"ok":true,"uptime":12.3}
```

#### 3.2 鉴权

除 `/health` 外所有端点需要 `Authorization: Bearer <token>` header。否则返回 `401`。

#### 3.3 API 端点参考 · API Reference

**基础端点：**

| 端点 | 方法 | 鉴权 | 说明 |
|------|:--:|:--:|------|
| `/health` | GET | ❌ | 服务健康检查 |
| `/pipeline/pre` | POST | ✅ | 执行前校验（Schema + Risk + Snapshot） |
| `/pipeline/post` | POST | ✅ | 执行后验证（Verify + Audit + Feedback） |
| `/pipeline/report` | GET | ✅ | 质量状态报告（文本） |
| `/pipeline/profile` | GET | ✅ | 质量画像（JSON） |

**Guard / Memory / Feedback / Audit 端点：**

| 端点 | 方法 | 说明 |
|------|:--:|------|
| `/guard/schema` | POST | 注册 Schema 校验规则 |
| `/memory/preference` | POST | 设置用户偏好 `{"key":"language","value":"zh-CN"}` |
| `/memory/fact` | POST | 添加事实 `{"fact":"用户在上海"}` |
| `/memory/context` | GET | 获取当前记忆上下文 |
| `/feedback` | POST | 记录隐性反馈 `{"signal":"user_explicit_approval"}` |
| `/audit` | GET | 查询审计日志（支持 `?limit=&sessionId=&toolName=&status=`） |

**反馈信号类型：**

| 信号 | 强度 | 说明 |
|------|------|------|
| `user_explicit_approval` | +0.6 | 用户明确说"做得好" |
| `user_immediate_continue` | +0.3 | 用户立即继续对话 |
| `user_used_result` | +0.7 | 用户使用了 Agent 的结果 |
| `user_shared_output` | +0.8 | 用户分享了 Agent 输出 |
| `user_modified_output` | -0.5 | 用户修改了 Agent 输出 |
| `user_deleted_code` | -0.8 | 用户删除了 Agent 创建的代码 |
| `user_interrupted` | -0.6 | 用户打断了 Agent |
| `user_repeated_instruction` | -0.3 | 用户重复了相同指令 |

#### 3.4 完整调用示例

```bash
# 1. Pre-exec — 校验 + 风险评分
curl -s -H "Authorization: Bearer $TOKEN" \
  -X POST http://localhost:3300/pipeline/pre \
  -H 'Content-Type: application/json' \
  -d '{"toolName":"exec","parameters":{"command":"npm test"}}'
# → {"preExec":{"schemaCheck":{"pass":true},"riskScore":{"score":0.19,"action":"auto"}},"snapshot":{...}}

# 2. Post-exec — 验证 + 审计
# （传入 pre 返回的 snapshot）
curl -s -H "Authorization: Bearer $TOKEN" \
  -X POST http://localhost:3300/pipeline/post \
  -H 'Content-Type: application/json' \
  -d '{"toolName":"exec","toolParameters":{"command":"npm test"},"toolResult":"all passed","snapshot":{...},"startTime":1718123456000,"endTime":1718123457000,"retryCount":0,"wasSelfCorrected":false,"hadTimeout":false,"userAccepted":true,"userProvidedEdit":false,"resultWasUsed":true}'

# 3. 查看报告
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3300/pipeline/report

# 4. 查询审计
curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:3300/audit?limit=10&toolName=exec"

# 5. 记录反馈
curl -s -H "Authorization: Bearer $TOKEN" \
  -X POST http://localhost:3300/feedback \
  -H 'Content-Type: application/json' \
  -d '{"signal":"user_immediate_continue","sessionId":"session_1"}'
```

#### 3.5 跨语言（Python 示例）

```python
import requests

BASE = "http://localhost:3300"
HEADERS = {"Authorization": "Bearer ***"}

# Pre-exec
resp = requests.post(f"{BASE}/pipeline/pre", json={
    "toolName": "exec", "parameters": {"command": "npm test"}
}, headers=HEADERS)
data = resp.json()
print(f"Risk: {data['preExec']['riskScore']['score']} → {data['preExec']['riskScore']['action']}")

# Post-exec (pass snapshot from pre)
snapshot = data["snapshot"]
resp2 = requests.post(f"{BASE}/pipeline/post", json={
    "toolName": "exec",
    "toolParameters": {"command": "npm test"},
    "toolResult": "all passed",
    "snapshot": snapshot,
    "startTime": 1718123456000, "endTime": 1718123457000,
    "retryCount": 0, "wasSelfCorrected": False,
    "hadTimeout": False, "userAccepted": True,
    "userProvidedEdit": False, "resultWasUsed": True
}, headers=HEADERS)
print(f"Verify: {resp2.json()['postExec']['verifyPassed']}")

# Report
print(requests.get(f"{BASE}/pipeline/report", headers=HEADERS).text)
```

---

### API 层 · SDK API

```typescript
import { Sentinel AgentOS, Sentinel AgentOSAPI } from 'Sentinel AgentOS';

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
// [Sentinel AgentOS Semantic Memory]
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
<summary><b>Q: Sentinel AgentOS 和 LangChain / CrewAI 什么关系？</b></summary>

Sentinel AgentOS **不是竞争对手**，是基础设施层。LangChain/CrewAI 是 Agent 框架，Sentinel AgentOS 是给它们提供安全、记忆、评估的操作系统。可以增量接入任何框架。
*Not a competitor — infrastructure. LangChain/CrewAI are agent frameworks; Sentinel AgentOS provides safety + memory + evaluation as an OS layer. Incrementally pluggable into any framework.*
</details>

<details>
<summary><b>Q: 为什么 Guard 层不用 LLM？ · Why no LLM in Guard?</b></summary>

LLM 做安全判断 = 用问题制造者来解决问题。Schema 校验是纯工程数学——类型检查、范围检查、hash 对比——这些 LLM 反而做不好（会幻觉）。确定性代码 = 0 幻觉。
*Using LLM for security = solving problems with the problem-maker. Schema validation is pure engineering — type/range/hash checks — things LLMs are bad at. Deterministic code = zero hallucination.*
</details>

<details>
<summary><b>Q: Memory 层和 RAG 有什么区别？ · How is this different from RAG?</b></summary>

RAG = 把对话扔进向量库做检索。Sentinel AgentOS Memory = 人脑模型：Working（当前会话）、Episodic（自动评分+压缩）、Semantic（提炼后的永久知识）。最重要的是：**Sentinel AgentOS 会自动写入记忆，不需要 Agent 手动管理**。
*RAG = dump conversation into vector DB. Sentinel AgentOS Memory = brain model. Most importantly: **Sentinel AgentOS auto-writes memory; agents don't need to manage it manually.***
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
<summary><b>Q: npm 包已经发布了吗？ · Is npm package published?</b></summary>

已发布。`npm install sentinel-agentos` 即可使用。当前版本 v0.1.x。
*Published. Just `npm install sentinel-agentos`. Current version v0.1.x.*
</details>

<details>
<summary><b>Q: 沙箱模式安全吗？ · Is sandbox truly secure?</b></summary>

v1.0 沙箱基于环境变量 + 路径校验 + 命令模式检测，不是容器级隔离。v2.0 计划支持 Docker 沙箱。
*v1.0 sandbox uses env vars + path validation + command pattern detection — not container-level isolation. Docker sandbox planned for v2.0.*
</details>

<details>
<summary><b>Q: 怎么看 Audit Log？ · How to view audit logs?</b></summary>

```bash
cat .Sentinel AgentOS/audit.jsonl | jq '.'
```

或通过 API · *or via API:*

```typescript
const entries = api.auditQuery({ minScore: 3.0 }); // 高风险操作 · High-risk ops
```
</details>

<details>
<summary><b>Q: Sentinel AgentOS 需要 API Key 吗？ · Does it need an API Key?</b></summary>

不需要。Sentinel AgentOS 的 Guard / Memory / Evaluator 层都是纯确定性代码，不调用任何外部 AI API。唯一的鉴权是 HTTP API 模式下可选的 `--token` 参数。
*No. All Guard/Memory/Evaluator layers are pure deterministic code with zero external API calls. The only authentication is the optional `--token` for HTTP API mode.*
</details>

<details>
<summary><b>Q: HTTP API Token 怎么设置？ · How to set HTTP API token?</b></summary>

三种方式：
1. 命令行参数：`npx sentinel-agentos server --port 3300 --token my-secret`
2. 代码中配置：`createServer({ port: 3300, apiToken: 'my-secret' })`
3. 环境变量：`AGENTOS_TOKEN=*** npx sentinel-agentos server`

不设置 Token 则不加鉴权（仅适合本地开发环境）。
*Three ways: CLI flag, code config, or AGENTOS_TOKEN env var. No token = no auth (local dev only).*
</details>

<details>
<summary><b>Q: Token 泄漏了怎么办？ · What if token leaks?</b></summary>

重启服务，换一个新 Token 即可：
1. 生成新 Token：`openssl rand -hex 32`
2. 重启 sentinel-agentos server 使用新 Token
3. 更新所有客户端调用
Sentinel AgentOS 的 Token 是服务端本地验证的，无需到任何平台撤销。
*Restart server with a new token. No external platform involved — tokens are validated locally.*
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
| v1.1 | npm 发布 + 三种接入方式 · *npm publish + 3 modes* | ✅ |
| v2.0 | Docker 沙箱、Dashboard、SaaS · *Docker sandbox, Dashboard, SaaS* | 📋 |

---

## 🔑 Token 与鉴权说明

Sentinel AgentOS 本身**不依赖外部 AI API**，所有 Guard / Memory / Evaluator 都是纯确定性代码。唯一的鉴权需求来自 **HTTP API 模式**下的 `server` 命令。

### HTTP API Token 鉴权

启动 HTTP 服务后，除 `/health` 外所有端点都需要 Bearer Token 鉴权。

#### 启动时设置 Token

```bash
# 方式一：命令行参数
npx sentinel-agentos server --port 3300 --token my-secret-token-123

# 方式二：代码中配置
import { createServer } from 'sentinel-agentos';
const server = createServer({ port: 3300, apiToken: 'my-secret-token-123' });
await server.start();
```

#### 客户端调用

```bash
# 所有 API（/health 除外）都需要 Authorization header
curl -H "Authorization: Bearer my-secret-token-123" \
  http://localhost:3300/pipeline/profile

# Token 不匹配 → 401 Unauthorized
curl http://localhost:3300/pipeline/profile
# → {"error":"Unauthorized: invalid or missing API token"}
```

#### Token 未设置时

如果不传 `--token` 或 `apiToken`，服务**不加鉴权**，所有端点可自由访问。适用于本地开发环境，生产环境**强烈建议设置 Token**。

```bash
# 无鉴权模式（仅限本地开发）
npx sentinel-agentos server --port 3300
# 所有端点无需 Authorization header
```

#### Token 最佳实践

| 环境 | Token 策略 | 示例 |
|------|----------|------|
| 本地开发 | 可不用 Token | `npx sentinel-agentos server --port 3300` |
| 本机测试 | 简短 Token | `--token dev-123` |
| 生产环境 | 强随机 Token | `--token $(openssl rand -hex 32)` |
| Docker / CI | 环境变量注入 | `--token $AGENTOS_API_TOKEN` |
| 跨语言调用 | HTTP header | `Authorization: Bearer <token>` |

### 环境变量配置

除 Token 外，Sentinel AgentOS 没有其他必填环境变量。可选的环境变量：

| 环境变量 | 说明 | 默认值 |
|---------|------|--------|
| `HOME` / `USERPROFILE` | 持久化存储根目录 | 系统默认 |
| `AGENTOS_WORKSPACE` | workspace 根目录 | `process.cwd()` |
| `AGENTOS_TOKEN` | API Token（备选方式） | — |

---

## 📋 完整接口使用说明

> 本章汇总 Sentinel AgentOS 所有接口——CLI、SDK、HTTP API、中间件、沙箱——作为完整参考。

### 命令一览

| 分类 | 接口/命令 | 说明 |
|------|---------|------|
| CLI | `validate` | 参数格式校验（Schema Gate） |
| CLI | `risk` | 风险评分（Risk Gate） |
| CLI | `audit` | 查询审计日志 |
| CLI | `stats` | 审计统计（JSON） |
| CLI | `profile` | Agent 质量画像（JSON） |
| CLI | `status` | 质量状态报告（人类可读） |
| CLI | `server` | 启动 HTTP API 服务 |
| CLI | `memory` | 查看注入上下文 |
| CLI | `help` | 帮助信息 |
| SDK | `AgentOS` | 主类，完整流水线 |
| SDK | `AgentOSAPI` | SDK 协议层（25+ 方法） |
| SDK | `SchemaGate` / `RiskGate` 等 | 独立组件 |
| SDK | `wrapAgent` | 一行接入中间件 |
| SDK | `sentinelPlugin` | OpenClaw 插件 |
| SDK | `SandboxExecutor` | 沙箱执行器 |
| HTTP | `POST /pipeline/pre` | 执行前校验 |
| HTTP | `POST /pipeline/post` | 执行后验证 |
| HTTP | `GET /pipeline/report` | 状态报告 |
| HTTP | `GET /pipeline/profile` | 质量画像 |
| HTTP | `POST /guard/schema` | 注册 Schema 规则 |
| HTTP | `GET /guard/schema` | 查看 Schema 规则 |
| HTTP | `POST /memory/preference` | 设置偏好 |
| HTTP | `POST /memory/fact` | 添加事实 |
| HTTP | `POST /memory/rule` | 学习规则 |
| HTTP | `GET /memory/context` | 获取注入上下文 |
| HTTP | `GET /audit` | 查询审计日志 |
| HTTP | `POST /feedback` | 记录反馈 |
| HTTP | `POST /session/end` | 结束 session |
| HTTP | `GET /health` | 健康检查（免 Token） |

---

### CLI 接口

```
sentinel-agentos <command> [args...]
```

#### `validate` — 参数格式校验

```bash
# 新语法（推荐）
sentinel-agentos validate <tool> [key=value...]

# 校验 exec 命令
sentinel-agentos validate exec command="rm -rf /"
# → {"pass":true,"errors":[]}

# 校验 write_file（会被 pathDeny 拦截）
sentinel-agentos validate write_file path=.env content=hello
# → {"pass":false,"errors":[{"field":"path","message":"path matches deny pattern"}]}

# 旧语法（--tool + --params JSON）
sentinel-agentos validate --tool exec --params '{"command":"npm test"}'
```

| 参数 | 说明 |
|------|------|
| `<tool>` | 工具名称（如 `exec`, `write_file`, `delete_file`） |
| `key=value` | 参数键值对，支持 `key="带空格的值"`，自动检测类型 |

#### `risk` — 风险评分

```bash
sentinel-agentos risk exec command="sudo reboot"
# → {"score":8.5,"action":"deny","dimensions":{"impact":3,"reversibility":0.2,...}}

sentinel-agentos risk exec command="npm test"
# → {"score":0.19,"action":"auto",...}
```

| 风险等级 | 分数 | 动作 |
|---------|------|------|
| 🟢 Auto | ≤ 0.5 | 自动放行 |
| 🔵 Notify | ≤ 1.0 | 执行后通知 |
| 🟡 Confirm | ≤ 3.0 | 暂停等待确认 |
| 🔴 Deny | > 8.0 | 直接拒绝 |

#### `audit` — 查询审计日志

```bash
sentinel-agentos audit --limit 10
# → [{id, sessionId, toolName, verifyStatus, riskScore, ...}, ...]

sentinel-agentos audit --limit 5
```

#### `stats` / `profile` / `status` — 统计与画像

```bash
# 审计统计（JSON）
sentinel-agentos stats
# → {"totalOperations":156,"verifyFailures":2,"highRiskOps":3,...}

# Agent 质量画像（JSON）
sentinel-agentos profile
# → {"overallScore":85,"breakdown":{...},"trends":{...},"warnings":[...]}

# 质量状态报告（人类可读）
sentinel-agentos status
# → 文本报告
```

#### `server` — 启动 HTTP API 服务

```bash
sentinel-agentos server --port 3300 --token ***
# → 🛡️ Sentinel AgentOS HTTP server → http://127.0.0.1:3300

# 可选项
sentinel-agentos server --port 8080 --host 0.0.0.0 --token ***
```

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--port <N>` | `3300` | 服务端口 |
| `--host <IP>` | `127.0.0.1` | 绑定地址 |
| `--token <str>` | — | API 鉴权 Token（不设则无鉴权） |

#### `memory` — 查看记忆上下文

```bash
sentinel-agentos memory
# → 当前 semantic + episodic 注入的上下文文本
```

---

### SDK 接口

#### `AgentOS` — 主类

```typescript
import { AgentOS } from 'sentinel-agentos';

const aos = new AgentOS({
  workspaceRoot: process.cwd(),  // 工作区根目录
  maxWorkingTokens: 50000,       // 工作记忆 token 上限
  maxEpisodicSizeKb: 500,        // 情景记忆大小上限 (KB)
  guardConfig: {                 // Guard 配置
    riskGate: {
      autoApprove: 0.5,
      notify: 1.0,
      confirm: 3.0,
      deny: 8.0,
    },
  },
});
```

**构造函数参数 `AgentOSConfig`**：

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `workspaceRoot` | string | `process.cwd()` | 工作区根目录，持久化存储位置 |
| `maxWorkingTokens` | number | `50000` | 工作记忆最大 token 数 |
| `maxEpisodicSizeKb` | number | `500` | 情景记忆最大大小 (KB) |
| `guardConfig.riskGate` | object | 见上 | 风险评分阈值覆盖 |
| `evaluatorConfig.implicitFeedbackEnabled` | boolean | — | 隐性反馈开关 |

**核心方法**：

| 方法 | 返回 | 说明 |
|------|------|------|
| `executePipeline({...})` | `{preExec, snapshot, profile}` | 执行前校验流水线（Schema + Risk + Snapshot） |
| `completeExecution({...})` | `{runtime, postExec, auditEntry, profile}` | 执行后验证流水线（Verify + Audit） |
| `recordFeedback(signal, sessionId)` | `void` | 记录隐性用户反馈 |
| `injectContext()` | `string` | 注入记忆上下文（session 启动时调用） |
| `endSession(sessionId)` | `void` | 结束 session（清空 Working Memory） |
| `getProfile(sessionId?)` | `AgentProfile` | 获取 Agent 质量画像 |
| `getAuditStats()` | 审计统计 | 获取审计统计 |
| `statusReport()` | `string` | 获取人类可读的状态报告 |

**访问子组件**：

```typescript
// Guard 层
aos.guard.schema    // SchemaGate — 注册/查询校验规则
aos.guard.risk      // RiskGate — 风险评分引擎
aos.guard.snapshot  // SnapshotGate — 执行前快照
aos.guard.verify    // VerifyGate — 执行后验证
aos.guard.audit     // AuditLog — 审计日志

// Memory 层
aos.memory.working   // WorkingMemory — 当前会话工作记忆
aos.memory.episodic  // EpisodicMemory — 跨会话事件时间线
aos.memory.semantic  // SemanticMemoryStore — 永久知识

// Evaluator 层
aos.evaluator.preExec   // PreExecEvaluator — 执行前评估
aos.evaluator.runtime   // RuntimeEvaluator — 执行中评估
aos.evaluator.postExec  // PostExecEvaluator — 执行后评估
aos.evaluator.feedback  // ImplicitFeedbackEngine — 隐性反馈
aos.evaluator.profiler  // AgentProfiler — 质量画像
```

#### `AgentOSAPI` — SDK 协议层

```typescript
import { AgentOS, AgentOSAPI } from 'sentinel-agentos';

const api = new AgentOSAPI(new AgentOS());

// Guard
api.guardRegisterRule({ tool: 'exec', required: ['command'] });
api.guardRegisterRules([...]);
api.guardEvaluateRisk('exec', { command: 'rm -rf /' });
api.guardSetRiskThresholds({ autoApprove: 0.5, deny: 6.0 });

// Pipeline
const result = await api.pipelineExecute({
  sessionId: 's1', agentId: 'a1',
  toolName: 'write_file',
  toolParameters: { path: 'src/main.ts', content: 'hello' },
});
const complete = api.pipelineComplete({...});

// Memory
api.memorySetPreference('language', 'zh-CN');
api.memoryGetPreference('language');  // → 'zh-CN'
api.memoryLearnRule('提交前 npm test', 'session_1');
api.memoryDefineTerm('PEP', 'Python Enhancement Proposal');
api.memorySetProjectContext('my-app', { description: '...', techStack: ['React', 'Node'] });
api.memoryInjectContext();  // → 启动注入文本
api.memoryAddMessage('user', 'Hello');
api.memoryRecordEvent('decision', 'Chose approach A', ['architecture'], []);

// Audit
api.auditQuery({ toolName: 'exec', limit: 10 });
api.auditQuery({ minScore: 3.0 });  // 高风险操作
api.auditStats();

// Feedback
api.recordFeedback('user_explicit_approval', 's1');
api.getSatisfaction();           // → 82 (0-100)
api.getSatisfaction('s1', 24);   // 最近 24 小时
api.feedbackStats();

// Profile
api.getProfile();
api.getProfile('s1');
api.getStatusReport();
api.getSessionOverview();

// Session
api.endSession('s1');
```

**AgentOSAPI 完整方法清单（25 个）**：

| 方法 | 说明 |
|------|------|
| `guardRegisterRule(rule)` | 注册单条 Schema 规则 |
| `guardRegisterRules(rules)` | 批量注册 Schema 规则 |
| `guardHasRule(toolName)` | 检查工具是否有规则 |
| `guardGetRules()` | 获取所有已注册规则 |
| `guardEvaluateRisk(tool, params)` | 评估风险评分 |
| `guardSetRiskThresholds(thresholds)` | 设置风险阈值 |
| `pipelineExecute(params)` | 执行前校验流水线 |
| `pipelineComplete(params)` | 执行后验证流水线 |
| `memoryInjectContext()` | 注入记忆上下文 |
| `memoryAddMessage(role, content)` | 添加工作记忆消息 |
| `memorySetTask(task)` | 设置当前任务 |
| `memoryCacheResult(tool, result)` | 缓存工具结果 |
| `memoryRecordEvent(type, content, tags, entities)` | 记录情景事件 |
| `memorySetPreference(key, value)` | 设置用户偏好 |
| `memoryGetPreference(key)` | 获取用户偏好 |
| `memoryLearnRule(rule, source)` | 学习规则 |
| `memoryDefineTerm(term, meaning)` | 定义术语 |
| `memorySetProjectContext(name, context)` | 设置项目上下文 |
| `auditQuery(filter)` | 查询审计日志 |
| `auditStats()` | 审计统计 |
| `recordFeedback(signal, sessionId)` | 记录反馈 |
| `getSatisfaction(sessionId?, hours?)` | 获取满意度 |
| `feedbackStats()` | 反馈统计 |
| `getProfile(sessionId?)` | 获取质量画像 |
| `getStatusReport()` | 获取状态报告 |
| `getSessionOverview()` | 获取 session 概况 |
| `endSession(sessionId)` | 结束 session |

---

### HTTP API 接口

基础 URL：`http://localhost:3300`（默认）

#### Request/Response 通用格式

- **Content-Type**：`application/json`
- **鉴权**：除 `/health` 外，`Authorization: Bearer <token>`
- **成功**：`200 OK`，JSON body
- **鉴权失败**：`401 Unauthorized`
- **参数错误**：`400 Bad Request`，`{"error":"..."}`
- **服务错误**：`500 Internal Server Error`

#### 端点详情

##### `GET /health` — 健康检查（免 Token）

```bash
curl http://localhost:3300/health
# → {"ok":true,"uptime":12.3}
```

##### `POST /pipeline/pre` — 执行前校验

```bash
curl -X POST http://localhost:3300/pipeline/pre \
  -H "Authorization: Bearer ***" \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "s1",
    "agentId": "main",
    "toolName": "exec",
    "parameters": {"command": "npm test"},
    "affectedFiles": []
  }'
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `toolName` | string | ✅ | 工具名 |
| `sessionId` | string | ❌ | 默认 `"http_session"` |
| `agentId` | string | ❌ | 默认 `"http_agent"` |
| `parameters` | object | ❌ | 工具参数，默认 `{}` |
| `affectedFiles` | string[] | ❌ | 受影响的文件列表 |

**返回**：

```json
{
  "preExec": {
    "schemaCheck": { "pass": true, "errors": [] },
    "riskScore": { "score": 0.19, "action": "auto", "dimensions": {...} },
    "paramQuality": { "score": 85, "observations": [] },
    "contextUtilization": { "score": 70, "patterns": [] }
  },
  "snapshot": { "id": "...", "fileHashes": {...}, "gitHead": "...", "gitDirty": false },
  "profile": { "overallScore": 85, ... }
}
```

##### `POST /pipeline/post` — 执行后验证

```bash
curl -X POST http://localhost:3300/pipeline/post \
  -H "Authorization: Bearer ***" \
  -H "Content-Type: application/json" \
  -d '{
    "toolName": "exec",
    "toolParameters": {"command": "npm test"},
    "toolResult": "all passed",
    "snapshot": {...},
    "startTime": 1718123456000,
    "endTime": 1718123457000,
    "retryCount": 0,
    "wasSelfCorrected": false,
    "hadTimeout": false,
    "userAccepted": true,
    "userProvidedEdit": false,
    "resultWasUsed": true
  }'
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `toolName` | string | ✅ | 工具名 |
| `sessionId` | string | ❌ | session 标识 |
| `agentId` | string | ❌ | agent 标识 |
| `toolParameters` | object | ❌ | 执行时的参数 |
| `toolResult` | any | ❌ | 工具返回结果 |
| `snapshot` | object | ❌ | 从 `/pipeline/pre` 获取的 snapshot |
| `startTime` | number | ❌ | 执行开始时间戳 ms |
| `endTime` | number | ❌ | 执行结束时间戳 ms |
| `retryCount` | number | ❌ | 重试次数，默认 0 |
| `wasSelfCorrected` | boolean | ❌ | Agent 是否自我纠正 |
| `hadTimeout` | boolean | ❌ | 是否超时 |
| `userAccepted` | boolean | ❌ | 用户是否接受了结果 |
| `userProvidedEdit` | boolean | ❌ | 用户是否修改了结果 |
| `resultWasUsed` | boolean | ❌ | 用户是否使用了结果 |

##### `GET /pipeline/report` / `GET /pipeline/profile`

```bash
curl -H "Authorization: Bearer ***" http://localhost:3300/pipeline/report
# → {"report":"=== AgentOS Status Report ===\n..."}

curl -H "Authorization: Bearer ***" http://localhost:3300/pipeline/profile
curl -H "Authorization: Bearer ***" "http://localhost:3300/pipeline/profile?sessionId=s1"
```

##### `POST /guard/schema` / `GET /guard/schema`

```bash
# 注册规则
curl -X POST http://localhost:3300/guard/schema \
  -H "Authorization: Bearer ***" \
  -H "Content-Type: application/json" \
  -d '{"tool":"delete_file","required":["path"],"forbidden":[]}'
# → {"ok":true,"tool":"delete_file"}

# 查看规则
curl -H "Authorization: Bearer ***" "http://localhost:3300/guard/schema?tool=delete_file"
```

##### Memory 端点（4 个）

```bash
# 设置偏好
curl -X POST http://localhost:3300/memory/preference \
  -H "Authorization: Bearer ***" -H "Content-Type: application/json" \
  -d '{"key":"language","value":"zh-CN"}'

# 添加事实
curl -X POST http://localhost:3300/memory/fact \
  -H "Authorization: Bearer ***" -H "Content-Type: application/json" \
  -d '{"fact":"用户在北京"}'

# 学习规则
curl -X POST http://localhost:3300/memory/rule \
  -H "Authorization: Bearer ***" -H "Content-Type: application/json" \
  -d '{"rule":"提交前运行 npm test","source":"session_1"}'

# 获取注入上下文
curl -H "Authorization: Bearer ***" http://localhost:3300/memory/context
```

##### `GET /audit` — 审计查询

```bash
curl -H "Authorization: Bearer ***" "http://localhost:3300/audit?limit=10"
curl -H "Authorization: Bearer ***" "http://localhost:3300/audit?toolName=exec&status=FAIL"
```

| 查询参数 | 说明 |
|---------|------|
| `limit` | 返回条数（默认 20） |
| `toolName` | 按工具名过滤 |
| `status` | 按校验状态过滤：`PASS` / `WARN` / `FAIL` |

##### `POST /feedback` — 记录隐性反馈

```bash
curl -X POST http://localhost:3300/feedback \
  -H "Authorization: Bearer ***" -H "Content-Type: application/json" \
  -d '{"signal":"user_explicit_approval","sessionId":"s1"}'
```

**支持的 signal 值**：

| Signal | 强度 | 说明 |
|--------|------|------|
| `user_explicit_approval` | +0.6 | 用户明确说"做得好" |
| `user_immediate_continue` | +0.3 | 用户立即继续对话 |
| `user_used_result` | +0.7 | 用户使用了 Agent 的结果 |
| `user_shared_output` | +0.8 | 用户分享了 Agent 输出 |
| `user_modified_output` | -0.5 | 用户修改了 Agent 输出 |
| `user_deleted_code` | -0.8 | 用户删除了 Agent 创建的代码 |
| `user_interrupted` | -0.6 | 用户打断了 Agent |
| `user_repeated_instruction` | -0.3 | 用户重复了相同指令 |

##### `POST /session/end` — 结束 Session

```bash
curl -X POST http://localhost:3300/session/end \
  -H "Authorization: Bearer ***" -H "Content-Type: application/json" \
  -d '{"sessionId":"s1"}'
# → {"ok":true}
```

---

### 中间件 / 插件接口

#### `wrapAgent` — 一行接入中间件

```typescript
import { wrapAgent } from 'sentinel-agentos';

const sentinel = wrapAgent({ workspaceRoot: process.cwd() });

// 每个工具调用前后调用
const { allowed, reason } = sentinel.preCheck('exec', { command: 'rm -rf /' });
// → { allowed: false, reason: 'Risk 9.18 → DENY' }

const { allowed } = sentinel.preCheck('exec', { command: 'npm test' });
// → { allowed: true }

// 执行后验证
sentinel.postCheck('exec', { command: 'npm test' }, 'all passed');
```

**`wrapAgent` 参数**：

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `workspaceRoot` | string | `process.cwd()` | 工作区根目录 |
| `maxWorkingTokens` | number | `50000` | 工作记忆 token 上限 |
| `preRegisteredRules` | boolean | `false` | 是否使用内置默认规则 |

#### `sentinelPlugin` — OpenClaw 插件

```typescript
import { sentinelPlugin } from 'sentinel-agentos';

const plugin = sentinelPlugin({
  workspaceRoot: process.cwd(),
  preRegisteredRules: true,
});
// → onBeforeTool → Schema + Risk 校验
// → onAfterTool → Verify + Audit 记录
```

---

### Sandbox 沙箱接口

```typescript
import { SandboxExecutor } from 'sentinel-agentos';

const sandbox = new SandboxExecutor({
  mode: 'sandbox',               // 'direct' | 'sandbox' | 'dry-run'
  workspaceRoot: process.cwd(),
  timeoutMs: 30000,               // 命令超时 30s
  networkAccess: 'whitelist',     // 'none' | 'localhost' | 'whitelist'
  networkWhitelist: ['api.github.com', 'registry.npmjs.org'],
  writablePaths: ['src/', 'tests/', 'dist/'],
  readonlyPaths: ['node_modules/', '.git/'],
  allowedTools: ['read_file', 'write_file', 'edit', 'exec'],
  forbiddenTools: ['rm', 'unlink', 'delete_file'],
});

// 预检
const check = sandbox.validate('exec', { command: 'curl evil.com' });
// → { success: false, sandboxRejectReason: 'Network not in whitelist' }

// 执行
const result = await sandbox.execute('exec', { command: 'npm test' });
// → { success: true, result: {...} }
```

**`SandboxExecutor` 构造参数**：

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `mode` | `'direct' | 'sandbox' | 'dry-run'` | `'sandbox'` | 执行模式 |
| `workspaceRoot` | string | `process.cwd()` | 工作区根目录 |
| `timeoutMs` | number | `30000` | 命令超时毫秒 |
| `networkAccess` | `'none' | 'localhost' | 'whitelist'` | `'localhost'` | 网络策略 |
| `networkWhitelist` | string[] | `[]` | 网络白名单域名 |
| `writablePaths` | string[] | `[]` | 可写路径 |
| `readonlyPaths` | string[] | `[]` | 只读路径 |
| `allowedTools` | string[] | `[]` | 允许的工具 |
| `forbiddenTools` | string[] | `[]` | 禁止的工具 |

**执行模式说明**：

| 模式 | 说明 |
|------|------|
| `direct` | 直接执行，无限制 |
| `sandbox` | 沙箱模式，受限的文件系统和网络访问 |
| `dry-run` | 试运行，不实际执行，只校验权限 |

---

## 📂 源码结构 · Source Layout

```
src/
├── index.ts               # 导出入口 · Exports (30+)
├── core.ts                 # Sentinel AgentOS 主循环 · Main loop
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
