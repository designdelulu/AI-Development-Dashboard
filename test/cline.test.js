import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clineInstallationState, clineLiveDecision, discoverCline, readClineSessionMetadata, scanCline } from '../src/cline.js';
import * as clineAdapter from '../src/adapters/cline.js';
import { discoverClosedTools } from '../src/discovery.js';
import { ClineSessionTracker } from '../src/live-work.js';
import { scan } from '../src/core.js';
import { AdapterRegistry } from '../src/adapters/registry.js';

const temp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); };

function fixture() {
  const home = temp('cline-home');
  const project = path.join(home, 'Projects', 'demo');
  fs.mkdirSync(path.join(project, '.git'), { recursive: true });
  const sessions = path.join(home, '.cline', 'data', 'sessions');
  return { home, project, sessions };
}

test('Cline absent and installed-while-closed states stay separate', () => {
  const home = temp('cline-absent');
  assert.equal(clineInstallationState({ homeDir: home, env: { PATH: '' }, platform: 'linux' }).installed, false);
  fs.mkdirSync(path.join(home, '.cline', 'data', 'sessions'), { recursive: true });
  const state = discoverCline({ homeDir: home, env: { PATH: '' }, platform: 'linux', now: new Date('2026-08-23T00:00:00Z') });
  assert.equal(state.installed.state, 'detected');
  assert.equal(state.history.state, 'none-yet');
  assert.equal(state.live.state, 'unknown');
  assert.equal(state.connection.state, 'not-applicable');
  assert.equal(state.telemetry.jsonSnapshots, 0);
});

test('Cline session metadata preserves Cline, VS Code, OpenRouter, provider, model, project, and exact tokens', () => {
  const { home, project, sessions } = fixture();
  const file = path.join(sessions, 'session-one.json');
  write(file, {
    sessionId: 'session-one', status: 'completed', client: 'vscode', createdAt: '2026-08-22T12:00:00Z', updatedAt: '2026-08-22T12:05:00Z',
    manifest: { workspaceRoot: project }, providerId: 'openrouter', modelId: 'moonshotai/kimi-k2',
    usage: { inputTokens: 1200, outputTokens: 400, reasoningTokens: 80 },
    providers: { apiKey: 'fake-secret-must-not-escape' }, messages: [{ role: 'user', content: 'private prompt' }]
  });
  const result = scanCline([{ id: 'project:demo', canonicalPath: project }], path.join(home, '.cline'), new Map(), { now: new Date('2026-08-23T00:00:00Z') });
  assert.equal(result.sessions.length, 1);
  const session = result.sessions[0];
  assert.equal(session.agent, 'Cline');
  assert.equal(session.host, 'VS Code');
  assert.equal(session.gateway, 'OpenRouter');
  assert.equal(session.provider, 'Moonshot');
  assert.equal(session.modelId, 'moonshotai/kimi-k2');
  assert.equal(session.projectId, 'project:demo');
  assert.equal(session.attributionConfidence, 'Confirmed');
  assert.equal(session.tokens.freshInput, 1200);
  assert.equal(session.tokens.output, 400);
  assert.equal(session.tokenEvidence, undefined);
  assert.doesNotMatch(JSON.stringify(session), /fake-secret|private prompt|providers|messages/i);
  assert.equal(readClineSessionMetadata(file).status, 'complete');
});

test('unknown Cline schema is skipped without creating fake history or tokens', () => {
  const { home, sessions } = fixture();
  write(path.join(sessions, 'unknown.json'), { schemaVersion: 99, sessionId: 'future', status: 'completed', random: 'future', content: 'not inspected as metadata' });
  const result = scanCline([], path.join(home, '.cline'));
  assert.equal(result.sessions.length, 0);
  assert.equal(result.diagnostics.clineRecordsParsed, 0);
  assert.equal(result.diagnostics.clineUnsupported, 1);
  assert.equal(result.diagnostics.clineMalformed, 0);
});

test('Cline structured session lifecycle keeps real work Working and clears on completion', () => {
  const { home, sessions } = fixture();
  const file = path.join(sessions, 'live.json');
  write(file, { sessionId: 'live', status: 'running', updatedAt: '2026-08-23T00:00:00Z', manifest: { cwd: home } });
  const metadata = readClineSessionMetadata(file);
  const tracker = new ClineSessionTracker({ maxAgeMs: 60_000 });
  const started = tracker.observe(file, metadata, Date.parse('2026-08-23T00:00:01Z'));
  assert.equal(started.active, true);
  assert.equal(tracker.signal(Date.parse('2026-08-23T00:00:20Z')).active, true);
  write(file, { sessionId: 'live', status: 'completed', updatedAt: '2026-08-23T00:00:21Z', manifest: { cwd: home } });
  const completed = tracker.observe(file, readClineSessionMetadata(file), Date.parse('2026-08-23T00:00:21Z'));
  assert.equal(completed.completed, true);
  assert.equal(tracker.signal(Date.parse('2026-08-23T00:00:22Z')), null);
  assert.equal(clineLiveDecision(file, { size: 10, mtimeMs: 1 }, { size: 20, mtimeMs: 2 }, readClineSessionMetadata(file)).completed, true);
});

test('Cline adapter is registry-backed, dynamic, and never a capacity source', () => {
  assert.equal(clineAdapter.manifest.id, 'cline');
  assert.equal(clineAdapter.manifest.runtime.agent, 'Cline');
  assert.equal(clineAdapter.manifest.capabilities.capacity, 'unsupported');
  const { home, project, sessions } = fixture();
  write(path.join(sessions, 'dynamic.json'), { sessionId: 'dynamic', status: 'completed', updatedAt: '2026-08-23T00:00:00Z', manifest: { cwd: project }, providerId: 'openrouter', modelId: 'qwen/qwen-future-2099', usage: { inputTokens: 3, outputTokens: 2 } });
  const value = scan({ projectsRoots: [path.dirname(project)], clineRoot: path.join(home, '.cline'), clineSessionsRoot: sessions, permissions: { localRead: true } }, null, { registry: new AdapterRegistry().register(clineAdapter), homedir: home, now: new Date('2026-08-23T00:01:00Z') });
  const session = value.sessions.find((item) => item.adapterId === 'cline');
  assert.equal(session.agent, 'Cline');
  assert.equal(session.gateway, 'OpenRouter');
  assert.equal(session.modelId, 'qwen/qwen-future-2099');
  assert.equal(value.sourceStates.Cline.history.state, 'observed');
  assert.equal(value.runtimeCatalog.liveRuntimes.some((runtime) => runtime.agent === 'Cline'), true);
  assert.equal(value.runtimeCatalog.liveRuntimes.some((runtime) => runtime.agent === 'OpenRouter'), false);
});

test('closed discovery finds Cline without launching it or reading provider credentials', () => {
  const home = temp('cline-discovery');
  fs.mkdirSync(path.join(home, '.cline', 'data', 'sessions'), { recursive: true });
  write(path.join(home, '.cline', 'data', 'settings', 'providers.json'), { openrouter: { apiKey: 'fake-inference-secret' } });
  const found = discoverClosedTools({ homedir: home, env: { PATH: '' }, platform: 'linux' });
  assert.equal(found.Cline.installed.state, 'detected');
  assert.equal(found.Cline.history.state, 'none-yet');
  assert.equal(JSON.stringify(found.Cline).includes('fake-inference-secret'), false);
});
