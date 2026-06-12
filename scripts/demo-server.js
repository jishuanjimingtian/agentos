const http = require('http');
const fs = require('fs');
const path = require('path');
const { AgentOS } = require('sentinel-agentos');

const aos = new AgentOS({ sessionId: 'live-demo', agentId: 'anne' });

// Simulate real operations
const ops = [
  { tool: 'exec', params: { command: 'npm test' }, result: 'PASS', verify: 'PASS' },
  { tool: 'write', params: { path: 'src/main.ts', content: '...' }, result: 'ok', verify: 'PASS' },
  { tool: 'exec', params: { command: 'rm -rf /' }, result: null, verify: 'FAIL' },
  { tool: 'exec', params: { command: 'echo ok' }, result: 'ok', verify: 'PASS' },
  { tool: 'edit', params: { path: 'README.md', oldText: 'a', newText: 'b' }, result: 'ok', verify: 'PASS' },
];
ops.forEach(o => {
  aos.guard.audit.record({
    sessionId: 'live-demo', agentId: 'anne',
    startedAt: Date.now() - (ops.indexOf(o) + 1) * 5000,
    completedAt: Date.now() - (ops.indexOf(o) + 1) * 5000 + 2000,
    toolName: o.tool, toolParameters: o.params, toolResult: o.result,
    snapshot: null, verifyStatus: o.verify, verifyChecks: []
  });
});
aos.evaluator.feedback.record('user_explicit_approval', 'live-demo', 'op1');

const dashboardHtml = fs.readFileSync(
  path.join('C:/Users/十号/.openclaw/workspace/projects/agentos/dist/dashboard.html'), 'utf-8'
);

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  if (req.url === '/dashboard' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(dashboardHtml);
  } else if (req.url === '/pipeline/report') {
    const profile = aos.evaluator.profiler.getProfile('live-demo');
    const stats = aos.guard.audit.stats();
    const satisfaction = aos.evaluator.feedback.getSatisfactionScore('live-demo');
    const recent = aos.guard.audit.query({ limit: 12 });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      quality: { overallScore: profile.overallScore || 82, breakdown: profile.breakdown },
      audit: stats,
      satisfaction: Math.round(satisfaction * 100),
      uptime: process.uptime().toFixed(0) + 's',
      timeline: recent.map(e => ({
        tool: e.toolName,
        verify: e.verifyGate.status,
        ts: new Date(e.startedAt).toISOString()
      }))
    }));
  } else if (req.url === '/health') {
    res.end(JSON.stringify({ ok: true }));
  } else {
    res.writeHead(404);
    res.end('not found');
  }
});

server.listen(3401, '127.0.0.1', () => {
  console.log('Dashboard: http://127.0.0.1:3401/dashboard');
});

// Keep alive
process.stdin.resume();
