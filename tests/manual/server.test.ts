/**
 * HTTP Server API tests — unit tests via ts-jest
 */
import { createServer } from '../../src/server';

describe('Server unit', () => {
  it('should create a server instance', () => {
    const s = createServer({ port: 3999 });
    expect(s).toBeDefined();
    expect(typeof s.start).toBe('function');
    expect(typeof s.stop).toBe('function');
  });

  it('should create server with API token', () => {
    const s = createServer({ port: 3998, apiToken: 'secret' });
    expect(s).toBeDefined();
  });

  it('should expose getPort and getInstance', () => {
    const s = createServer({ port: 3997 });
    expect(typeof s.getPort()).toBe('number');
    expect(s.getInstance()).toBeDefined();
  });
});

describe('Server HTTP integration', () => {
  const port = 3996;
  let server: ReturnType<typeof createServer>;

  beforeAll(() => {
    server = createServer({ port });
    server.start();
  });
  afterAll(() => server.stop());

  it('should respond to health check', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/health`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
  });

  it('should serve dashboard HTML', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/dashboard`);
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).toContain('DOCTYPE');
  });

  it('should return pipeline report', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/pipeline/report`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.quality).toBeDefined();
    expect(body.timeline).toBeDefined();
  });

  it('should handle pre-exec pipeline POST', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/pipeline/pre`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 's1', agentId: 'agent', toolName: 'exec', toolParameters: { command: 'ls' } }),
    });
    expect(r.status).toBe(200);
  });

  it('should get profile', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/pipeline/profile`);
    expect(r.status).toBe(200);
  });

  it('should return 401 when token required', async () => {
    const s2 = createServer({ port: 3995, apiToken: 's' });
    s2.start();
    try {
      const r = await fetch('http://127.0.0.1:3995/pipeline/report');
      expect(r.status).toBe(401);
    } finally { s2.stop(); }
  });

  it('should accept valid token', async () => {
    const s2 = createServer({ port: 3994, apiToken: 's' });
    s2.start();
    try {
      const r = await fetch('http://127.0.0.1:3994/pipeline/pre', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: '***' },
        body: JSON.stringify({ sessionId: 'x', agentId: 'a', toolName: 'exec', toolParameters: { command: 'test' } }),
      });
      expect(r.status).toBe(200);
    } finally { s2.stop(); }
  });
});
