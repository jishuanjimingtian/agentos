/**
 * Sentinel AgentOS Guard — 完整版
 *
 * preCheck:  轻量正则匹配，4.4μs，无 I/O
 * postCheck: 完整 AgentOS 审计（Verify + Audit + Feedback）
 *
 * 用法:
 *   const guard = require('./sentinel-guard');
 *   const ck = guard.preCheck('exec', {command:'rm -rf /'});
 *   guard.postCheck('exec', params, result, ck.snapshot);
 */

const { AgentOS } = require('sentinel-agentos');
const fs = require('fs');
const path = require('path');

// 持久化审计日志路径
const AUDIT_DIR = path.join(__dirname, '..', '.sentinel-audit');

// AgentOS 实例（单例，避免丢失审计数据）
let _aos = null;
function getAOS() {
  if (!_aos) {
    _aos = new AgentOS({ workspaceRoot: process.cwd() });
    // 从磁盘恢复审计日志
    const auditFile = path.join(AUDIT_DIR, 'audit.jsonl');
    if (fs.existsSync(auditFile)) {
      try {
        const lines = fs.readFileSync(auditFile, 'utf-8').trim().split('\n');
        for (const line of lines) {
          if (line.trim()) _aos.guard.audit.entries.push(JSON.parse(line));
        }
      } catch {}
    }
  }
  return _aos;
}

// 注入到 module cache 中保持单例
if (!global.__sentinel_aos) {
  global.__sentinel_aos = getAOS();
}
const aos = global.__sentinel_aos;
aos.guard.schema.registerRules([
  { tool: 'exec', required: ['command'] },
  { tool: 'write', required: ['path', 'content'],
    pathDeny: { path: ['.env', '*.key', '*.pem', '.git/**', '**/credentials/**'] },
    maxSize: { content: 1048576 }, secrets: ['content'] },
  { tool: 'read', required: ['path'], pathDeny: { path: ['.env', '*.key'] } },
  { tool: 'edit', required: ['path'], pathDeny: { path: ['.env', '*.key', '.git/**'] } },
  { tool: 'delete', required: ['path'],
    pathDeny: { path: ['.env', '*.key', '*.pem', '.git/**', 'node_modules/**', 'package.json'] } },
]);

// ── 危险命令黑名单 ──
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

const SENSITIVE_PATTERNS = [
  '.env', '.env.*', '*.key', '*.pem', '*.p12', '*.pfx', '*.jks', '*.keystore',
  '.git/**', '**/credentials/**', '**/secrets/**', '**/SECRETS/**',
  'package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'Cargo.lock',
];

const PROTECTED_FILES = [
  'package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  '.gitignore', '.gitattributes', 'Cargo.toml', 'Cargo.lock', 'tsconfig.json',
  'AGENTS.md', 'SOUL.md', 'MEMORY.md', 'USER.md',
];

function globMatch(pattern, path) {
  const p = (path || '').replace(/\\/g, '/');
  if (!pattern.includes('*')) return p === pattern || p.endsWith('/' + pattern);
  const re = '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '(.*/)?').replace(/\*/g, '[^/]*') + '$';
  return new RegExp(re).test(p);
}

let sessionId = 0;

module.exports = {
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
    const path = params.path || params.file;
    if (path && ['write', 'edit', 'delete', 'read'].includes(toolName)) {
      for (const ptn of SENSITIVE_PATTERNS) {
        if (globMatch(ptn, path)) return { passed: false, block: true, risk: 'DENY', reason: `🚫 敏感文件: "${path}" → "${ptn}"` };
      }
    }
    if (toolName === 'delete' && path) {
      for (const pf of PROTECTED_FILES) {
        if (String(path) === pf || String(path).endsWith('/' + pf) || String(path).endsWith('\\' + pf))
          return { passed: false, block: true, risk: 'DENY', reason: `🚫 保护文件: "${pf}"` };
      }
    }
    return { passed: true, risk: 'auto', riskScore: 0 };
  },

  /** 执行后走完整 AgentOS 审计 */
  postCheck(toolName, params, result) {
    const sid = `guard_${++sessionId}`;
    const { preExec, snapshot } = aos.executePipeline({
      sessionId: sid, agentId: 'openclaw', toolName, parameters: params || {},
    });

    // 持久化审计日志
    try {
      if (!fs.existsSync(AUDIT_DIR)) fs.mkdirSync(AUDIT_DIR, { recursive: true });
      const auditFile = path.join(AUDIT_DIR, 'audit.jsonl');
      const summary = {
        ts: new Date().toISOString(), tool: toolName,
        params: JSON.stringify(params || {}).slice(0, 200),
        result: String(result || '').slice(0, 100),
      };
      fs.appendFileSync(auditFile, JSON.stringify(summary) + '\n');
    } catch {}

    const t = Date.now();
    const ret = aos.completeExecution({
      sessionId: sid, agentId: 'openclaw', toolName,
      toolParameters: params || {}, toolResult: result ?? null,
      snapshot, startTime: t - 500, endTime: t,
      retryCount: 0, wasSelfCorrected: false, hadTimeout: false,
      userAccepted: true, userProvidedEdit: false, resultWasUsed: false,
    });
    return {
      verifyPassed: ret.postExec.verifyPassed,
      auditId: ret.auditEntry.id,
      score: ret.runtime.adaptiveScore,
      profile: ret.profile.overallScore,
    };
  },

  status() {
    return aos.statusReport();
  },

  audit(limit = 10) {
    return aos.guard.audit.query({ limit });
  },

  feedback(signal) {
    aos.recordFeedback(signal, 'openclaw_session');
  },
};
