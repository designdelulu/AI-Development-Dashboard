import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { AdapterRegistry } from '../src/adapters/registry.js';
import { ADAPTER_CONTRACT_VERSION, validateManifest } from '../src/adapters/contract.js';
import { adapterContext } from '../src/adapters/context.js';
import { discoverClosedTools } from '../src/discovery.js';
import { sessionIdentity } from '../src/identity.js';
import { loadSettings, saveSettings } from '../src/config.js';
import { DEFAULT_PERMISSIONS, normalizePermissions } from '../src/permissions.js';
import { onboardingState, validateProjectRoots } from '../src/onboarding.js';
import { autostartPlan } from '../src/lifecycle/autostart.js';
import { readRuntime, removeRuntime, writeRuntime } from '../src/lifecycle/runtime-record.js';
import { scan } from '../src/core.js';

const temp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));

test('adapter registry validates manifests, isolates failures, and denies disabled local reads', () => {
  assert.equal(validateManifest({ id: 'bad id' }).valid, false);
  const adapter = {
    manifest: { id: 'fixture', contractVersion: ADAPTER_CONTRACT_VERSION, adapterVersion: 1, displayName: 'Fixture', kind: 'local', risk: 'local-read', capabilities: { history: 'exact' } },
    historicalSessions() { return { sessions: [] }; }
  };
  const registry = new AdapterRegistry().register(adapter);
  const denied = registry.run('historicalSessions', adapterContext({ permissions: { localRead: false } }))[0];
  assert.equal(denied.error.code, 'permission-denied');
  const supported = registry.run('historicalSessions', adapterContext())[0];
  assert.deepEqual(supported.value, { sessions: [] });
  assert.equal(registry.run('models', adapterContext())[0].unsupported, true);
});

test('async adapter isolation aborts a timed-out adapter without exposing write surfaces', async () => {
  const registry = new AdapterRegistry().register({
    manifest: { id: 'slow-fixture', contractVersion: ADAPTER_CONTRACT_VERSION, adapterVersion: 1, displayName: 'Slow fixture', kind: 'local', risk: 'local-read', capabilities: { health: true } },
    async health(context) { assert.equal(context.shell, undefined); assert.equal(context.credentials, undefined); await new Promise((resolve) => setTimeout(resolve, 30)); return { ok: true }; }
  });
  const result = await registry.runAsync('health', adapterContext(), { timeoutMs: 1 });
  assert.equal(result[0].error.code, 'adapter-timeout');
});

test('identity retains host, harness, provider, raw model, and normalized model independently', () => {
  const claude = sessionIdentity({ agent: 'Claude', host: 'Claude Code', model: 'kimi-k2.7-code' });
  assert.equal(claude.host, 'Claude Code');
  assert.equal(claude.provider, 'Moonshot');
  assert.equal(claude.modelRaw, 'kimi-k2.7-code');
  assert.equal(claude.modelId, 'kimi-k2.7-code');
  const harness = sessionIdentity({ agent: 'DeepSeek', host: 'terminal', harness: 'deepseek-harness', provider: 'OpenRouter', model: 'moonshotai/kimi-k2' });
  assert.equal(harness.harness, 'deepseek-harness');
  assert.equal(harness.provider, 'OpenRouter');
  assert.equal(harness.host, 'terminal');
  assert.equal(harness.model, 'moonshotai/kimi-k2');
});

test('closed discovery distinguishes installation from retained history without launching an application', () => {
  const home = temp('discovery-home'), bin = temp('discovery-bin');
  fs.mkdirSync(path.join(home, '.claude', 'projects'), { recursive: true });
  fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\n');
  const found = discoverClosedTools({ homedir: home, env: { PATH: bin }, platform: 'linux' });
  assert.equal(found.Claude.installed.state, 'detected');
  assert.equal(found.Claude.history.state, 'none-yet');
  assert.equal(found.Claude.history.recordCount, 0);
  assert.equal(found['DeepSeek Harness'].connection.state, 'not-applicable');
  assert.equal(found['DeepSeek Harness'].history.state, 'unsupported');
});

test('permission and onboarding migrations are independent and local-read denial prevents a scan', () => {
  const data = temp('settings'), home = temp('permission-home');
  fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ version: 1, permissions: { networkConnected: true } }));
  const migrated = loadSettings(data);
  assert.equal(migrated.version, 2);
  assert.equal(migrated.permissions.networkConnected, true);
  assert.equal(migrated.permissions.localIntegrationWrite, false);
  assert.deepEqual(normalizePermissions({ updateCheckNetwork: true }), { ...DEFAULT_PERMISSIONS, updateCheckNetwork: true });
  const denied = scan({ projectsRoots: [], claudeRoot: path.join(home, '.claude', 'projects'), codexRoot: path.join(home, '.codex', 'sessions'), cursorRoot: path.join(home, '.cursor', 'projects'), permissions: { localRead: false } }, null, { homedir: home });
  assert.equal(denied.sessions.length, 0);
  assert.deepEqual(denied.sourceStates, {});
  const root = path.join(home, 'Projects'); fs.mkdirSync(root);
  assert.equal(validateProjectRoots([root], { homedir: home }).valid, true);
  assert.equal(validateProjectRoots([home], { homedir: home }).valid, false);
  const saved = saveSettings(data, { onboarding: { step: 'complete', completedAt: '2026-08-22T00:00:00.000Z' } });
  assert.equal(saved.onboarding.step, 'complete');
  assert.equal(onboardingState({ step: 'not-real' }).step, 'welcome');
});

test('runtime records and autostart plans are per-user, opt-in foundations', () => {
  const folder = temp('runtime'), file = path.join(folder, 'runtime.json');
  writeRuntime(file, { pid: process.pid, script: '/tmp/dashboard', controlToken: 'not-in-cli-output' });
  assert.equal(readRuntime(file).pid, process.pid);
  removeRuntime(file);
  assert.equal(readRuntime(file), null);
  for (const platform of ['darwin', 'win32', 'linux']) {
    const plan = autostartPlan({ command: 'ai-dashboard', dataDir: folder, platform, homedir: '/tmp/user' });
    assert.equal(plan.enabledByDefault, false);
    assert.deepEqual(plan.command, ['ai-dashboard', 'start', '--no-open']);
    assert.match(plan.ownership, /per-user|systemd user/);
  }
});

test('repository CLI entrypoint and package bin expose lifecycle commands', () => {
  const output = execFileSync(process.execPath, ['src/cli.js', 'autostart'], { cwd: process.cwd(), encoding: 'utf8' });
  assert.match(output, /"enabledByDefault": false/);
  const bin = fs.readFileSync(path.join(process.cwd(), 'bin', 'ai-dashboard.js'), 'utf8');
  assert.match(bin, /main\(\)/);
});
