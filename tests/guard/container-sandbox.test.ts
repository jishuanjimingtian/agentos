/**
 * V2.0 Docker Container Sandbox Tests
 */
import { ContainerSandbox, executeInContainer } from '../../src/guard/container-sandbox';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

describe('ContainerSandbox', () => {
  const hasDocker = (() => {
    try {
      require('child_process').execSync('docker info', { stdio: 'ignore', timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  })();

  const workspace = path.join(os.tmpdir(), 'sentinel-sandbox-test-' + Date.now());

  beforeAll(() => {
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, 'test.txt'), 'hello', 'utf-8');
  });

  afterAll(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  // ── Validation (no Docker needed) ──

  describe('validate', () => {
    it('should allow paths within workspace', () => {
      const sb = new ContainerSandbox({ workspaceRoot: workspace });
      const r = sb.validate('write', { path: path.join(workspace, 'src', 'test.ts') });
      expect(r.success).toBe(true);
    });

    it('should block paths outside workspace', () => {
      const sb = new ContainerSandbox({ workspaceRoot: workspace });
      const r = sb.validate('write', { path: '/etc/passwd' });
      expect(r.success).toBe(false);
    });

    it('should block writes to .env in container mode', () => {
      const sb = new ContainerSandbox({ workspaceRoot: workspace });
      const r = sb.validate('write', { path: '.env' });
      expect(r.success).toBe(false);
    });

    it('should allow safe commands', () => {
      const sb = new ContainerSandbox({ workspaceRoot: workspace });
      const r = sb.validate('exec', { command: 'npm test' });
      expect(r.success).toBe(true);
    });
  });

  // ── Container Execution (requires Docker) ──

  (hasDocker ? describe : describe.skip)('container execution', () => {
    it('should execute a simple command in container', () => {
      const result = executeInContainer('echo hello', workspace, {
        image: 'node:24-alpine',
        network: 'none',
        timeoutSec: 10,
      });
      expect(result.success).toBe(true);
      expect(result.stdout).toContain('hello');
    }, 30000);

    it('should have workspace files accessible', () => {
      const result = executeInContainer('cat test.txt', workspace, {
        image: 'node:24-alpine',
        network: 'none',
        timeoutSec: 10,
      });
      expect(result.success).toBe(true);
      expect(result.stdout).toContain('hello');
    }, 30000);

    it('should block network access in none mode', () => {
      const result = executeInContainer('curl -s https://google.com', workspace, {
        image: 'node:24-alpine',
        network: 'none',
        timeoutSec: 10,
      });
      // Should fail because no network
      expect(result.success).toBe(false);
    }, 30000);

    it('should enforce timeout', () => {
      const result = executeInContainer('sleep 5', workspace, {
        image: 'node:24-alpine',
        network: 'none',
        timeoutSec: 2,
      });
      expect(result.success).toBe(false);
    }, 5000);
  });

  // ── ContainerSandbox class ──

  describe('ContainerSandbox execute', () => {
    it('should reject dangerous operations in validate', () => {
      const sb = new ContainerSandbox({ workspaceRoot: workspace });
      expect(sb.validate('write', { path: '/root/.ssh/authorized_keys' }).success).toBe(false);
    });

    it('should allow npm test in container', () => {
      const sb = new ContainerSandbox({ workspaceRoot: workspace });
      // validate only — no Docker needed
      const check = sb.validate('exec', { command: 'npm test' });
      expect(check.success).toBe(true);
    });
  });
});
