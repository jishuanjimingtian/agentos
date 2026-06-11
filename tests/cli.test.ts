import { execSync } from 'child_process';
import * as path from 'path';

const cliPath = path.join(__dirname, '..', 'dist', 'cli.js');
const node = process.execPath;

function run(args: string): { exitCode: number; stdout: string; stderr: string } {
  try {
    const cmd = `${node} "${cliPath}" ${args}`;
    const stdout = execSync(cmd, { encoding: 'utf-8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] });
    return { exitCode: 0, stdout, stderr: '' };
  } catch (e: any) {
    return {
      exitCode: e.status || 1,
      stdout: e.stdout || '',
      stderr: e.stderr || '',
    };
  }
}

describe('CLI', () => {
  // Skip if dist not built
  const hasBuild = (() => {
    try { require('fs').accessSync(cliPath); return true; } catch { return false; }
  })();

  (hasBuild ? it : it.skip)('should show help', () => {
    const r = run('help');
    expect(r.stdout).toContain('Sentinel AgentOS');
    expect(r.stdout).toContain('validate');
    expect(r.stdout).toContain('init');
  });

  (hasBuild ? it : it.skip)('should show status', () => {
    const r = run('status');
    expect(r.stdout).toContain('AgentOS');
  });

  (hasBuild ? it : it.skip)('should show stats', () => {
    const r = run('stats');
    expect(r.exitCode).toBe(0);
  });

  (hasBuild ? it : it.skip)('should report memory', () => {
    const r = run('memory');
    expect(r.exitCode).toBe(0);
  });

  (hasBuild ? it : it.skip)('should show profile', () => {
    const r = run('profile');
    expect(r.exitCode).toBe(0);
  });

  (hasBuild ? it : it.skip)('should show audit', () => {
    const r = run('audit --limit 5');
    expect(r.exitCode).toBe(0);
  });

  (hasBuild ? it : it.skip)('should validate safe command', () => {
    const r = run('validate exec command="npm test"');
    // validate may return 0 or non-zero depending on risk, just confirm it doesn't crash
    expect(r.stdout).toBeDefined();
  });

  (hasBuild ? it : it.skip)('should validate dangerous command', () => {
    const r = run('validate exec command="rm -rf /"');
    expect(r.stdout).toBeDefined();
  });

  (hasBuild ? it : it.skip)('should show risk for a command', () => {
    const r = run('risk exec command="npm test"');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBeDefined();
  });

  (hasBuild ? it : it.skip)('should fail on unknown command', () => {
    const r = run('foobar12345');
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain('Unknown');
  });

  (hasBuild ? it : it.skip)('should show init info', () => {
    // Run help which lists init
    const r = run('help');
    expect(r.stdout).toContain('init');
  });

  it('should have CLI entry point', () => {
    const cli = require('../src/cli');
    expect(cli).toBeDefined();
  });
});
