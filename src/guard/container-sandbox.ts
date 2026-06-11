/**
 * DockerContainerSandbox �?V2.0 container-level isolation.
 */
import * as path from 'path';
import { execSync, spawnSync } from 'child_process';
import type { SandboxResult } from './sandbox';

function dockerAvailable(): boolean {
  try { execSync('docker info', { stdio: 'ignore', timeout: 5000 }); return true; } catch { return false; }
}
function imageExists(image: string): boolean {
  try { execSync(`docker image inspect ${image}`, { stdio: 'ignore' }); return true; } catch { return false; }
}
function pullImage(image: string): void {
  execSync(`docker pull ${image}`, { stdio: 'inherit', timeout: 60000 });
}

export interface ContainerConfig {
  image?: string;
  workspaceVolume?: 'ro' | 'rw';
  network?: 'none' | 'host' | 'bridge';
  memoryLimit?: string;
  cpuLimit?: number;
  timeoutSec?: number;
  autoRemove?: boolean;
  env?: Record<string, string>;
}

const DEFAULTS: Required<ContainerConfig> = {
  image: 'node:24-alpine', workspaceVolume: 'ro', network: 'none',
  memoryLimit: '512m', cpuLimit: 0.5, timeoutSec: 30, autoRemove: true, env: {},
};

export function executeInContainer(
  command: string,
  cwd: string,
  config?: Partial<ContainerConfig>,
): SandboxResult {
  const cfg = { ...DEFAULTS, ...config };

  if (!dockerAvailable()) {
    return { success: false, exitCode: 127, stdout: '', stderr: 'Docker not available', truncated: false, durationMs: 0 };
  }

  const image = cfg.image;
  if (!imageExists(image)) {
    try { pullImage(image); } catch (e) {
      return { success: false, exitCode: 127, stdout: '',
        stderr: `Failed to pull image "${image}"`, truncated: false, durationMs: 0 };
    }
  }

  const containerName = `sentinel-sb-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
  const workspaceAbs = path.resolve(cwd);
  const args = [
    'run', '--rm', '--name', containerName,
    '--memory', cfg.memoryLimit, '--cpus', String(cfg.cpuLimit),
    ...(cfg.network === 'none' ? ['--network', 'none'] : cfg.network === 'host' ? ['--network', 'host'] : []),
    '-v', `${workspaceAbs}:/workspace:${cfg.workspaceVolume}`,
    '-w', '/workspace',
    image, 'sh', '-c', command,
  ];

  const startTime = Date.now();
  try {
    const r = spawnSync('docker', args, {
      encoding: 'utf-8', timeout: cfg.timeoutSec * 1000,
      maxBuffer: 10 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const durationMs = Date.now() - startTime;
    if (r.status === null) {
      return { success: false, exitCode: -1, stdout: '', stderr: r.stderr || 'timeout', truncated: false, durationMs };
    }
    return {
      success: r.status === 0, exitCode: r.status ?? 1,
      stdout: r.stdout || '', stderr: r.stderr || '', truncated: false, durationMs,
    };
  } catch (e) {
    try { execSync(`docker rm -f ${containerName}`, { stdio: 'ignore' }); } catch {}
    return { success: false, exitCode: -1, stdout: '',
      stderr: e instanceof Error ? e.message : String(e), truncated: false, durationMs: Date.now() - startTime };
  }
}

// ContainerSandbox class
export class ContainerSandbox {
  private cfg: Required<ContainerConfig> & { workspaceRoot: string };

  constructor(opts?: Partial<ContainerConfig> & { workspaceRoot?: string }) {
    this.cfg = { ...DEFAULTS, workspaceRoot: opts?.workspaceRoot || process.cwd(), ...opts };
  }

  validate(_toolName: string, params: Record<string, unknown>): { success: boolean; sandboxRejectReason?: string } {
    if (['write', 'write_file', 'delete', 'edit', 'rm'].includes(_toolName)) {
      const p = String(params.path || params.file || '');
      const absPath = path.resolve(this.cfg.workspaceRoot, p);
      if (!absPath.startsWith(path.resolve(this.cfg.workspaceRoot))) {
        return { success: false, sandboxRejectReason: `Path outside workspace: ${p}` };
      }
      if (['write', 'edit'].includes(_toolName) && this.isSensitive(p)) {
        return { success: false, sandboxRejectReason: `Sensitive file in container: ${p}` };
      }
    }
    return { success: true };
  }

  execute(_toolName: string, params: Record<string, unknown>): SandboxResult {
    return executeInContainer(String(params.command || ''), this.cfg.workspaceRoot, this.cfg);
  }

  private isSensitive(fp: string): boolean {
    const p = fp.replace(/\\/g, '/');
    return ['.env', 'package.json'].some(s => p === s || p.endsWith('/' + s));
  }
}
