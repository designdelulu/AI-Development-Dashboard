#!/usr/bin/env node
// Antigravity CLI status-line helper. It persists only documented allowlisted
// identity/context/quota metadata. It never opens transcript_path or stores
// email, VCS, sandbox, prompt, or arbitrary status-line fields.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const stateFile = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'ai-dashboard', 'status_state.json');
const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
const text = value => typeof value === 'string' && value.trim() ? value.trim() : null;
const iso = value => { const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date.toISOString(); };
function allowed(payload) {
  const current = payload?.context_window?.current_usage || {};
  const quota = Object.fromEntries(Object.entries(payload?.quota || {}).map(([id, value]) => [id, { remainingFraction: finite(value?.remaining_fraction), resetTime: iso(value?.reset_time) }]).filter(([, value]) => value.remainingFraction != null));
  return { schemaVersion: 1, source: 'antigravity-cli-statusline', capturedAt: new Date().toISOString(), cwd: text(payload?.cwd), workspace: { currentDir: text(payload?.workspace?.current_dir), projectDir: text(payload?.workspace?.project_dir) }, model: { id: text(payload?.model?.id), displayName: text(payload?.model?.display_name) }, version: text(payload?.version), planTier: text(payload?.plan_tier), contextWindow: { totalInputTokens: finite(payload?.context_window?.total_input_tokens), totalOutputTokens: finite(payload?.context_window?.total_output_tokens), contextWindowSize: finite(payload?.context_window?.context_window_size), usedPercentage: finite(payload?.context_window?.used_percentage), remainingPercentage: finite(payload?.context_window?.remaining_percentage), currentUsage: { inputTokens: finite(current.input_tokens), outputTokens: finite(current.output_tokens), cacheCreationInputTokens: finite(current.cache_creation_input_tokens), cacheReadInputTokens: finite(current.cache_read_input_tokens) } }, quota };
}
function write(value) { fs.mkdirSync(path.dirname(stateFile), { recursive: true }); const temp = `${stateFile}.${process.pid}.tmp`; fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`); fs.renameSync(temp, stateFile); }
const raw = fs.readFileSync(0, 'utf8');
let payload = null; try { payload = JSON.parse(raw); } catch {}
if (payload) { try { write(allowed(payload)); } catch {} }
const at = process.argv.indexOf('--forward');
const command = at >= 0 ? process.argv.slice(at + 1).filter(part => part !== '--').join(' ').trim() : '';
if (command && !command.includes('antigravity-statusline-capture')) { const result = spawnSync(command, { input: raw, encoding: 'utf8', shell: true, stdio: ['pipe', 'pipe', 'pipe'] }); process.stdout.write(result.stdout || ''); }
