#!/usr/bin/env node

/**
 * Sentinel AgentOS CLI
 *
 * Command-line interface for Sentinel AgentOS operations.
 *
 * Quick start:
 *   npx sentinel-agentos validate exec "command=rm -rf /"
 *   npx sentinel-agentos validate write_file path=demo.ts content=hello
 *   npx sentinel-agentos risk exec command="npm test"
 *   npx sentinel-agentos audit --limit 10
 *   npx sentinel-agentos status
 *   npx sentinel-agentos server --port 3300
 */

import { AgentOS } from './core';

function printHelp(): void {
  console.log(`
🛡️ Sentinel AgentOS CLI

Usage:
  sentinel-agentos validate <tool> [key=value...]
  sentinel-agentos risk <tool> [key=value...]
  sentinel-agentos audit [--limit N]
  sentinel-agentos stats
  sentinel-agentos profile
  sentinel-agentos status
  sentinel-agentos server [--port N] [--token ***
  sentinel-agentos memory
  sentinel-agentos help

Examples:
  sentinel-agentos validate exec command="rm -rf /"
  sentinel-agentos validate write_file path=src/main.ts content="console.log(1)"
  sentinel-agentos risk exec command="sudo reboot"
  sentinel-agentos audit --limit 10
  sentinel-agentos status
  sentinel-agentos server --port 3300 --token ***
`);
}

function fatal(msg: string): never {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

/**
 * Parse positional key=value pairs into a params object.
 * Supports: key=value, key="value with spaces", key='value'
 */
function parseParams(args: string[]): Record<string, unknown> {
  const params: Record<string, unknown> = {};

  for (const arg of args) {
    const eqIdx = arg.indexOf('=');
    if (eqIdx === -1) continue;

    const key = arg.slice(0, eqIdx);
    let val = arg.slice(eqIdx + 1);

    // Strip quotes if present
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }

    // Auto-detect type
    if (val === 'true') params[key] = true;
    else if (val === 'false') params[key] = false;
    else if (val === 'null') params[key] = null;
    else if (/^\d+$/.test(val)) params[key] = parseInt(val, 10);
    else if (/^\d+\.\d+$/.test(val)) params[key] = parseFloat(val);
    else params[key] = val;
  }

  return params;
}

/**
 * Parse --flag value options from args.
 * Skips positional key=value items.
 */
function parseFlags(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg && arg.startsWith('--')) {
      const key = arg.replace(/^--/, '');
      const next = args[i + 1];
      // Don't consume if next is a flag or key=value
      if (next && !next.startsWith('--') && !next.includes('=')) {
        result[key] = next;
        i++;
      } else {
        result[key] = 'true';
      }
    }
  }
  return result;
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const cmd = rawArgs[0] ?? '';

  if (!cmd || cmd === 'help') {
    printHelp();
    return;
  }

  const aos = new AgentOS();

  switch (cmd) {
    case 'validate':
    case 'risk': {
      // New syntax: sentinel-agentos validate <tool> [key=value...]
      // Old syntax still works: --tool <tool> --params '<json>'
      const flags = parseFlags(rawArgs.slice(1));
      let tool: string;
      let params: Record<string, unknown>;

      // New positional syntax
      const positional = rawArgs.slice(1).filter(a => !a.startsWith('--'));
      const firstPos = positional[0];
      const isNewSyntax = positional.length > 0 && firstPos !== undefined && !firstPos.includes('=');

      if (isNewSyntax && positional[0]) {
        tool = positional[0];
        params = parseParams(positional.slice(1));
      } else if (isNewSyntax) {
        fatal(`Usage: sentinel-agentos ${cmd} <tool> [key=value...]`);
      } else {
        // Old --tool + --params syntax
        const toolFlag = flags.tool ?? rawArgs[1];
        tool = toolFlag ?? '';
        if (!tool) fatal(`Usage: sentinel-agentos ${cmd} <tool> [key=value...]`);
        const paramsJson = flags.params ?? '{}';
        try { params = JSON.parse(paramsJson); } catch { params = parseParams(rawArgs.slice(2)); }
      }

      const result = aos.executePipeline({
        sessionId: 'cli',
        agentId: 'cli',
        toolName: tool,
        parameters: params,
      });

      if (cmd === 'validate') {
        console.log(JSON.stringify(result.preExec.schemaCheck, null, 2));
      } else {
        console.log(JSON.stringify(result.preExec.riskScore, null, 2));
      }
      break;
    }

    case 'audit': {
      const flags = parseFlags(rawArgs.slice(1));
      const limit = parseInt(flags.limit ?? '20', 10);
      const entries = aos.guard.audit.query({ limit });
      console.log(JSON.stringify(entries, null, 2));
      break;
    }

    case 'stats': {
      const stats = aos.getAuditStats();
      console.log(JSON.stringify(stats, null, 2));
      break;
    }

    case 'profile': {
      const profile = aos.getProfile();
      console.log(JSON.stringify(profile, null, 2));
      break;
    }

    case 'status': {
      console.log(aos.statusReport());
      break;
    }

    case 'server': {
      const flags = parseFlags(rawArgs.slice(1));
      const port = parseInt(flags.port ?? '3300', 10);
      const host = flags.host ?? '127.0.0.1';
      const token = flags.token;

      try {
        const { createServer } = await import('./server');
        const server = createServer({ port, host, apiToken: token });
        await server.start();
        console.log('Press Ctrl+C to stop');

        process.on('SIGINT', async () => {
          console.log('\nShutting down...');
          await server.stop();
          process.exit(0);
        });
      } catch (err: any) {
        fatal(`Failed to start server: ${err.message}`);
      }
      break;
    }

    case 'memory': {
      const context = aos.injectContext();
      console.log(context || '(no memory context yet)');
      break;
    }

    default:
      fatal(`Unknown command: ${cmd}. Run 'sentinel-agentos help' for usage.`);
  }
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
