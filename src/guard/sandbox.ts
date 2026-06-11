import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

/**
 * Execution mode — from DESIGN.md §4.5
 */
export type ExecutionMode = 'direct' | 'sandbox' | 'dry-run';

/**
 * Network access policy for sandbox mode.
 */
export type NetworkPolicy = 'none' | 'localhost' | 'whitelist';

/**
 * Execution context configuration — full DESIGN.md §4.5 interface.
 */
export interface ExecutionContext {
  /** Execution mode */
  mode: ExecutionMode;
  /** Timeout in milliseconds */
  timeoutMs: number;
  /** Network policy (sandbox mode only) */
  networkAccess?: NetworkPolicy;
  /** Allowed network hosts (sandbox + whitelist mode only) */
  networkWhitelist?: string[];
  /** Writable paths (sandbox mode) */
  writablePaths?: string[];
  /** Read-only paths (sandbox mode) */
  readonlyPaths?: string[];
  /** Workspace root */
  workspaceRoot: string;
  /** Max output size before truncation */
  maxOutputSize?: number;
  /** Allowed tools in sandbox mode */
  allowedTools?: string[];
  /** Forbidden tools in any mode */
  forbiddenTools?: string[];
}

/**
 * Sandbox execution result.
 */
export interface SandboxResult {
  /** Execution outcome */
  success: boolean;
  /** Exit code (0 = success) */
  exitCode: number;
  /** stdout */
  stdout: string;
  /** stderr */
  stderr: string;
  /** Truncated flag */
  truncated: boolean;
  /** Error message if sandbox rejected */
  sandboxRejectReason?: string;
  /** Dry-run: what would have happened */
  dryRunSummary?: string;
  /** Execution time in ms */
  durationMs: number;
}

/**
 * Sandbox Violation types.
 */
export enum SandboxViolation {
  NETWORK_FORBIDDEN = 'NETWORK_FORBIDDEN',
  PATH_NOT_WRITABLE = 'PATH_NOT_WRITABLE',
  PATH_READONLY = 'PATH_READONLY',
  TOOL_FORBIDDEN = 'TOOL_FORBIDDEN',
  TOOL_NOT_ALLOWED = 'TOOL_NOT_ALLOWED',
  COMMAND_FORBIDDEN = 'COMMAND_FORBIDDEN',
}

/**
 * Sandbox Executor — controlled execution environment.
 *
 * Implements three execution modes from DESIGN.md §4.5:
 * - direct: Execute in shared environment (default, no sandboxing)
 * - sandbox: Restricted execution with network + filesystem policies
 * - dry-run: Preview only, no actual execution
 */
export class SandboxExecutor {
  private config: ExecutionContext;

  /** Forbidden shell commands (dangerous patterns) */
  private static FORBIDDEN_COMMANDS = [
    /rm\s+-rf\s+\//,
    /sudo\s/,
    /chmod\s+777/,
    />\s*\/dev\//,
    /mkfs\./,
    /dd\s+if=/,
    /:()\s*\{\s*:/,  // fork bomb
    /curl.*\|\s*bash/,
    /wget.*\|\s*sh/,
  ];

  constructor(config: ExecutionContext) {
    this.config = {
      maxOutputSize: 1024 * 1024, // 1MB default
      ...config,
    };
  }

  /**
   * Validate and possibly reject a tool call before execution.
   *
   * @returns {SandboxResult} with sandboxRejectReason if rejected
   */
  validate(toolName: string, params: Record<string, unknown>): SandboxResult | null {
    // Check forbidden tools
    if (this.config.forbiddenTools) {
      if (this.config.forbiddenTools.includes(toolName)) {
        return {
          success: false,
          exitCode: 126,
          stdout: '',
          stderr: '',
          truncated: false,
          durationMs: 0,
          sandboxRejectReason: `Tool "${toolName}" is forbidden by sandbox policy`,
        };
      }
    }

    // Check allowed tools (sandbox mode)
    if (this.config.mode === 'sandbox' && this.config.allowedTools) {
      if (!this.config.allowedTools.includes(toolName)) {
        return {
          success: false,
          exitCode: 126,
          stdout: '',
          stderr: '',
          truncated: false,
          durationMs: 0,
          sandboxRejectReason: `Tool "${toolName}" is not in the sandbox allowed-tools list`,
        };
      }
    }

    // Check filesystem writes
    if (this.config.mode === 'sandbox') {
      const pathParam = params['path'] || params['file'] || params['filePath'];
      if (typeof pathParam === 'string') {
        const fsCheck = this.validatePath(pathParam, this.isWriteTool(toolName));
        if (fsCheck) return fsCheck;
      }

      // Check multiple paths
      const paths = params['paths'] || params['files'] || params['targets'];
      if (Array.isArray(paths)) {
        for (const p of paths) {
          if (typeof p === 'string') {
            const fsCheck = this.validatePath(p, this.isWriteTool(toolName));
            if (fsCheck) return fsCheck;
          }
        }
      }
    }

    // Check shell commands for dangerous patterns
    if (toolName === 'exec' || toolName === 'shell' || toolName === 'command') {
      const command = String(params['command'] || params['cmd'] || '');
      const cmdCheck = this.validateCommand(command);
      if (cmdCheck) return cmdCheck;
    }

    return null; // All clear
  }

  /**
   * Execute a shell command in the configured mode.
   */
  async execute(toolName: string, params: Record<string, unknown>): Promise<SandboxResult> {
    const startTime = Date.now();

    // 1. Pre-flight validation
    const rejection = this.validate(toolName, params);
    if (rejection) return rejection;

    // 2. Dry-run mode
    if (this.config.mode === 'dry-run') {
      return this.dryRun(toolName, params);
    }

    // 3. Build command for exec-based tools
    if (this.isShellTool(toolName)) {
      return this.executeShell(params);
    }

    // 4. For non-shell tools: delegate (no sandbox exec here — that's the agent runtime's job)
    // Sandbox mode only applies to shell commands at this level
    return {
      success: true,
      exitCode: 0,
      stdout: '',
      stderr: '',
      truncated: false,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Dry-run: return a summary of what would happen.
   */
  private dryRun(toolName: string, params: Record<string, unknown>): SandboxResult {
    const summaryParts: string[] = [];

    if (this.isShellTool(toolName)) {
      const command = String(params['command'] || '');
      summaryParts.push(`Would execute: ${command}`);
    } else {
      summaryParts.push(`Would call: ${toolName}(${JSON.stringify(params)})`);
    }

    // Check files that would be affected
    const pathParam = params['path'] || params['file'] || params['filePath'];
    if (typeof pathParam === 'string') {
      const fullPath = path.resolve(this.config.workspaceRoot, pathParam);
      if (fs.existsSync(fullPath)) {
        const stat = fs.statSync(fullPath);
        summaryParts.push(`File exists: ${pathParam} (${stat.size} bytes)`);
      } else {
        summaryParts.push(`File would be created: ${pathParam}`);
      }
    }

    return {
      success: true,
      exitCode: 0,
      stdout: '',
      stderr: '',
      truncated: false,
      durationMs: 0,
      dryRunSummary: summaryParts.join('\n'),
    };
  }

  /**
   * Execute shell commands with sandbox policies.
   */
  private async executeShell(params: Record<string, unknown>): Promise<SandboxResult> {
    const startTime = Date.now();
    const command = String(params['command'] || '');
    const cwd = String(params['cwd'] || this.config.workspaceRoot);

    try {
      // Apply network restrictions
      const env = this.buildSandboxEnv();

      let output: string;
      try {
        output = execSync(command, {
          cwd,
          encoding: 'utf-8',
          env,
          timeout: this.config.timeoutMs,
          maxBuffer: this.config.maxOutputSize,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (execErr: any) {
        return {
          success: false,
          exitCode: execErr.status ?? 1,
          stdout: execErr.stdout?.slice(0, this.config.maxOutputSize) ?? '',
          stderr: execErr.stderr?.slice(0, this.config.maxOutputSize) ?? '',
          truncated: (execErr.stdout?.length ?? 0) > (this.config.maxOutputSize ?? 1024 * 1024),
          durationMs: Date.now() - startTime,
        };
      }

      const truncated = output.length > (this.config.maxOutputSize ?? 1024 * 1024);
      const finalOutput = truncated
        ? output.slice(0, this.config.maxOutputSize ?? 1024 * 1024)
        : output;

      return {
        success: true,
        exitCode: 0,
        stdout: finalOutput,
        stderr: '',
        truncated,
        durationMs: Date.now() - startTime,
      };
    } catch (err: any) {
      return {
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: err.message ?? 'Unknown execution error',
        truncated: false,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Build environment with sandbox network restrictions.
   */
  private buildSandboxEnv(): NodeJS.ProcessEnv | undefined {
    if (this.config.mode !== 'sandbox' || this.config.networkAccess === undefined) {
      return undefined; // Use default env
    }

    const env = { ...process.env };

    switch (this.config.networkAccess) {
      case 'none':
        env['http_proxy'] = 'http://0.0.0.0:0'; // Blackhole
        env['https_proxy'] = 'http://0.0.0.0:0';
        env['HTTP_PROXY'] = 'http://0.0.0.0:0';
        env['HTTPS_PROXY'] = 'http://0.0.0.0:0';
        env['NO_PROXY'] = '';
        break;

      case 'localhost':
        env['http_proxy'] = 'http://0.0.0.0:0';
        env['https_proxy'] = 'http://0.0.0.0:0';
        env['HTTP_PROXY'] = 'http://0.0.0.0:0';
        env['HTTPS_PROXY'] = 'http://0.0.0.0:0';
        env['NO_PROXY'] = 'localhost,127.0.0.1,::1';
        break;

      case 'whitelist':
        if (this.config.networkWhitelist) {
          env['http_proxy'] = 'http://0.0.0.0:0';
          env['https_proxy'] = 'http://0.0.0.0:0';
          env['HTTP_PROXY'] = 'http://0.0.0.0:0';
          env['HTTPS_PROXY'] = 'http://0.0.0.0:0';
          env['NO_PROXY'] = this.config.networkWhitelist.join(',') + ',localhost,127.0.0.1';
        }
        break;
    }

    return env;
  }

  /**
   * Validate a filesystem path against sandbox policies.
   */
  private validatePath(filePath: string, isWrite: boolean): SandboxResult | null {
    const resolvedPath = path.resolve(this.config.workspaceRoot, filePath);
    const normalizedRoot = path.resolve(this.config.workspaceRoot);

    // Check if path is within workspace
    if (!resolvedPath.startsWith(normalizedRoot + path.sep) && resolvedPath !== normalizedRoot) {
      return {
        success: false,
        exitCode: 126,
        stdout: '',
        stderr: '',
        truncated: false,
        durationMs: 0,
        sandboxRejectReason: `Path "${filePath}" is outside workspace boundaries`,
      };
    }

    if (isWrite) {
      // Check writable paths
      if (this.config.writablePaths && this.config.writablePaths.length > 0) {
        const isWritable = this.config.writablePaths.some(
          (wp) => resolvedPath.startsWith(path.resolve(this.config.workspaceRoot!, wp)),
        );
        if (!isWritable) {
          return {
            success: false,
            exitCode: 126,
            stdout: '',
            stderr: '',
            truncated: false,
            durationMs: 0,
            sandboxRejectReason: `Path "${filePath}" is not in the sandbox writable paths list`,
          };
        }
      }

      // Check readonly paths
      if (this.config.readonlyPaths) {
        const isReadonly = this.config.readonlyPaths.some(
          (rp) => resolvedPath.startsWith(path.resolve(this.config.workspaceRoot!, rp)),
        );
        if (isReadonly) {
          return {
            success: false,
            exitCode: 126,
            stdout: '',
            stderr: '',
            truncated: false,
            durationMs: 0,
            sandboxRejectReason: `Path "${filePath}" is read-only in sandbox mode`,
          };
        }
      }
    }

    return null;
  }

  /**
   * Validate a shell command against forbidden patterns.
   */
  private validateCommand(command: string): SandboxResult | null {
    for (const pattern of SandboxExecutor.FORBIDDEN_COMMANDS) {
      if (pattern.test(command)) {
        return {
          success: false,
          exitCode: 126,
          stdout: '',
          stderr: '',
          truncated: false,
          durationMs: 0,
          sandboxRejectReason: `Command matches forbidden pattern: "${pattern.source}"`,
        };
      }
    }

    return null;
  }

  private isShellTool(toolName: string): boolean {
    return ['exec', 'shell', 'command', 'bash', 'sh', 'cmd'].includes(toolName);
  }

  private isWriteTool(toolName: string): boolean {
    const writeTools = [
      'write_file', 'write', 'edit', 'edit_file', 'create_file',
      'mkdir', 'rm', 'unlink', 'delete_file', 'delete', 'mv', 'cp',
      'exec', 'shell', 'git_commit', 'git_push',
    ];
    return writeTools.some((t) => toolName.includes(t));
  }
}
