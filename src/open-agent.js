import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { ADAPTER_AGENTS } from './brands.js';

const AGENTS = ADAPTER_AGENTS;

function exists(file) {
  try { return file && fs.existsSync(file); } catch { return false; }
}

export function lookupBinary(name, extra = [], env = process.env) {
  const parts = [...extra, ...(String(env.PATH || '').split(path.delimiter))].filter(Boolean);
  for (const dir of parts) {
    const candidate = path.join(dir, name);
    if (exists(candidate)) return candidate;
  }
  return null;
}

export function detectAgents({ homedir = os.homedir(), env = process.env, platform = process.platform } = {}) {
  const claude = lookupBinary('claude', [
    path.join(homedir, '.local', 'bin'),
    path.join(homedir, '.claude', 'local'),
    '/opt/homebrew/bin',
    '/usr/local/bin'
  ], env);
  const codex = lookupBinary('codex', ['/opt/homebrew/bin', '/usr/local/bin'], env);
  const cursor = lookupBinary('cursor', ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin'], env);
  return {
    platform,
    Claude: { available: Boolean(claude), binary: claude, kind: 'cli', label: 'Claude Code' },
    Codex: { available: Boolean(codex), binary: codex, kind: 'cli', label: 'Codex CLI' },
    Cursor: { available: Boolean(cursor), binary: cursor, kind: 'gui', label: 'Cursor' }
  };
}

function applescriptQuote(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function openAgentCommand(agent, projectPath, detected = detectAgents()) {
  if (!AGENTS.includes(agent)) return { ok: false, agent, reason: 'Unknown agent.' };
  const resolved = path.resolve(projectPath || '');
  if (!resolved || !exists(resolved)) return { ok: false, agent, reason: 'Project path is not available on this machine.' };
  const info = detected[agent];
  if (!info?.available || !info.binary) {
    const how = agent === 'Claude'
      ? 'Claude Code CLI is not installed on PATH. Install Claude Code, then retry.'
      : agent === 'Codex'
        ? 'Codex CLI is not installed on PATH.'
        : 'Cursor CLI is not installed. Install the Cursor shell command, then retry.';
    return { ok: false, agent, reason: how };
  }
  if (agent === 'Cursor') {
    return { ok: true, agent, kind: 'gui', argv: [info.binary, resolved], cwd: resolved, command: info.binary };
  }
  const script = `cd ${applescriptQuote(resolved)} && exec ${applescriptQuote(info.binary)}`;
  if (detected.platform === 'darwin') {
    return {
      ok: true,
      agent,
      kind: 'terminal',
      argv: ['osascript', '-e', `tell application "Terminal" to do script ${applescriptQuote(script)}`],
      cwd: resolved,
      command: info.binary
    };
  }
  return { ok: true, agent, kind: 'cli', argv: [info.binary], cwd: resolved, command: info.binary };
}

export function launchAgent(plan, spawnFn = spawn) {
  if (!plan?.ok) return plan;
  const child = spawnFn(plan.argv[0], plan.argv.slice(1), {
    cwd: plan.cwd,
    detached: true,
    stdio: 'ignore'
  });
  child.unref();
  return { ...plan, launched: true, pid: child.pid || null };
}
