// Sentinel AgentOS Live Dashboard
// Shares audit data with the sentinel-guard plugin via shared JSONL file
const http = require('http');
const fs = require('fs');
const path = require('path');

const DASHBOARD_HTML = 'C:/Users/十号/.openclaw/workspace/projects/agentos/dist/dashboard.html';
const PORT = 3408;

// Shared audit log path — same as the plugin's working memory
const AUDIT_DIR = 'C:/Users/十号/.openclaw/workspace/skills/sentinel-guard/.sentinel-audit';
const AUDIT_FILE = path.join(AUDIT_DIR, 'audit.jsonl');

// Dashboard HTML
let dashboardHtml = '<h1>Dashboard unavailable</h1>';
try {
  dashboardHtml = fs.readFileSync(DASHBOARD_HTML, 'utf-8');
} catch {}

function readAuditEntries(max = 200) {
  const entries = [];
  try {
    if (!fs.existsSync(AUDIT_FILE)) return entries;
    const lines = fs.readFileSync(AUDIT_FILE, 'utf-8').trim().split('\n');
    const start = Math.max(0, lines.length - max);
    for (let i = start; i < lines.length; i++) {
      try { entries.push(JSON.parse(lines[i])); } catch {}
    }
  } catch {}
  return entries;
}

function summarizeParams(tool, raw) {
  if (!raw) return '';
  try {
    const p = JSON.parse(raw);
    if (tool === 'exec' && p.command) return p.command.slice(0, 120);
    if (tool === 'read' && p.path) return p.path.replace(/\\/g, '/').split('/').slice(-3).join('/');
    if (tool === 'write' && p.path) return p.path.replace(/\\/g, '/').split('/').slice(-3).join('/');
    if (tool === 'edit' && p.path) return p.path.replace(/\\/g, '/').split('/').slice(-3).join('/');
    if (p.path) return p.path.replace(/\\/g, '/').split('/').slice(-3).join('/');
    return raw.slice(0, 120);
  } catch { return raw.slice(0, 120); }
}

function computeStats(entries) {
  let failures = 0, highRisk = 0;
  const sessions = new Set();
  for (const e of entries) {
    if (e.verify === 'FAIL') failures++;
    if (Number(e.riskScore) > 3.0) highRisk++;
    if (e.sessionId) sessions.add(e.sessionId);
  }
  return {
    totalOperations: entries.length,
    verifyFailures: failures,
    sessionsTracked: sessions.size,
    highRiskOps: highRisk,
  };
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.url === '/dashboard' || req.url === '/') {
    let html = dashboardHtml;
    try { html = fs.readFileSync(DASHBOARD_HTML, 'utf-8'); } catch {}
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  if (req.url === '/pipeline/report') {
    try {
      const entries = readAuditEntries(200);
      const stats = computeStats(entries);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        quality: { overallScore: 50, breakdown: {} },
        audit: stats,
        satisfaction: 50,
        uptime: process.uptime().toFixed(0) + 's',
        workingMemory: { messages: entries.length },
        timeline: entries.reverse().map(e => ({
          tool: e.tool,
          verify: e.verify || 'PASS',
          score: e.riskScore || 0,
          ts: e.ts || new Date().toISOString(),
          params: summarizeParams(e.tool, e.params || ''),
        }))
      }));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (req.url === '/health') {
    res.end(JSON.stringify({ ok: true, version: '0.3.7' }));
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('Dashboard: http://127.0.0.1:' + PORT + '/dashboard');
  console.log('API:      http://127.0.0.1:' + PORT + '/pipeline/report');
  console.log('Shared audit:', AUDIT_FILE);
});
