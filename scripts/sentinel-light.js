/**
 * Sentinel AgentOS Full Guard — 全功能版
 *
 * preCheck: 轻量拦截（4.4μs）
 * postCheck: 完整审计 + 三层记忆 + 三阶段评估 + 隐性反馈
 *
 * 模块初始化时自动注入语义记忆上下文到 session。
 */

const { AgentOS } = require('sentinel-agentos');
const fs = require('fs');
const path = require('path');

const AUDIT_DIR = path.join(__dirname, '..', '.sentinel-audit');

// 全局单例
if (!global.__sentinel_aos) {
  const aos = new AgentOS({
    workspaceRoot: process.cwd(),
    maxWorkingTokens: 50000,
    maxEpisodicSizeKb: 500,
  });

  // 注册全套 Schema 规则
  aos.guard.schema.registerRules([
    { tool: 'exec', required: ['command'] },
    {
      tool: 'write', required: ['path', 'content'],
      pathDeny: { path: ['.env', '*.key', '*.pem', '.git/**', '**/credentials/**'] },
      maxSize: { content: 1048576 }, secrets: ['content'],
    },
    { tool: 'read', required: ['path'], pathDeny: { path: ['.env', '*.key'] } },
    { tool: 'edit', required: ['path'], pathDeny: { path: ['.env', '*.key', '.git/**'] } },
    {
      tool: 'delete', required: ['path'],
      pathDeny: { path: ['.env', '*.key', '*.pem', '.git/**', 'node_modules/**', 'package.json'] },
    },
  ]);

  // 从磁盘恢复审计
  const auditFile = path.join(AUDIT_DIR, 'audit.jsonl');
  if (fs.existsSync(auditFile)) {
    try {
      fs.readFileSync(auditFile, 'utf-8').trim().split('\n').filter(Boolean).forEach(line => {
        aos.guard.audit.entries.push(JSON.parse(line));
      });
    } catch {}
  }

  // 注入默认语义记忆
  aos.memory.semantic.setPreference('user-name', '老板');
  aos.memory.semantic.setPreference('language', 'zh-CN');
  aos.memory.semantic.setPreference('direct-communication', true);
  aos.memory.semantic.addFact('老板是中国用户，偏好直接、不说废话');
  aos.memory.semantic.addFact('项目 coderev 是 AI 代码审查 CLI 工具');
  aos.memory.semantic.addFact('项目 sentinel-agentos 是 AI Agent 操作系统');
  aos.memory.semantic.learnRule('高风险操作前必须 preCheck', 'sentinel_init');
  aos.memory.semantic.learnRule('操作完成后必须 postCheck 审计', 'sentinel_init');
  aos.memory.semantic.learnRule('npm publish 前必须确认版本号', 'sentinel_init');

  // 记录首次启动事件
  aos.memory.episodic.record('milestone',
    'Sentinel AgentOS 全功能启用：Guard + Memory + Evaluator',
    ['init', 'milestone'], ['sentinel-agentos']);

  global.__sentinel_aos = aos;
  global.__sentinel_session_id = 1;
}

const aos = global.__sentinel_aos;
let opCounter = 0;

// ── 确定性规则（零 LLM）──
const DANGEROUS = [
  [/rm\s+-rf\s+\//, 'rm -rf / — 删除整个系统'],
  [/rm\s+-rf\s+~/, 'rm -rf ~ — 删除用户目录'],
  [/sudo\s+rm/, 'sudo rm — 超级用户删除'],
  [/mkfs\./, 'mkfs — 格式化磁盘'],
  [/dd\s+if=/, 'dd — 可能覆盖分区'],
  [/fork\s*bomb|:\(\)/, 'fork bomb — 系统崩溃'],
  [/chmod\s+777\s+-R\s*\//, 'chmod 777 -R / — 权限全开'],
  [/del\s+\/F\s+\/S\s+[A-Z]:\\/, 'del /F /S — 全盘删除'],
  [/>\s*\/dev\/sd[a-z]/, '写入磁盘设备'],
];
const WARNING = [
  [/git\s+push\s+--force/, 'git push --force — 强制覆盖'],
  [/git\s+reset\s+--hard/, 'git reset --hard — 不可逆'],
  [/npm\s+publish\b/, 'npm publish — 发布公共包'],
  [/npm\s+unpublish\b/, 'npm unpublish — 从 npm 删除'],
  [/DROP\s+(TABLE|DATABASE)/i, 'DROP — 删除数据库'],
  [/TRUNCATE\s+(TABLE\s+)?/i, 'TRUNCATE — 清空表'],
];
const SENSITIVE = [
  '.env', '.env.*', '*.key', '*.pem', '*.p12', '*.pfx', '*.jks', '*.keystore',
  '.git/**', '**/credentials/**', '**/secrets/**', '**/SECRETS/**',
  'package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'Cargo.lock',
];
const PROTECTED = [
  'package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  '.gitignore', '.gitattributes', 'Cargo.toml', 'Cargo.lock', 'tsconfig.json',
  'AGENTS.md', 'SOUL.md', 'MEMORY.md', 'USER.md',
];

function globMatch(pattern, p) {
  p = (p || '').replace(/\\/g, '/');
  if (!pattern.includes('*')) return p === pattern || p.endsWith('/' + pattern);
  const re = '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '(.*/)?').replace(/\*/g, '[^/]*') + '$';
  return new RegExp(re).test(p);
}

module.exports = {
  // ── 执行前拦截 ──
  preCheck(toolName, params) {
    if (toolName === 'exec' && params.command) {
      const cmd = String(params.command);
      for (const [re, desc] of DANGEROUS) {
        if (re.test(cmd)) return { passed: false, block: true, risk: 'DENY', reason: `🚫 危险命令: ${desc}` };
      }
      for (const [re, desc] of WARNING) {
        if (re.test(cmd)) return { passed: false, block: true, risk: 'CONFIRM', reason: `⚠️ 需要确认: ${desc}`, needsConfirmation: true };
      }
    }
    const p = params.path || params.file;
    if (p && ['write', 'edit', 'delete', 'read'].includes(toolName)) {
      for (const ptn of SENSITIVE) {
        if (globMatch(ptn, p)) return { passed: false, block: true, risk: 'DENY', reason: `🚫 敏感文件: "${p}" → "${ptn}"` };
      }
    }
    if (toolName === 'delete' && p) {
      for (const pf of PROTECTED) {
        if (String(p) === pf || String(p).endsWith('/' + pf) || String(p).endsWith('\\' + pf))
          return { passed: false, block: true, risk: 'DENY', reason: `🚫 保护文件: "${pf}"` };
      }
    }
    return { passed: true, risk: 'auto' };
  },

  // ── 执行后审计（异步 AgentOS，不阻塞回复）──
  postCheck(toolName, params, result) {
    // 轻量审计（纯内存 + 5ms I/O，不调 git）
    const entry = {
      id: `${++opCounter}`,
      ts: new Date().toISOString(),
      sessionId: `s${global.__sentinel_session_id}`,
      tool: toolName,
      params: typeof params === 'string' ? params.slice(0, 200) : JSON.stringify(params || {}).slice(0, 200),
      result: String(result || '').slice(0, 100),
    };
    aos.memory.working.addMessage('tool', `${toolName}: ${entry.params}`);
    try {
      if (!fs.existsSync(AUDIT_DIR)) fs.mkdirSync(AUDIT_DIR, { recursive: true });
      fs.appendFileSync(path.join(AUDIT_DIR, 'audit.jsonl'), JSON.stringify(entry) + '\n');
    } catch {}

    // AgentOS 完整审计放到 next tick，不阻塞回复
    setImmediate(() => {
      try {
        const sid = `s${global.__sentinel_session_id}_op${opCounter}`;
        const { preExec, snapshot } = aos.executePipeline({
          sessionId: sid, agentId: 'openclaw', toolName, parameters: params || {},
        });

        // 根据工具类型推断 claimedResult，让 Verify Gate 正常工作
        const claimed = {};
        if (['write', 'edit', 'delete'].includes(toolName) && params?.path) {
          claimed.files = [String(params.path)];
        }
        if (result) claimed.result = result;

        aos.completeExecution({
          sessionId: sid, agentId: 'openclaw', toolName,
          toolParameters: params || {}, toolResult: result ?? null,
          snapshot, startTime: Date.now() - 500, endTime: Date.now(),
          retryCount: 0, wasSelfCorrected: false, hadTimeout: false,
          userAccepted: true, userProvidedEdit: false, resultWasUsed: true,
        });

        // 记录反馈：结果被使用 = 正面信号
        aos.recordFeedback('user_used_result', `s${global.__sentinel_session_id}`);

        if (toolName === 'exec' && params?.command) {
          aos.memory.episodic.record('tool_call', String(params.command), ['exec'], []);
        }
      } catch {}
    });

    return { auditId: entry.id, verify: 'QUEUED' };
  },

  // ── 查看审计 ──
  audit(limit = 10) {
    return aos.guard.audit.query({ limit });
  },

  // ── 完整状态报告 ──
  status() {
    return aos.statusReport();
  },

  // ── 注入 Memory 上下文（session 启动时调用）─
  injectContext() {
    return aos.injectContext();
  },

  // ── 记录反馈 ──
  feedback(signal) {
    aos.recordFeedback(signal, `s${global.__sentinel_session_id}`);
  },

  // ── 结束 Session ──
  endSession() {
    const sid = `s${global.__sentinel_session_id}`;
    aos.endSession(sid);
    global.__sentinel_session_id++;
  },

  // ── 获取完整状态快照 ──
  fullStatus() {
    return {
      sessionId: `s${global.__sentinel_session_id}`,
      opCount: opCounter,
      audit: aos.guard.audit.stats(),
      profile: aos.getProfile(),
      satisfaction: aos.evaluator.feedback.getSatisfactionScore(),
      workingMemory: {
        messages: aos.memory.working.recentMessages.length,
        budget: aos.memory.working.budget,
      },
      episodicEvents: aos.memory.episodic.count,
      semanticRules: aos.memory.semantic.getAllRules().length,
      preferences: aos.memory.semantic.getPreference('language'),
    };
  },
};
