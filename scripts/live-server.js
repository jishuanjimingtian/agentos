// Live dashboard — reads real AgentOS instance from sentinel-guard skill
const http = require('http');
const fs = require('fs');

// Get real AgentOS instance
const sentinel = require('C:/Users/十号/.openclaw/workspace/skills/sentinel-guard/sentinel-guard.js');
const aos = global.__sentinel_aos;

const dashboardHtml = fs.readFileSync(
  'C:/Users/十号/.openclaw/workspace/projects/agentos/dist/dashboard.html', 'utf-8'
);

const PORT = 3408;

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  if (req.url === '/dashboard' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(dashboardHtml);
    return;
  }
  
  if (req.url === '/pipeline/report') {
    try {
      const sid = global.__sentinel_session_id;
      const profile = aos.evaluator.profiler.getProfile(sid);
      const auditStats = aos.guard.audit.stats();
      const satisfaction = aos.evaluator.feedback.getSatisfactionScore(sid);
      const recent = aos.guard.audit.query({ limit: 12 });
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        quality: {
          overallScore: profile.overallScore || 50,
          breakdown: profile.breakdown
        },
        audit: auditStats,
        satisfaction: Math.round(satisfaction * 100),
        uptime: process.uptime().toFixed(0) + 's',
        timeline: recent.map(e => ({
          tool: e.toolName,
          verify: e.verifyGate?.status || 'PASS',
          score: e.riskGate?.score || 0,
          ts: new Date(e.startedAt).toISOString()
        }))
      }));
    } catch(e) {
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
});
