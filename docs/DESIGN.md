# AgentOS 设计文档

> 版本：v0.1.0-draft
> 状态：设计阶段
> 最后更新：2026-06-09

---

## 目录

1. [产品定位](#1-产品定位)
2. [核心问题分析](#2-核心问题分析)
3. [设计哲学](#3-设计哲学)
4. [Guard 层设计](#4-guard-层设计)
5. [Memory 层设计](#5-memory-层设计)
6. [Evaluator 层设计](#6-evaluator-层设计)
7. [API 设计](#7-api-设计)
8. [数据模型](#8-数据模型)
9. [配置系统](#9-配置系统)

---

## 1. 产品定位

### 一句话描述

**AgentOS = 确定性 Guard 层 + 分层记忆 + 自动评估，让任何 Agent 变得可靠、可审计、可改进。**

### 不是 Agent，是 Agent 的操作系统

| 类比 | 说明 |
|------|------|
| 应用程序 | 任意 Agent（OpenClaw / LangChain / CrewAI / 自研） |
| 操作系统 | AgentOS（Guard + Memory + Evaluator） |
| 内核 | Schema Gate + Risk Gate（确定性代码，零 LLM 依赖） |
| 文件系统 | 分层 Memory Store（Working / Episodic / Semantic） |
| 日志系统 | 操作级审计日志（不可篡改，支持回滚） |
| 性能监控 | Evaluator（三阶段评估 + 隐性反馈捕获） |

### 解决什么

| 痛点 | AgentOS 方案 | 核心思路 |
|------|-------------|---------|
| Agent 幻觉导致错误操作 | Guard 层的 Schema Gate + Verify Gate | 确定性校验，不依赖 LLM 判断 |
| Agent 越权/危险操作 | Guard 层的 Risk Gate（四维风险评分） | 纯数学公式，0-100 分自动分级 |
| Agent 记不住、记不对 | Memory 层的事件驱动自动记录 + 分层存储 | 不是 RAG，是真记忆架构 |
| 出事了查不到原因 | Guard 层的操作级审计日志 | 每次 tool call 前后 diff，不可篡改 |
| 不知道 Agent 好不好 | Evaluator 的三阶段评估 + 隐性反馈 | 不止看结果，看过程 |

### 目标用户

| 阶段 | 用户 | 场景 |
|------|------|------|
| MVP | 开发者 | 自部署 SDK，接入自己的 Agent |
| v1.0 | 团队 | 团队级 Dashboard，共享 Guard Rules |
| v2.0 | 企业 | SaaS 云端，企业级审计合规 |

---

## 2. 核心问题分析

### 2.1 为什么现有方案都不行

#### LangChain/LlamaIndex 的 Memory
```
❌ 本质是「把对话历史扔进向量库」——只有检索，没有理解
❌ 缺乏分层：所有记忆一视同仁，不区分重要性
❌ 无遗忘机制：记忆无限膨胀，检索精度指数级下降
❌ Agent 需要手动管理记忆 → 又回到「agent 自己能记住」的悖论
```

#### CrewAI/AutoGPT 的安全
```
❌ 安全靠 prompt："请不要删除重要文件" — 这是愿望，不是约束
❌ 无审计：agent 做了什么、为什么做、做对了没，全不可追溯
❌ 无回滚：出事了只能手动 git reset
```

#### 所有 Agent 框架的评估
```
❌ 不存在。没有框架做 agent 的自动化评估
❌ 最多有个 "success rate" 计数器，不分析为什么会失败
❌ 完全不捕捉用户的隐性反馈信号
```

### 2.2 为什么 Guard 层是地基

```
可靠性（痛点一）：Guard 拦截幻觉操作 → 前端过滤，不靠 LLM
工具调用（痛点二）：Schema Gate 校验参数 → 格式错误在第一步就拦截
记忆（痛点三）：Guard 日志 = 精确事件源 → 记忆建立在准确数据上
安全（痛点四）：Risk Gate 分级 → 从愿望变成物理约束
评估（痛点五）：Guard 日志 + Verify 结果 → 评估有真实数据基础
```

**Guard 层的操作日志是其他所有模块的数据基础。**

---

## 3. 设计哲学

### 3.1 三条铁律

| 原则 | 含义 | 反例 |
|------|------|------|
| **确定性优先** | 能不用 LLM 就不用的功能，必须用确定性代码实现 | 用 LLM 做安全判断（如 Anthropic safety） |
| **可审计性优先** | 所有操作必须可追溯、可回滚、可解释 | agent 操作后无日志，出事查不到 |
| **渐进增强** | 框架无关，可增量接入。不要求替换现有 Agent 架构 | LangChain 的强绑定 |

### 3.2 边界定义

AgentOS **不做**：
- ❌ 不替代 Agent 框架（OpenClaw/LangChain/CrewAI）
- ❌ 不替代 LLM（不训练模型）
- ❌ 不替代编排（不决定 agent 做什么任务）
- ❌ 不提供 UI（SDK + API，不做前端）

AgentOS **只做**：
- ✅ 拦截 tool call → 校验 + 分级
- ✅ 记录操作 → 事件采集 + 分层存储
- ✅ 评估质量 → 收集指标 + 隐性反馈
- ✅ 暴露 API → 查询、回滚、分析

### 3.3 为什么不做 UI

UI 是消费端的事。AgentOS 是基础设施——基础设施不需要好看，需要可靠。JSON API + SDK 就够了。Dashboard 是 v2.0 的事。

---

## 4. Guard 层设计

### 4.1 整体流程

```
┌─────────────────────────────────────────────────────────┐
│                    GUARD PIPELINE                        │
│                                                          │
│  Tool Call ──→ [1.Schema Gate] ──→ [2.Risk Gate]        │
│                    │     ▲              │     ▲          │
│                    ▼     │              ▼     │          │
│               FAIL: 拒绝  │         ┌──────────────┐    │
│                          │         │ Risk Score    │    │
│               PASS: 继续 ─┘         │ 0-30: 放行    │    │
│                                     │ 30-60: 通知   │    │
│                                     │ 60-85: 确认   │    │
│                                     │ 85+:  拒绝    │    │
│                                     └──────┬───────┘    │
│                                            ▼             │
│              ──→ [3.Snapshot] ──→ [4.Execute]            │
│                                            │             │
│                                            ▼             │
│              ──→ [5.Verify] ──→ [6.Audit Log]            │
│                    │    ▲                   │             │
│                    ▼    │                   ▼             │
│               FAIL: 触发回滚          不可篡改日志         │
│               PASS: 完成                                  │
└─────────────────────────────────────────────────────────┘
```

### 4.2 第一 Gate：Schema Gate（确定性，零 LLM）

**职责**：校验 tool call 参数的格式和约束，在执行前拦截无效调用。

**为什么不用 LLM**：Schema 校验是纯工程问题——JSON Schema 校验、类型检查、范围检查——这些 LLM 反而做不好（会幻觉）。

**校验项**：

| 校验项 | 实现 | 示例 |
|--------|------|------|
| 必填参数 | JSON Schema `required` | `delete_file` 必须提供 `path` |
| 参数类型 | JSON Schema `type` | `path` 必须是 `string` |
| 数值范围 | JSON Schema `minimum`/`maximum` | `max_tokens` 必须在 1-100000 |
| 枚举值 | JSON Schema `enum` | `mode` 只能是 `read`/`write`/`append` |
| 路径约束 | 自定义 validator | `path` 必须在 workspace 内，不能是系统目录 |
| 正则约束 | JSON Schema `pattern` | `branch_name` 必须符合 git branch 命名规则 |
| 依赖约束 | 自定义 validator | 如果 `auto_merge=true`，则 `base_branch` 必填 |
| 互斥约束 | 自定义 validator | `content` 和 `file_path` 不能同时存在 |

**扩展 Schema 格式**（在标准 JSON Schema 基础上加 `x-` 扩展）：

```json
{
  "name": "write_file",
  "description": "Write content to a file",
  "parameters": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "File path",
        "x-path-scope": "workspace",
        "x-path-allow": ["*.ts", "*.js", "*.json", "*.md", "*.yaml", "*.yml", "*.css", "*.html"],
        "x-path-deny": [".git/**", "node_modules/**", ".env", "*.key", "*.pem"]
      },
      "content": {
        "type": "string",
        "description": "File content",
        "x-max-size": 1048576
      }
    },
    "required": ["path", "content"]
  }
}
```

**`x-` 扩展字段说明**：

| 扩展字段 | 用途 | 示例值 |
|----------|------|--------|
| `x-path-scope` | 路径约束范围 | `workspace` / `temp` / `global` |
| `x-path-allow` | 允许的路径模式 | `["*.ts", "src/**"]` |
| `x-path-deny` | 禁止的路径模式 | `[".git/**", "*.key"]` |
| `x-max-size` | 参数值最大大小（字节） | `1048576` |
| `x-secret` | 标记为敏感参数（日志中脱敏） | `true` |
| `x-depends-on` | 参数间依赖关系 | `{"auto_merge": {"required": ["base_branch"]}}` |
| `x-mutually-exclusive` | 互斥参数组 | `[["content", "file_path"]]` |

### 4.3 第二 Gate：Risk Gate（确定性，纯数学）

**职责**：对通过 Schema Gate 的操作计算风险评分，按阈值分级处理。

**为什么不用 LLM**：风险评估可以用一个明确的公式——影响范围 × 不可逆性 × 数据敏感度 × 历史错误率。这是一个乘法模型，不需要任何 AI。

**风险公式**：

```
RiskScore = Impact × (1 - Reversibility) × Sensitivity × (1 + ErrorRate)

其中：
  Impact ∈ {1, 3, 6, 10}     — 影响范围（离散分级）
  Reversibility ∈ [0, 1]      — 可逆程度（连续值）
  Sensitivity ∈ [0, 1]        — 数据敏感度（连续值）
  ErrorRate ∈ [0, ∞)          — 该工具的历史错误率（连续值）

RiskScore 范围：理论上 [0, ∞)，实际绝大多数在 [0, 15]
```

**各维度的计算**：

#### Impact（影响范围）

| 级别 | 值 | 定义 | 示例 |
|------|----|------|------|
| local | 1 | 只影响单个临时文件或进程内存 | 读文件、搜索、内存计算 |
| workspace | 3 | 影响工作区文件 | 写文件、git commit |
| project | 6 | 影响整个项目 | npm publish、git push、删除目录 |
| system | 10 | 影响系统或外部 | 修改系统配置、sudo、发送外部 HTTP 请求到生产环境 |

#### Reversibility（可逆程度）

| 值 | 含义 | 示例 |
|----|------|------|
| 1.0 | 完全可逆，无副作用 | 读文件、搜索 |
| 0.8 | 可逆但有轻微残留 | 写文件（git 可回滚） |
| 0.5 | 半可逆，需要手动操作才能回滚 | git push（可 force push 但影响别人） |
| 0.2 | 基本不可逆 | npm publish（可 unpublish 但有时间窗口） |
| 0.0 | 完全不可逆 | 删除远程数据库、发送 email |

#### Sensitivity（数据敏感度）

| 值 | 含义 | 示例 |
|----|------|------|
| 0.0 | 非敏感 | 公开代码、README、日志 |
| 0.3 | 低敏感 | 项目配置、构建脚本 |
| 0.6 | 中敏感 | 业务逻辑代码、API 配置 |
| 0.9 | 高敏感 | .env、密钥、用户数据、数据库连接串 |
| 1.0 | 极高敏感 | 生产环境凭证、客户 PII |

#### ErrorRate（历史错误率）

```
ErrorRate = 该工具过去失败次数 / 该工具过去总调用次数

初始值（冷启动）：使用工具的默认风险分类：
  - 只读类工具：0.01（默认低风险）
  - 写入类工具：0.05（默认中风险）
  - 删除类工具：0.10（默认高风险）
  - 网络类工具：0.08（默认中高风险）

随使用动态更新。错误率上升 → 风险分数上升 → 更多操作需要确认。
```

**风险分数示例**：

| 操作 | Impact | Rev. | Sens. | ErrRate | 分数 | 动作 |
|------|--------|------|-------|---------|------|------|
| read_file | 1 | 1.0 | 0.0 | 0.01 | 0.00 | 放行 |
| web_search | 1 | 1.0 | 0.3 | 0.02 | 0.00 | 放行 |
| write_file(src/*.ts) | 3 | 0.8 | 0.3 | 0.05 | 0.19 | 放行 |
| git_commit | 3 | 0.7 | 0.2 | 0.03 | 0.19 | 放行 |
| git_push | 6 | 0.5 | 0.3 | 0.04 | 0.94 | 通知 |
| npm_publish | 8 | 0.2 | 0.5 | 0.06 | 3.39 | 确认 |
| delete_file(workspace) | 3 | 0.3 | 0.3 | 0.05 | 0.66 | 通知 |
| delete_dir(workspace) | 6 | 0.2 | 0.6 | 0.08 | 3.11 | 确认 |
| write_file(.env) | 3 | 0.8 | 0.9 | 0.05 | 0.57 | 通知 |
| shell_rm_rf | 10 | 0.0 | 0.9 | 0.02 | 9.18 | **拒绝** |
| send_email | 8 | 0.0 | 0.9 | 0.05 | 7.56 | **拒绝** |
| delete_prod_db | 10 | 0.0 | 1.0 | 0.01 | 10.10 | **拒绝** |

**阈值可配置**：

```yaml
guard:
  risk:
    auto_approve: 0.5     # ≤ 0.5 → 自动放行
    notify: 1.0           # ≤ 1.0 → 执行后通知用户
    confirm: 3.0          # ≤ 3.0 → 暂停等待用户确认
    deny: 8.0             # > 8.0 → 直接拒绝
    # （notify 和 confirm 之间的：放行但通知）
```

### 4.4 第三阶段：Snapshot（执行前快照）

**职责**：在操作执行前记录当前状态，为 Verify 和 Rollback 提供基准。

**为什么是快照不是备份**：全量备份太慢（100MB+ 的项目），快照只需记录**关键状态的 hash**。

**快照内容**：

```typescript
interface Snapshot {
  id: string;                    // UUID
  toolCallId: string;            // 关联的 tool call
  timestamp: number;             // Unix ms
  scope: SnapshotScope;          // 快照范围

  // 文件状态（只记录 hash，不复制内容）
  fileHashes: Record<string, string>;  // path → sha256
  // 仅记录本次操作涉及的文件的 path→hash 映射
  // 例：write_file('src/main.ts') →
  //   { "src/main.ts": "sha256:abc123..." }

  // 环境状态
  envVars: Record<string, string>;    // 相关环境变量

  // Git 状态
  gitHead: string;                     // git rev-parse HEAD
  gitDirty: boolean;                   // working tree 是否有未提交变更
}
```

**快照策略**：

| 场景 | 策略 | 原因 |
|------|------|------|
| 单文件修改 | 只 hash 被修改的文件 | 节省时间 |
| 批量文件修改 | hash 所有涉及文件 | 需要知道改了哪些 |
| 危险操作（Risk > 3.0） | hash 整个 workspace | 确保完整回滚 |
| 删除操作 | hash 目标 + 记录文件内容 | 回滚=恢复内容 |

### 4.5 第四阶段：Execute（执行层，可选沙箱）

**职责**：在受控环境中执行 tool call。

AgentOS 不强制沙箱，但提供可选能力：

```typescript
interface ExecutionContext {
  // 默认：直接执行（与 Agent 框架共享环境）
  mode: 'direct' | 'sandbox' | 'dry-run';

  // 超时
  timeoutMs: number;  // 默认 30000

  // 网络策略（sandbox 模式）
  networkAccess?: 'none' | 'localhost' | 'whitelist';
  networkWhitelist?: string[];

  // 文件系统（sandbox 模式）
  writablePaths?: string[];
  readonlyPaths?: string[];
}
```

### 4.6 第五 Gate：Verify Gate（确定性，零 LLM）

**职责**：执行后校验结果，检测幻觉和错误。

**为什么不用 LLM**：判断"文件改了吗""lint 过了吗"是确定性工程问题，不需要 AI。

**校验项**：

| 校验项 | 触发条件 | 判定标准 | 失败处理 |
|--------|---------|---------|---------|
| 文件存在性 | 工具声称创建/修改了文件 | `fs.existsSync(path)` | 幻觉！标记 FAIL |
| 文件变更 | 工具声称修改了文件 | 对比 Snapshot 的 hash，hash 是否变了 | 未变更→标记 FAIL |
| Lint 通过 | 工具修改了代码文件 | `npx eslint --quiet` | 未通过→标记 WARN |
| TypeCheck | 工具修改了 TypeScript 文件 | `npx tsc --noEmit` | 未通过→标记 WARN |
| 格式合法 | 工具声称返回 JSON | `JSON.parse(result)` | 格式错误→标记 FAIL |
| 返回值非空 | 工具应返回内容但返回空 | `result.length > 0` | 空结果→标记 WARN |
| npm 发布 | 工具声称发布了 npm 包 | `npm view <pkg> version` | 未发布→标记 FAIL（幻觉！） |
| git push | 工具声称推送成功 | `git ls-remote origin <branch>` | 未推送→标记 FAIL |

**验证结果分级**：

```
PASS  — 所有校验项通过，结果有效
WARN  — 有非关键警告（如 lint 未通过但代码确实改了）
FAIL  — 关键校验失败（文件没改 / 发布失败但声称成功）
      → 触发 Audit Log（标记为可信度低）
      → 触发 Rollback（如果 Risk > 阈值）
```

### 4.7 第六阶段：Audit Log（不可篡改）

**职责**：记录每一次操作的完整信息，包括执行前后的状态对比。

**日志结构**：

```typescript
interface AuditEntry {
  // 标识
  id: string;                    // UUID
  sessionId: string;             // 哪个会话
  agentId: string;               // 哪个 agent

  // 时间
  startedAt: number;             // Unix ms
  completedAt: number;           // Unix ms
  durationMs: number;            // 耗时

  // 操作
  toolName: string;              // 工具名
  toolParameters: Record<string, unknown>;  // 参数（敏感参数脱敏）
  toolResult: unknown;           // 结果（超长截断）

  // Guard 结果
  schemaGate: { pass: boolean; errors?: SchemaError[] };
  riskGate: { score: number; action: 'auto' | 'notify' | 'confirm' | 'deny' };
  snapshot: Snapshot | null;
  verifyGate: { status: 'PASS' | 'WARN' | 'FAIL'; checks: VerifyCheck[] };

  // 变更追踪
  diff: {
    filesChanged: string[];      // 哪些文件变了
    linesAdded: number;          // 增加行数
    linesRemoved: number;        // 删除行数
    hashBefore: Record<string, string>;  // 变更前 hash
    hashAfter: Record<string, string>;   // 变更后 hash
  } | null;

  // 回滚信息
  rollback?: {
    rolledBack: boolean;         // 是否触发了回滚
    rollbackSnapshotId: string;  // 回滚到的快照 ID
    success: boolean;            // 回滚是否成功
  };
}
```

**不可篡改的实现**：

```
方案一（MVP）：追加写入 JSONL 文件，文件设置为只读
方案二（v1.0）：写入本地 SQLite，WAL 模式，无 DELETE 权限
方案三（v2.0）：远端写入 append-only log service
```

### 4.8 Rollback（回滚到快照）

**触发条件**：
1. Verify Gate 返回 FAIL 且 Risk > confirm 阈值
2. 用户手动触发回滚

**回滚过程**：

```
1. 从 Audit Log 找到该操作的 Snapshot
2. 对比 Snapshot.fileHashes 与当前文件状态
3. 对每个被修改的文件：
   a. 如果 git 可回滚 → git checkout <file> 从 HEAD 恢复
   b. 如果有 Snapshot 内容 → 从 Snapshot 恢复（删除类操作）
   c. 如果 Snapshot 中有完整内容 → 写回原始内容
4. 记录回滚日志
5. 返回回滚报告
```

---

## 5. Memory 层设计

### 5.1 核心理念：像人脑一样记忆

```
人类记忆模型：
  - 工作记忆（Working Memory）  → 当前对话、几秒钟内的事
  - 情景记忆（Episodic Memory） → 昨天发生了什么、关键决策
  - 语义记忆（Semantic Memory） → 学到的知识、规则、偏好

AgentOS 记忆模型（一一对应）：
  - Working Memory  → 当前 session 的对话+操作日志（Guard 提供）
  - Episodic Memory → 过去 session 的事件时间线（自动压缩）
  - Semantic Memory → 提炼后的知识、用户偏好、项目元信息
```

### 5.2 三层架构详解

```
┌─────────────────────────────────────────────────────┐
│ Session 启动                                         │
│     ↓                                                │
│ ┌───────────┐    ┌───────────┐    ┌───────────────┐ │
│ │ Working   │    │ Episodic  │    │ Semantic      │ │
│ │ Memory    │ →  │ Memory    │ →  │ Memory        │ │
│ │           │    │           │    │               │ │
│ │ 当前对话   │    │ 过去事件   │    │ 提炼的知识     │ │
│ │ 工具返回   │    │ 决策记录   │    │ 用户偏好       │ │
│ │ 临时状态   │    │ 失败教训   │    │ 项目元信息     │ │
│ │           │    │           │    │               │ │
│ │ 存活：    │    │ 存活：     │    │ 存活：         │ │
│ │ 1 session │    │ 数周-数月  │    │ 永久           │ │
│ │           │    │           │    │               │ │
│ │ 大小：    │    │ 大小：     │    │ 大小：         │ │
│ │ < 50KB    │    │ < 500KB    │    │ < 100KB       │ │
│ └─────┬─────┘    └─────┬─────┘    └───────┬───────┘ │
│       │                │                  │         │
│       └────── 自动流转 ─┘────── 自动流转 ──┘         │
│                                                     │
│                    遗忘机制                           │
│  ┌─────────────────────────────────────────────┐    │
│  │ 不重要的事件 → 摘要压缩 → 一句话 → 遗忘      │    │
│  │ 重要事件 → 保留详情                           │    │
│  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

### 5.3 Working Memory（工作记忆）

**用途**：当前 session 的实时上下文。

**数据来源**：Guard 层的 Audit Log（自动）、LLM 输出（自动）、用户输入（自动）。

**数据结构**：

```typescript
interface WorkingMemory {
  sessionId: string;

  // 对话摘要（滚动窗口，保持最近 N 轮）
  recentMessages: Array<{
    role: 'user' | 'agent' | 'tool';
    content: string;         // 摘要后的内容
    timestamp: number;
  }>;

  // 当前任务
  currentTask?: {
    description: string;
    steps: Array<{ step: string; status: 'pending' | 'in_progress' | 'done' }>;
  };

  // 最近的 tool call 结果（缓存，避免重复调用）
  recentToolResults: Map<string, {
    toolName: string;
    result: unknown;
    timestamp: number;
  }>;

  // 临时文件引用
  openFiles: string[];

  // 上下文预算
  budget: {
    used: number;     // 已用 token
    limit: number;    // 总 token 限制（从模型配置读取）
  };
}
```

**关键行为**：
- session 结束时自动清空
- 重要信息在清空前自动升级到 Episodic Memory
- 超过上下文预算时自动压缩旧消息

### 5.4 Episodic Memory（情景记忆）

**用途**：跨 session 的事件记录——"上周三发生了什么"。

**数据来源**：Working Memory 中标记为重要的内容 + Guard 层的关键操作日志。

**事件类型**：

```typescript
interface EpisodicEvent {
  id: string;
  timestamp: number;
  type: EventType;
  importance: number;       // 0-1，自动评分
  compression: 'full' | 'summary' | 'one-liner' | 'forgotten';
  content: string;          // 原始或压缩后的内容
  tags: string[];           // 自动提取的标签
  relatedEntities: string[]; // 关联的实体（项目、文件、人）
}

type EventType =
  | 'tool_call'       // Guard 记录的 tool call
  | 'tool_failure'    // tool call 失败
  | 'decision'        // 人类做出决策
  | 'correction'      // 人类纠正 agent
  | 'publish'         // 发布/部署
  | 'error'           // 系统错误
  | 'milestone'       // 里程碑
  | 'note'            // agent 主动记录的备注
  | 'user_feedback';  // 用户显式反馈
```

**重要性自动评分**：

```
Importance = BaseImportance × RecencyBoost × FrequencyBoost × FeedbackBoost

BaseImportance（基于事件类型）：
  - tool_call:       0.2
  - tool_failure:    0.6
  - decision:        0.8
  - correction:      0.9  ← 人类纠正：最高优先级
  - publish:         0.7
  - error:           0.7
  - milestone:       0.8
  - note:            0.3
  - user_feedback:   0.8

RecencyBoost:
  Boost = 1.0 + max(0, 1.0 - ageInDays / 30)
  越新越重要，30天后不再加成

FrequencyBoost:
  同一标签的事件每多一次 +0.1（最多 +0.5）
  频繁重复说明重要

FeedbackBoost:
  用户说"记住这个" → +0.3
  用户纠正了 → +0.5
```

**压缩策略**：

```
事件创建时：compression = 'full'（保留完整内容）

压缩触发条件：Episodic Memory 总大小超过阈值（默认 500KB）

压缩过程（从旧到新）：
  full → summary:    重要性 < 0.3 且 > 7天 → 调用 LLM 摘要
  summary → one-liner: 重要性 < 0.2 且 > 30天 → 一句话
  one-liner → forgotten: 重要性 < 0.1 且 > 90天 → 删除

重要事件（importance > 0.7）永不压缩，永久保留 full。
```

### 5.5 Semantic Memory（语义记忆）

**用途**：从情景记忆中提炼出的持久知识。

**数据来源**：Episodic Memory 的定期提炼 + 用户显式告诉 agent 的事。

**结构**：

```typescript
interface SemanticMemory {
  // 用户信息
  userPreferences: Record<string, unknown>;  // key-value 偏好
  userFacts: string[];                        // 关于用户的事实

  // 项目知识
  projectContext: {
    [projectName: string]: {
      description: string;
      techStack: string[];
      conventions: string[];    // 编码规范
      architecture: string;     // 架构描述
      knownIssues: string[];    // 已知问题
    };
  };

  // 全局知识
  learnedRules: Array<{
    rule: string;               // "发布 npm 前必须更新 CHANGELOG"
    confidence: number;         // 0-1，通过重复确认提高
    source: string[];           // 从哪些事件中提炼的
  }>;

  // 术语表
  glossary: Record<string, string>;  // 项目特定术语 → 含义
}
```

**更新机制**：

```
Episodic Memory 中：
  - 同一类 correction 出现 3 次以上 → 提炼为 learnedRule
  - 同一种偏好被表达 2 次以上 → 写入 userPreferences
  - 新的项目术语出现 → 写入 glossary（agent 可主动询问确认）
```

### 5.6 Session 启动时的上下文注入

AgentOS 的核心价值之一：**新 session 启动时，自动注入最相关的上下文**。

```
Session 启动
    ↓
1. 从 Semantic Memory 加载：
   - 用户偏好
   - 当前项目信息
   - 最近学到的规则
    ↓
2. 从 Episodic Memory 加载：
   - 最近 7 天的高重要性事件
   - 当前项目的上一个 milestone
   - 最近的 correction（确保不再犯）
    ↓
3. 构建注入 prompt：
   自动生成一段上下文摘要，注入到 session 的 system prompt 中
    ↓
4. 注入格式示例：
   [AgentOS Memory Context]
   你正在帮助用户"老板"处理项目"coderev"。
   上次会话中你们讨论了 Guard 层的设计方案。
   关键提醒：
   - 老板偏好直接、不说废话的沟通方式
   - 发布 npm 前必须更新 CHANGELOG.md
   - 上次你犯了 X 错误，老板纠正为 Y
   最近事件：
   - 2026-06-04: 配置崩溃问题修复，三层防护上线
   - 2026-06-05: coderev v1.0.24 发布
   [/AgentOS Memory Context]
```

---

## 6. Evaluator 层设计

### 6.1 核心理念：评估是自动的，不是事后总结

大多数 agent 框架的"评估"是：做完任务，人工看结果。
AgentOS 的评估是：**每个操作自动打分，累积成 agent 的质量画像。**

### 6.2 三阶段评估

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ Pre-exec     │    │ Runtime      │    │ Post-exec    │
│ 执行前评估    │ →  │ 执行中评估    │ →  │ 执行后评估    │
├──────────────┤    ├──────────────┤    ├──────────────┤
│ Schema 校验   │    │ 是否重试     │    │ 用户接受度    │
│ Risk 分级    │    │ 重试次数     │    │ 结果正确性    │
│ 参数合理性    │    │ 修正行为     │    │ 对话延续性    │
│ 上下文利用    │    │ 超时情况     │    │ 隐性反馈     │
└──────────────┘    └──────────────┘    └──────────────┘
```

#### Pre-exec（执行前评估）

| 指标 | 说明 | 数据源 |
|------|------|--------|
| schema_pass_rate | Schema Gate 通过率 | Guard |
| risk_distribution | 风险分数分布 | Guard |
| param_quality | 参数是否使用了上下文中的信息 | Memory |

#### Runtime（执行中评估）

| 指标 | 说明 | 数据源 |
|------|------|--------|
| retry_rate | 是否需要重试 | Guard |
| self_correction | agent 是否自己发现错误并修正 | Audit Log |
| timeout_rate | 操作是否超时 | Guard/Execute |
| tool_selection_accuracy | 是否选对工具（对比同场景历史） | Audit Log |

#### Post-exec（执行后评估）

| 指标 | 说明 | 数据源 |
|------|------|--------|
| verify_pass_rate | Verify Gate 通过率 | Guard |
| user_acceptance | 用户接受了还是改了 | 隐性反馈分析 |
| result_utilization | agent 后续是否使用了这个结果 | Working Memory |
| task_completion | 任务是否完成 | 人工标记 or 自动推断 |

### 6.3 隐性反馈捕获（核心差异点）

**为什么隐性反馈重要**：

| 显性反馈 | 问题 | 隐性反馈 | 优势 |
|----------|------|----------|------|
| "好的谢谢" | 可能是礼貌 | 用户立即继续发言 | 说明真的懂了 |
| "不对" | 太晚，已经做错了 | 用户删除了 agent 创建的代码 | 即时发现 |
| 用户不回复 | 不知道是满意还是没看 | 用户修改了 agent 的输出 | 精确的不满意信号 |
| 用户点赞 | 太粗粒度 | 用户重复了相同的指令 | agent 第一次没做对 |

**捕获机制**：

```typescript
interface ImplicitFeedback {
  // 信号类型
  signal: SignalType;

  // 信号强度 (-1.0 ~ +1.0)
  strength: number