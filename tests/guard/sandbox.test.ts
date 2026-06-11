/**
 * Sandbox tests — ts-jest compiled from source
 */
import { SandboxExecutor } from '../../src/guard/sandbox';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

describe('SandboxExecutor', () => {
  const workspace = path.join(os.tmpdir(), 'sb-test-' + Date.now());

  beforeAll(() => {
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, 'hello.txt'), 'world', 'utf-8');
    fs.mkdirSync(path.join(workspace, 'subdir'), { recursive: true });
  });

  afterAll(() => { try { fs.rmSync(workspace, { recursive: true, force: true }); } catch {} });

  it('should execute a simple command', async () => {
    const sb = new SandboxExecutor({ mode: 'direct', workspaceRoot: workspace, timeoutMs: 5000 });
    const r = await sb.execute('exec', { command: 'echo HELLO', env: {}, timeoutMs: 5000 });
    expect(r.success).toBe(true);
    expect(r.stdout).toContain('HELLO');
  });

  it('should run stderr command without crash', async () => {
    const sb = new SandboxExecutor({ mode: 'direct', workspaceRoot: workspace, timeoutMs: 5000 });
    const r = await sb.execute('exec', { command: process.platform === 'win32' ? 'echo ERR 1>&2' : 'echo ERR >&2', env: {}, timeoutMs: 5000 });
    expect(r).toBeTruthy();
  });

  it('should timeout on slow command', async () => {
    const sb = new SandboxExecutor({ mode: 'direct', workspaceRoot: workspace, timeoutMs: 5000 });
    const r = await sb.execute('exec', {
      command: process.platform === 'win32' ? 'ping -n 6 127.0.0.1 > nul' : 'sleep 5',
      env: {}, timeoutMs: 1000,
    });
    expect(r.success).toBe(false);
  });

  it('should block forbidden tools', async () => {
    const sb = new SandboxExecutor({ mode: 'direct', workspaceRoot: workspace, timeoutMs: 5000, forbiddenTools: ['eval', 'exec'] });
    const r = await sb.execute('exec', { command: 'ls', env: {}, timeoutMs: 5000 });
    expect(r.success).toBe(false);
  });

  it('should deny workspace-external path write', async () => {
    const sb = new SandboxExecutor({ mode: 'sandbox', workspaceRoot: workspace, timeoutMs: 5000 });
    const r = await sb.execute('write', { path: '/etc/passwd', content: 'x', env: {}, timeoutMs: 5000 });
    expect(r.success).toBe(false);
  });

  it('should handle dry-run mode without executing', async () => {
    const sb = new SandboxExecutor({ mode: 'dry-run', workspaceRoot: workspace, timeoutMs: 5000 });
    const r = await sb.execute('exec', { command: 'echo HELLO', env: {}, timeoutMs: 5000 });
    expect(r.success).toBe(true);
    expect(r.stdout).toBe('');
  });
});
