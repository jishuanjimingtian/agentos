import { Snapshot, DiffInfo, VerifyCheck } from '../types';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

/**
 * Hash a file's content with SHA-256.
 * Returns undefined if the file doesn't exist.
 */
function hashFile(filePath: string): string | undefined {
  try {
    const content = fs.readFileSync(filePath);
    return `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`;
  } catch {
    return undefined;
  }
}

/**
 * Collect file hashes for files matched by glob patterns.
 */
function collectHashes(rootDir: string, patterns: string[]): Record<string, string> {
  const hashes: Record<string, string> = {};

  for (const pattern of patterns) {
    // Simple glob: support * and **
    const baseDir = pattern.replace(/\*\*\/\*$/, '').replace(/\/\*$/, '');
    const fullBase = path.resolve(rootDir, baseDir);

    if (fs.existsSync(fullBase) && fs.statSync(fullBase).isDirectory()) {
      walkDir(fullBase, fullBase, hashes);
    } else if (fs.existsSync(fullBase)) {
      const h = hashFile(fullBase);
      if (h) hashes[pattern] = h;
    }
  }

  return hashes;
}

function walkDir(dir: string, baseDir: string, hashes: Record<string, string>): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip node_modules, .git, dist
      if (['node_modules', '.git', 'dist', '.agentos'].includes(entry.name)) continue;
      walkDir(full, baseDir, hashes);
    } else if (entry.isFile()) {
      const rel = path.relative(baseDir, full).replace(/\\/g, '/');
      const h = hashFile(full);
      if (h) hashes[rel] = h;
    }
  }
}

/**
 * Snapshot scope determines how much state to capture.
 */
export type SnapshotScope = 'file' | 'workspace' | 'full';

/**
 * Generate a unique snapshot ID.
 */
function generateId(): string {
  return `snap_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Snapshot Gate �?captures pre-execution state for later diff/rollback.
 *
 * Takes a lightweight snapshot (file hashes, git status, env vars)
 * before a tool call executes so that Verify Gate and Rollback
 * can compare before/after state.
 */
export class SnapshotGate {
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Create a snapshot before a tool call.
   *
   * @param toolCallId - Unique ID for this tool call
   * @param toolName - Name of the tool being called
   * @param affectedFiles - Files expected to be affected (for scoped snapshots)
   * @param scope - Snapshot scope (file/workspace/full)
   */
  takeSnapshot(
    toolCallId: string,
    _toolName: string,
    affectedFiles: string[] = [],
    scope: SnapshotScope = 'file',
  ): Snapshot {
    let fileHashes: Record<string, string> = {};

    if (scope === 'file' && affectedFiles.length > 0) {
      // Hash only affected files
      for (const file of affectedFiles) {
        const h = hashFile(file);
        if (h) fileHashes[file] = h;
      }
    } else if (scope === 'workspace') {
      // Hash entire workspace (excl node_modules, .git, dist)
      fileHashes = collectHashes(this.workspaceRoot, ['**/*']);
    }
    // scope === 'full' would capture more (env, etc.) �?reserved for v2

    const { gitHead, gitDirty } = this.getGitStatus();

    return {
      id: generateId(),
      toolCallId,
      timestamp: Date.now(),
      scope,
      fileHashes,
      envVars: {}, // scoped env capture �?TBD in future iterations
      gitHead,
      gitDirty,
    };
  }

  /**
   * Compute the diff between a snapshot and the current filesystem state.
   */
  computeDiff(snapshot: Snapshot): DiffInfo | null {
    const filesChanged: string[] = [];
    let linesAdded = 0;
    let linesRemoved = 0;
    const hashBefore: Record<string, string> = {};
    const hashAfter: Record<string, string> = {};

    for (const [file, oldHash] of Object.entries(snapshot.fileHashes)) {
      const fullPath = path.isAbsolute(file)
        ? file
        : path.resolve(this.workspaceRoot, file);
      const newHash = hashFile(fullPath);

      hashBefore[file] = oldHash;
      hashAfter[file] = newHash ?? 'MISSING';

      if (newHash !== oldHash) {
        filesChanged.push(file);

        // Estimate line changes if file exists
        if (newHash) {
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const newLines = content.split('\n').length;

            // Try to read old content from git
            try {
              const oldContent = execSync(
                `git show ${snapshot.gitHead}:${file}`,
                { cwd: this.workspaceRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
              );
              const oldLines = oldContent.split('\n').length;
              linesAdded += Math.max(0, newLines - oldLines);
              linesRemoved += Math.max(0, oldLines - newLines);
            } catch {
              // File didn't exist in git �?treat as entirely new
              linesAdded += newLines;
            }
          } catch {
            // Can't read �?skip line counting
          }
        } else {
          // File was deleted
          try {
            const oldContent = execSync(
              `git show ${snapshot.gitHead}:${file}`,
              { cwd: this.workspaceRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
            );
            linesRemoved += oldContent.split('\n').length;
          } catch {
            // Can't determine old line count
          }
        }
      }
    }

    if (filesChanged.length === 0) return null;

    return {
      filesChanged,
      linesAdded,
      linesRemoved,
      hashBefore,
      hashAfter,
    };
  }

  /**
   * Get current git HEAD and dirty status.
   */
  private getGitStatus(): { gitHead: string; gitDirty: boolean } {
    try {
      const head = execSync('git rev-parse HEAD', {
        cwd: this.workspaceRoot,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();

      const status = execSync('git status --porcelain', {
        cwd: this.workspaceRoot,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });

      return { gitHead: head, gitDirty: status.length > 0 };
    } catch {
      return { gitHead: 'unknown', gitDirty: false };
    }
  }

  /**
   * Roll back a file to the snapshot state using git.
   */
  rollbackFile(snapshot: Snapshot, file: string): boolean {
    try {
      execSync(`git checkout ${snapshot.gitHead} -- "${file}"`, {
        cwd: this.workspaceRoot,
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Roll back all changed files to their snapshot state.
   */
  rollback(snapshot: Snapshot): { success: boolean; filesRolledBack: string[]; errors: string[] } {
    const filesRolledBack: string[] = [];
    const errors: string[] = [];

    for (const file of Object.keys(snapshot.fileHashes)) {
      const success = this.rollbackFile(snapshot, file);
      if (success) {
        filesRolledBack.push(file);
      } else {
        errors.push(file);
      }
    }

    return {
      success: errors.length === 0,
      filesRolledBack,
      errors,
    };
  }
}

/**
 * Verify Gate �?post-execution state verification.
 *
 * Checks that what the agent claimed actually happened.
 * Zero LLM dependency: file existence, hash changes, lint, typecheck, etc.
 */
export class VerifyGate {
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Run verification checks after a tool call.
   *
   * @param toolName - The tool that was called
   * @param snapshot - Pre-execution snapshot
   * @param claimedResult - What the agent claims the result was
   */
  verify(
    toolName: string,
    snapshot: Snapshot,
    claimedResult?: { files?: string[]; published?: boolean; pushed?: boolean },
  ): { status: 'PASS' | 'WARN' | 'FAIL'; checks: VerifyCheck[] } {
    const checks: VerifyCheck[] = [];

    // Depending on the tool, run relevant checks
    switch (true) {
      // File creation/modification tools
      case this.isFileTool(toolName):
        checks.push(...this.verifyFiles(snapshot, claimedResult?.files));
        break;

      // npm publish
      case toolName === 'npm_publish' || toolName.includes('npm'):
        checks.push(this.verifyNpmPublish(claimedResult?.published));
        break;

      // git push
      case toolName === 'git_push' || toolName.includes('git_push'):
        checks.push(this.verifyGitPush());
        break;

      default:
      // No specific checks for this tool type
    }

    // Run common checks that always apply
    if (snapshot.scope === 'file' || snapshot.scope === 'workspace') {
      checks.push(...this.verifyFileChanges(snapshot));
    }

    // Always run result format checks
    checks.push(this.verifyResultFormat(claimedResult));
    checks.push(this.verifyNonEmptyResult(claimedResult));

    return this.evaluateChecks(checks);
  }

  /**
   * Verify that claimed files actually exist.
   */
  private verifyFiles(_snapshot: Snapshot, claimedFiles?: string[]): VerifyCheck[] {
    const checks: VerifyCheck[] = [];

    // Check if files that were supposed to be created actually exist
    if (claimedFiles) {
      for (const file of claimedFiles) {
        const fullPath = path.isAbsolute(file)
          ? file
          : path.resolve(this.workspaceRoot, file);

        if (fs.existsSync(fullPath)) {
          checks.push({ name: `File exists: ${file}`, status: 'PASS' });
        } else {
          checks.push({
            name: `File exists: ${file}`,
            status: 'FAIL',
            detail: 'Agent claimed file was created but it does not exist',
          });
        }
      }
    }

    return checks;
  }

  /**
   * Verify that files actually changed compared to snapshot.
   */
  private verifyFileChanges(snapshot: Snapshot): VerifyCheck[] {
    const checks: VerifyCheck[] = [];

    for (const [file, oldHash] of Object.entries(snapshot.fileHashes)) {
      const fullPath = path.isAbsolute(file)
        ? file
        : path.resolve(this.workspaceRoot, file);

      const newHash = hashFile(fullPath);

      if (!newHash) {
        checks.push({
          name: `File unchanged check: ${file}`,
          status: 'WARN',
          detail: 'File no longer exists',
        });
      } else if (newHash === oldHash) {
        checks.push({
          name: `File unchanged check: ${file}`,
          status: 'WARN',
          detail: 'File hash unchanged �?no modifications detected',
        });
      } else {
        checks.push({ name: `File unchanged check: ${file}`, status: 'PASS' });
      }
    }

    // Lint check for TypeScript/JavaScript files
    const codeFiles = Object.keys(snapshot.fileHashes).filter(
      (f) => f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.js'),
    );

    if (codeFiles.length > 0) {
      checks.push(this.verifyLint());
      checks.push(this.verifyTypeCheck());
    }

    return checks;
  }

  /**
   * Verify npm publish actually happened.
   */
  private verifyNpmPublish(agentClaimedPublished?: boolean): VerifyCheck {
    if (agentClaimedPublished === false) {
      return { name: 'npm publish', status: 'PASS', detail: 'Agent acknowledged no publish' };
    }

    // Use npm view to verify latest version
    try {
      const pkgPath = path.join(this.workspaceRoot, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        const result = execSync(`npm view ${pkg.name} version 2>&1`, {
          cwd: this.workspaceRoot,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'ignore'],
          timeout: 5000,
        }).trim();

        if (result === pkg.version) {
          return {
            name: 'npm publish',
            status: 'PASS',
            detail: `npm registry confirms ${pkg.name}@${pkg.version}`,
          };
        }
        return {
          name: 'npm publish',
          status: 'WARN',
          detail: `npm shows ${result}, local is ${pkg.version}`,
        };
      }
    } catch {
      return {
        name: 'npm publish',
        status: 'WARN',
        detail: 'Could not verify npm publish status (network or npm not available)',
      };
    }
    return { name: 'npm publish', status: 'PASS', detail: 'No package.json found' };
  }

  /**
   * Verify git push actually happened.
   */
  private verifyGitPush(): VerifyCheck {
    try {

      // Use git ls-remote to verify remote HEAD matches local
      const localHead = execSync('git rev-parse HEAD 2>&1', {
        cwd: this.workspaceRoot,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();

      const remoteHead = execSync('git ls-remote origin HEAD 2>&1', {
        cwd: this.workspaceRoot,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
        timeout: 5000,
      }).split('\t')[0]?.trim();

      if (remoteHead && remoteHead === localHead) {
        return {
          name: 'git push',
          status: 'PASS',
          detail: 'Remote HEAD matches local',
        };
      }

      return {
        name: 'git push',
        status: 'WARN',
        detail: remoteHead
          ? `Remote HEAD differs from local`
          : 'Could not resolve remote HEAD',
      };
    } catch {
      return {
        name: 'git push',
        status: 'WARN',
        detail: 'Could not verify push status',
      };
    }
  }

  /**
   * Verify that claimed result is valid JSON (if applicable).
   */
  private verifyResultFormat(
    claimedResult?: { files?: string[]; published?: boolean; result?: unknown },
  ): VerifyCheck {
    if (!claimedResult?.result) {
      return { name: 'Result format', status: 'PASS', detail: 'No result to check' };
    }

    const result = claimedResult.result;
    if (typeof result === 'string') {
      // Check if it looks like JSON
      const trimmed = result.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          JSON.parse(trimmed);
          return { name: 'Result format', status: 'PASS' };
        } catch {
          return {
            name: 'Result format',
            status: 'FAIL',
            detail: 'Result looks like JSON but is not valid JSON',
          };
        }
      }
    }

    return { name: 'Result format', status: 'PASS' };
  }

  /**
   * Verify that the result is not empty when it shouldn't be.
   */
  private verifyNonEmptyResult(
    claimedResult?: { files?: string[]; published?: boolean; result?: unknown },
  ): VerifyCheck {
    if (!claimedResult?.result) {
      return { name: 'Result non-empty', status: 'PASS', detail: 'No result to check' };
    }

    const result = claimedResult.result;
    if (typeof result === 'string' && result.trim().length === 0) {
      return {
        name: 'Result non-empty',
        status: 'WARN',
        detail: 'Result is empty �?possible hallucination',
      };
    }

    if (Array.isArray(result) && result.length === 0) {
      return {
        name: 'Result non-empty',
        status: 'WARN',
        detail: 'Result is empty array',
      };
    }

    return { name: 'Result non-empty', status: 'PASS' };
  }

  /**
   * Run ESLint on src/ directory.
   */
  private verifyLint(): VerifyCheck {
    try {
      execSync('npx eslint src/ --ext .ts --quiet 2>&1', {
        cwd: this.workspaceRoot,
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      return { name: 'Lint check', status: 'PASS' };
    } catch {
      return {
        name: 'Lint check',
        status: 'WARN',
        detail: 'Lint issues found �?review recommended',
      };
    }
  }

  /**
   * Run TypeScript type checking.
   */
  private verifyTypeCheck(): VerifyCheck {
    try {
      execSync('npx tsc --noEmit 2>&1', {
        cwd: this.workspaceRoot,
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      return { name: 'Type check', status: 'PASS' };
    } catch {
      return {
        name: 'Type check',
        status: 'FAIL',
        detail: 'TypeScript compilation failed',
      };
    }
  }

  /**
   * Check if tool name indicates a file-modifying tool.
   */
  private isFileTool(toolName: string): boolean {
    const fileTools = [
      'write_file', 'write_file_sync',
      'edit', 'edit_file',
      'create_file', 'create_directory',
      'mkdir', 'rm', 'unlink', 'delete_file',
      'exec', 'shell',
    ];
    return fileTools.some((t) => toolName.includes(t));
  }

  /**
   * Evaluate all checks and determine overall status.
   */
  private evaluateChecks(checks: VerifyCheck[]): { status: 'PASS' | 'WARN' | 'FAIL'; checks: VerifyCheck[] } {
    if (checks.length === 0) return { status: 'PASS', checks };

    const hasFail = checks.some((c) => c.status === 'FAIL');
    const hasWarn = checks.some((c) => c.status === 'WARN');

    if (hasFail) return { status: 'FAIL', checks };
    if (hasWarn) return { status: 'WARN', checks };
    return { status: 'PASS', checks };
  }
}
