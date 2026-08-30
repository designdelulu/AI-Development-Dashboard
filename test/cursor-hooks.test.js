import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { classifyAgentState } from '../public/agent-state.js';
import { CURSOR_HOOK_EVENTS, CursorHookTracker, cursorHookBridgeScript, cursorHookConfigPlan, cursorHookInstallationStatus, cursorHookQueueSummary, cursorHookRecord, installCursorHooks, parseCursorHooksConfig, readCursorHookRecords, removeCursorHooks } from '../src/cursor-hooks.js';

const tempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aidash-cursor-hooks-'));

test('Cursor Hook configuration preserves unrelated hooks and is idempotent', () => {
  const root = tempRoot(), home = path.join(root, 'home'), dataDir = path.join(root, 'data'), configFile = path.join(home, '.cursor', 'hooks.json');
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.writeFileSync(configFile, JSON.stringify({ version: 1, hooks: { afterFileEdit: [{ command: './hooks/user-format.sh' }], stop: [{ command: './hooks/user-stop.sh' }] } }));
  const preview = installCursorHooks({ home, dataDir });
  assert.equal(preview.state, 'preview');
  assert.equal(fs.existsSync(path.join(home, '.cursor', 'hooks', 'ai-dashboard-cursor-hook')), false);
  const installed = installCursorHooks({ home, dataDir, confirm: true, now: () => 42 });
  assert.equal(installed.state, 'installed');
  assert.equal(fs.existsSync(`${configFile}.ai-dashboard-backup-42`), true);
  const first = parseCursorHooksConfig(fs.readFileSync(configFile, 'utf8')).value;
  assert.equal(first.hooks.afterFileEdit.some((entry) => entry.command === './hooks/user-format.sh'), true);
  assert.equal(first.hooks.stop.some((entry) => entry.command === './hooks/user-stop.sh'), true);
  assert.equal(Object.values(first.hooks).flat().filter((entry) => entry.command.includes('ai-dashboard-cursor-hook')).length, CURSOR_HOOK_EVENTS.length);
  installCursorHooks({ home, dataDir, confirm: true, now: () => 43 });
  const second = parseCursorHooksConfig(fs.readFileSync(configFile, 'utf8')).value;
  assert.equal(Object.values(second.hooks).flat().filter((entry) => entry.command.includes('ai-dashboard-cursor-hook')).length, CURSOR_HOOK_EVENTS.length);
  assert.equal(cursorHookInstallationStatus({ home, dataDir }).state, 'configured');
  assert.equal(cursorHookInstallationStatus({ home, dataDir }).bridge, 'ready');
  const removed = removeCursorHooks({ home, dataDir, confirm: true, now: () => 44 });
  assert.equal(removed.state, 'removed');
  const final = parseCursorHooksConfig(fs.readFileSync(configFile, 'utf8')).value;
  assert.equal(final.hooks.afterFileEdit.some((entry) => entry.command === './hooks/user-format.sh'), true);
  assert.equal(final.hooks.stop.some((entry) => entry.command === './hooks/user-stop.sh'), true);
  assert.equal(Object.values(final.hooks).flat().some((entry) => entry.command.includes('ai-dashboard-cursor-hook')), false);
});

test('Cursor Hook installation safely refuses malformed user configuration', () => {
  const root = tempRoot(), home = path.join(root, 'home'), dataDir = path.join(root, 'data'), configFile = path.join(home, '.cursor', 'hooks.json');
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.writeFileSync(configFile, '{not json');
  assert.equal(cursorHookInstallationStatus({ home, dataDir }).state, 'invalid-config');
  assert.deepEqual(installCursorHooks({ home, dataDir, confirm: true }), { state: 'refused', reason: 'invalid-json' });
  assert.equal(fs.readFileSync(configFile, 'utf8'), '{not json');
});

test('Cursor Hook bridge drains private stdin and persists only a structural allowlist record', () => {
  const root = tempRoot(), script = path.join(root, 'bridge.sh'), queue = path.join(root, 'events.jsonl');
  fs.writeFileSync(script, cursorHookBridgeScript(), { mode: 0o700 });
  const privateInput = JSON.stringify({ prompt: 'private prompt', text: 'private response', tool_input: { command: 'private shell command' }, file_path: '/private/workspace/file.ts' });
  execFileSync('/bin/sh', [script, 'preToolUse'], { input: privateInput, env: { ...process.env, AI_DASHBOARD_CURSOR_HOOK_FILE: queue } });
  const raw = fs.readFileSync(queue, 'utf8');
  assert.doesNotMatch(raw, /private|prompt|response|command|file_path/i);
  const parsed = readCursorHookRecords(queue);
  assert.equal(parsed.records.length, 1);
  assert.deepEqual(Object.keys(parsed.records[0]).sort(), ['event', 'schema', 'source', 'timestamp']);
  assert.equal(parsed.records[0].event, 'preToolUse');
  assert.deepEqual(cursorHookQueueSummary(queue, { now: () => parsed.records[0].timestamp }).recentCounts, { preToolUse: 1 });
  assert.equal(cursorHookRecord({ source: 'cursor-hooks', event: 'preToolUse', timestamp: 1, schema: 1, prompt: 'must reject' }), null);
});

test('official Cursor Hook lifecycle stays Working through quiet inference and stops as Recently Active', () => {
  const tracker = new CursorHookTracker({ orphanMaxMs: 30_000 });
  const start = { source: 'cursor-hooks', event: 'beforeSubmitPrompt', timestamp: 1_000, schema: 1 };
  assert.equal(tracker.observe(start, 1_000).started, true);
  assert.equal(tracker.signal(25_000)?.active, true);
  assert.equal(classifyAgentState([], 'Cursor', 25_000, { presence: { state: 'present' }, inProgress: tracker.signal(25_000) }).state, 'Working');
  const pulse = tracker.observe({ source: 'cursor-hooks', event: 'afterFileEdit', timestamp: 25_001, schema: 1 }, 25_001);
  assert.equal(pulse.pulse, true);
  const stop = tracker.observe({ source: 'cursor-hooks', event: 'stop', timestamp: 26_000, schema: 1 }, 26_000);
  assert.equal(stop.completed, true);
  assert.equal(classifyAgentState([], 'Cursor', 26_001, { presence: { state: 'present' }, completion: tracker.completion(26_001) }).state, 'Recently Active');
  assert.equal(classifyAgentState([], 'Cursor', 27_000, { presence: { state: 'present' }, inProgress: tracker.signal(27_000), completion: tracker.completion(27_000) }).state, 'Recently Active');
  assert.equal(tracker.signal(31_001), null);
});

test('an official Cursor tool or thought hook starts a turn when the prompt hook is absent', () => {
  const tracker = new CursorHookTracker({ orphanMaxMs: 60_000 });
  const tool = tracker.observe({ source: 'cursor-hooks', event: 'preToolUse', timestamp: 1_000, schema: 1 }, 1_000);
  assert.equal(tool.started, true);
  assert.equal(tool.pulse, true);
  assert.equal(classifyAgentState([], 'Cursor', 30_000, { presence: { state: 'present' }, inProgress: tracker.signal(30_000) }).state, 'Working');
  const thought = tracker.observe({ source: 'cursor-hooks', event: 'afterAgentThought', timestamp: 30_001, schema: 1 }, 30_001);
  assert.equal(thought.pulse, true);
  assert.equal(thought.started, false);
});

test('Cursor Hook queue does not accept Cline or unknown agent identity fields', () => {
  const root = tempRoot(), queue = path.join(root, 'events.jsonl');
  fs.writeFileSync(queue, '{"source":"cursor-hooks","event":"preToolUse","timestamp":1,"schema":1,"agent":"Cline"}\n{"source":"cursor-hooks","event":"unknown","timestamp":1,"schema":1}\n');
  assert.deepEqual(readCursorHookRecords(queue).records, []);
  const plan = cursorHookConfigPlan({ version: 1, hooks: { preToolUse: [{ command: './cline-hook.sh' }] } }, { bridgePath: '/bridge', queuePath: '/queue' });
  assert.equal(plan.config.hooks.preToolUse.some((entry) => entry.command === './cline-hook.sh'), true);
});
