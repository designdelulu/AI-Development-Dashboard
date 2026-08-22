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
import { createOpenRouterService } from '../src/openrouter/service.js';
import { analyticsSchema, normalizeAnalytics } from '../src/openrouter/analytics.js';
import { shareableStack } from '../src/sharing.js';
import { antigravityCapacity, antigravityCaptureConfigured, antigravitySettingsPath, antigravityStatePath, disableAntigravityCapture, enableAntigravityCapture, normalizeAntigravityStatus, previewAntigravityCapture, readAntigravitySettings } from '../src/antigravity.js';
import { EFFICIENCY_EVIDENCE, buildEfficiencyFoundation, classifyValidationCommand, detectedModelSwitches, efficiencySnapshot, inferPossibleRework, structuralEventsFromRecord } from '../src/efficiency.js';
import { applyEfficiencyMetadata, beginComparisonTracking, createCycle, EFFICIENCY_METADATA_VERSION, loadEfficiencyMetadata, recordOutcome, saveEfficiencyMetadata } from '../src/efficiency-store.js';
import { readPlanCapacity } from '../src/capacity.js';

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
  assert.equal(migrated.version, 3);
  assert.equal(migrated.permissions.networkConnected, true);
  assert.equal(migrated.permissions.localIntegrationWrite, false);
  assert.deepEqual(normalizePermissions({ updateCheckNetwork: true }), { ...DEFAULT_PERMISSIONS, updateCheckNetwork: true });
  const denied = scan({ projectsRoots: [], claudeRoot: path.join(home, '.claude', 'projects'), codexRoot: path.join(home, '.codex', 'sessions'), cursorRoot: path.join(home, '.cursor', 'projects'), permissions: { localRead: false } }, null, { homedir: home });
  assert.equal(denied.sessions.length, 0);
  assert.equal(denied.sourceStates.OpenRouter.connection.state, 'disabled');
  const root = path.join(home, 'Projects'); fs.mkdirSync(root);
  assert.equal(validateProjectRoots([root], { homedir: home }).valid, true);
  assert.equal(validateProjectRoots([home], { homedir: home }).valid, false);
  const saved = saveSettings(data, { onboarding: { step: 'complete', completedAt: '2026-08-22T00:00:00.000Z' } });
  assert.equal(saved.onboarding.step, 'complete');
  assert.equal(onboardingState({ step: 'not-real' }).step, 'welcome');
});

function response(status, value) { return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => JSON.stringify(value) }; }
function openRouterFixture() {
  const data = temp('openrouter'), calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/analytics/meta')) return response(200, { data: { metrics: ['total_usage', 'request_count', 'tokens_total', 'tokens_prompt', 'tokens_completion', 'tokens_reasoning', 'tokens_cached'], dimensions: ['model', 'provider'] } });
    if (url.endsWith('/analytics/query')) {
      const payload = JSON.parse(init.body);
      if (payload.dimensions[0] === 'model') return response(200, { data: { data: [{ model: 'moonshotai/kimi-k2', total_usage: '1.25', request_count: '2', tokens_total: '400', tokens_prompt: '250', tokens_completion: '100', tokens_reasoning: '25', tokens_cached: '25' }], metadata: { truncated: false } } });
      return response(200, { data: { data: [{ provider: 'Moonshot', total_usage: '1.25', request_count: '2', tokens_total: '400' }] } });
    }
    if (url.endsWith('/credits')) return response(200, { data: { total_credits: '20', total_usage: '1.25' } });
    throw new Error(`unexpected ${url}`);
  };
  return { data, dataDir: data, calls, fetchImpl, env: { OPENROUTER_MANAGEMENT_KEY: 'test-management-secret' } };
}

test('OpenRouter disabled connector makes zero network calls and settings persist no secret', () => {
  const fixture = openRouterFixture();
  const service = createOpenRouterService(fixture);
  assert.equal(service.state().enabled, false);
  assert.equal(fixture.calls.length, 0);
  saveSettings(fixture.data, { openRouterKey: 'must-not-persist', connectedServices: { openRouter: { enabled: true, credentialRef: 'env:OPENROUTER_MANAGEMENT_KEY' } } });
  const stored = fs.readFileSync(path.join(fixture.data, 'settings.json'), 'utf8');
  assert.equal(stored.includes('test-management-secret'), false);
  assert.equal(stored.includes('must-not-persist'), false);
  assert.match(stored, /env:OPENROUTER_MANAGEMENT_KEY/);
});

test('OpenRouter connected usage is exact, dynamically normalizes models, and keeps identity/project distinct', async () => {
  const fixture = openRouterFixture();
  const service = createOpenRouterService({ ...fixture, now: () => new Date('2026-08-22T12:00:00Z') });
  const state = await service.connect({ period: 'today' });
  assert.equal(state.enabled, true);
  assert.equal(fixture.calls.length, 4);
  assert.ok(fixture.calls.every((call) => call.init.headers.Authorization === 'Bearer test-management-secret'));
  const row = state.cached.models[0];
  assert.equal(row.evidence, 'Exact');
  assert.equal(row.modelId, 'moonshotai/kimi-k2');
  assert.equal(row.provider, 'Moonshot');
  assert.equal(row.gateway, 'OpenRouter');
  assert.equal(row.agent, null);
  assert.equal(row.host, null);
  assert.equal(row.projectId, null);
  assert.equal(row.attributionConfidence, 'Unknown');
  assert.equal(state.cached.summary.cost, 1.25);
  assert.equal(state.cached.credits.totalCredits, 20);
  assert.equal(JSON.stringify(state).includes('test-management-secret'), false);
  assert.equal(JSON.stringify(shareableStack({ summary: { agents: [], tokens: {}, sessions: 0, activeProjects: 0, capabilityUses: 0 }, sessions: [], capabilities: [], efficiency: { components: {}, period: {} }, openRouter: state.cached })).includes('test-management-secret'), false);
});

test('OpenRouter handles partial schemas, invalid credentials, stale cache, and disconnect without leaking credential', async () => {
  const fixture = openRouterFixture();
  const service = createOpenRouterService(fixture);
  await service.connect();
  const broken = createOpenRouterService({ ...fixture, fetchImpl: async (url) => url.endsWith('/analytics/meta') ? response(200, { data: { metrics: ['unrelated'], dimensions: [] } }) : response(500, {}) });
  await assert.rejects(() => broken.sync(), { code: 'partial-schema' });
  assert.equal(broken.state().cached.stale, true);
  assert.equal(broken.state().lastError, 'partial-schema');
  const invalid = createOpenRouterService({ ...fixture, fetchImpl: async () => response(401, { error: 'bad secret should not surface' }) });
  await assert.rejects(() => invalid.sync(), { code: 'invalid-credential' });
  const unavailable = createOpenRouterService({ ...fixture, fetchImpl: async () => response(503, {}) });
  await assert.rejects(() => unavailable.sync(), { code: 'service-unavailable' });
  const disconnected = service.disconnect();
  assert.equal(disconnected.enabled, false);
  assert.equal(disconnected.credential.reference, null);
  assert.ok(disconnected.cached);
  assert.equal(JSON.stringify(disconnected).includes('test-management-secret'), false);
});

test('OpenRouter analytics schema ignores unsupported fields and preserves declared exact evidence', () => {
  const schema = analyticsSchema({ data: { metrics: ['total_usage', 'tokens_total', 'unknown_metric'], dimensions: ['model', 'three-dimensional'] } });
  assert.deepEqual(schema, { metrics: ['total_usage', 'tokens_total'], dimensions: ['model'] });
  const normalized = normalizeAnalytics({ schema, range: { start: '2026-08-01T00:00:00Z', end: '2026-08-02T00:00:00Z' }, modelResponse: { data: { data: [{ model: 'future-lab/new-model', total_usage: '0.2', tokens_total: '10' }], metadata: { truncated: true } } }, providerResponse: { data: { data: [] } }, creditsResponse: { data: {} } });
  assert.equal(normalized.models[0].modelId, 'future-lab/new-model');
  assert.equal(normalized.models[0].evidence, 'Exact');
  assert.equal(normalized.truncated, true);
});

function antigravityStatus(overrides = {}) {
  return {
    schemaVersion: 1, capturedAt: '2026-08-22T12:00:00.000Z',
    model: { id: 'claude-sonnet-4', displayName: 'Claude Sonnet 4' },
    workspace: { projectDir: '/projects/alpha' }, version: '1.1.17', planTier: 'Pro',
    contextWindow: { totalInputTokens: 1200, totalOutputTokens: 200, contextWindowSize: 200000, usedPercentage: 12, remainingPercentage: 88, currentUsage: { inputTokens: 800, outputTokens: 100, cacheReadInputTokens: 250, cacheCreationInputTokens: 50 } },
    quota: { 'shared-weekly': { remainingFraction: .42, resetTime: '2026-08-24T12:00:00Z' }, 'flash-bucket': { remainingFraction: .9, resetTime: '2026-08-23T12:00:00Z' } },
    ...overrides
  };
}

test('Antigravity closed discovery distinguishes installed root from unsupported history and absent CLI', () => {
  const home = temp('antigravity-closed');
  fs.mkdirSync(path.join(home, '.gemini', 'antigravity'), { recursive: true });
  const detected = discoverClosedTools({ homedir: home, env: { PATH: '' }, platform: 'linux' }).Antigravity;
  assert.equal(detected.installed.state, 'detected');
  assert.equal(detected.history.state, 'unsupported');
  assert.equal(detected.live.state, 'unknown');
  assert.equal(detected.installed.evidence.includes('binary'), false);
  const absent = discoverClosedTools({ homedir: temp('antigravity-absent'), env: { PATH: '' }, platform: 'linux' }).Antigravity;
  assert.equal(absent.installed.state, 'not-detected');
});

test('Antigravity status normalization retains host/provider/model and shared quota buckets separately', () => {
  const normalized = normalizeAntigravityStatus(antigravityStatus());
  assert.equal(normalized.host, 'Antigravity');
  assert.equal(normalized.agent, null);
  assert.equal(normalized.provider, 'Anthropic');
  assert.equal(normalized.modelId, 'claude-sonnet-4');
  assert.equal(normalized.context.evidence, 'Exact');
  assert.equal(normalized.context.cacheRead, 250);
  assert.equal(normalized.quotaBuckets.length, 2);
  assert.equal(normalized.quotaBuckets[0].id, 'shared-weekly');
  assert.equal(normalized.quotaBuckets[0].remainingPercent, 42);
  assert.equal(normalized.quotaBuckets[0].resetAt, '2026-08-24T12:00:00.000Z');
  assert.equal(normalized.live.state, 'unsupported');
  assert.equal(normalized.projectPath, '/projects/alpha');
  const gemini = normalizeAntigravityStatus(antigravityStatus({ model: { id: 'gemini-3.5-flash', displayName: 'Gemini 3.5 Flash' } }));
  assert.equal(gemini.host, 'Antigravity');
  assert.equal(gemini.provider, 'Google');
  assert.equal(gemini.modelId, 'gemini-3.5-flash');
  assert.equal(normalizeAntigravityStatus({ schemaVersion: 2 }), null);
});

test('Antigravity bridge preview, permission denial, preserve, restore, and stale capacity are deterministic', () => {
  const home = temp('antigravity-bridge'), settingsFile = antigravitySettingsPath(home);
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify({ statusLine: { type: 'command', command: 'existing-statusline --safe', padding: 2 }, unrelated: { keep: true } }));
  const preview = previewAntigravityCapture(home, { cliPresent: true });
  assert.equal(preview.hasExistingStatusline, true);
  assert.equal(preview.excludedFields.includes('email'), true);
  assert.throws(() => enableAntigravityCapture(home, { permission: false, confirmation: true, cliPresent: true }), { code: 'permission-denied' });
  assert.throws(() => enableAntigravityCapture(home, { permission: true, confirmation: false, cliPresent: true }), { code: 'confirmation-required' });
  const enabled = enableAntigravityCapture(home, { permission: true, confirmation: true, cliPresent: true });
  assert.equal(enabled.changed, true);
  const configured = readAntigravitySettings(home);
  assert.equal(antigravityCaptureConfigured(configured, home), true);
  assert.match(configured.statusLine.command, /existing-statusline --safe/);
  assert.equal(configured.statusLine.stack_with_default, true);
  assert.equal(configured.unrelated.keep, true);
  fs.writeFileSync(antigravityStatePath(home), JSON.stringify(antigravityStatus({ capturedAt: '2026-08-01T00:00:00.000Z' })));
  const stale = antigravityCapacity(home, { cliPresent: true, now: Date.parse('2026-08-22T12:00:00Z') });
  assert.equal(stale.status, 'Stale');
  assert.equal(stale.windows.length, 2);
  fs.writeFileSync(antigravityStatePath(home), JSON.stringify(antigravityStatus({ quota: {} })));
  assert.equal(antigravityCapacity(home, { cliPresent: true }).status, 'Unavailable');
  const disabled = disableAntigravityCapture(home, { permission: true, confirmation: true });
  assert.equal(disabled.restored, true);
  assert.equal(readAntigravitySettings(home).statusLine.command, 'existing-statusline --safe');
});

test('Antigravity capacity dynamically joins registered providers without model quota cloning', () => {
  const home = temp('antigravity-capacity');
  enableAntigravityCapture(home, { permission: true, confirmation: true, cliPresent: true });
  fs.writeFileSync(antigravityStatePath(home), JSON.stringify(antigravityStatus()));
  const capacity = readPlanCapacity(home, { antigravityCliPresent: true });
  const source = capacity.providers.find(item => item.provider === 'Antigravity quota');
  assert.equal(source.status, 'Available');
  assert.equal(source.windows.length, 2);
  assert.equal(source.model, 'claude-sonnet-4');
  assert.equal(source.windows.some(item => item.label === 'claude-sonnet-4'), false);
  const script = fs.readFileSync(path.join(process.cwd(), 'scripts', 'antigravity-statusline-capture.mjs'), 'utf8');
  assert.doesNotMatch(script, /transcript_path\)/);
  assert.match(script, /never opens transcript_path/);
});

function efficiencySession(overrides = {}) {
  return {
    id: 'Codex:eff-1', agent: 'Codex', host: 'Codex CLI', harness: 'standalone', provider: 'OpenAI', model: 'GPT-5.6', modelRaw: 'gpt-5.6', modelId: 'gpt-5.6', projectId: 'project:alpha', attributionConfidence: 'Confirmed', timestamp: '2026-08-21T10:00:00.000Z', usageStartedAt: '2026-08-21T10:00:00.000Z', usageEndedAt: '2026-08-21T10:20:00.000Z', recordedAt: '2026-08-21T10:21:00.000Z', tokenDays: { '2026-08-21': { date: '2026-08-21', firstAt: '2026-08-21T10:00:00.000Z', lastAt: '2026-08-21T10:20:00.000Z', eventCount: 2, evidence: 'exact', tokens: { freshInput: 100, output: 25, cacheRead: 50, cacheCreation: 0, reasoning: 0, other: 0 } } },
    efficiencyEvents: [], ...overrides
  };
}

test('efficiency structural events classify only bounded measured metadata', () => {
  assert.equal(classifyValidationCommand('npm test -- --runInBand'), 'javascript-test');
  assert.equal(classifyValidationCommand('echo $PRIVATE_TEXT'), null);
  const events = structuralEventsFromRecord({ timestamp: '2026-08-21T10:00:00Z', type: 'command_execution', payload: { command: 'npm test', exit_code: 1, retry_count: 2 } }, { sessionId: 's1', source: 'fixture', sequence: 1 });
  assert.deepEqual(events.map((item) => item.type).sort(), ['retry_measured', 'tool_call', 'validation_attempted', 'validation_failed']);
  assert.equal(events.every((item) => item.evidence === EFFICIENCY_EVIDENCE.measured), true);
  assert.equal(JSON.stringify(events).includes('npm test'), false);
  const toolFailure = structuralEventsFromRecord({ timestamp: '2026-08-21T10:01:00Z', type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'call-1', is_error: true, content: 'private output' }] } }, { sessionId: 's1', source: 'fixture', sequence: 2 });
  assert.equal(toolFailure.some((item) => item.type === 'tool_error'), true);
  const rate = structuralEventsFromRecord({ timestamp: '2026-08-21T10:02:00Z', type: 'error', payload: { error_code: 'rate_limit' } }, { sessionId: 's1', source: 'fixture', sequence: 3 });
  assert.equal(rate.some((item) => item.type === 'rate_limit'), true);
});

test('efficiency foundation keeps session work blocks descriptive and tasks unknown', () => {
  const failure = structuralEventsFromRecord({ timestamp: '2026-08-21T10:10:00Z', type: 'command_execution', payload: { command: 'npm test', exit_code: 1 } }, { sessionId: 'Codex:eff-1', source: 'fixture', sequence: 1, model: 'GPT-5.6' });
  const pass = structuralEventsFromRecord({ timestamp: '2026-08-21T10:15:00Z', type: 'command_execution', payload: { command: 'npm test', exit_code: 0 } }, { sessionId: 'Codex:eff-1', source: 'fixture', sequence: 2, model: 'GPT-5.6' });
  const foundation = buildEfficiencyFoundation({ sessions: [efficiencySession({ efficiencyEvents: [...failure, ...pass] })], capabilityUsageEvents: [{ id: 'skill-event', capabilityId: 'capability:one', sessionId: 'Codex:eff-1', projectId: 'project:alpha', timestamp: '2026-08-21T10:16:00Z', evidenceType: 'Claude structured attributionSkill' }] });
  assert.equal(foundation.workBlocks.length, 1);
  assert.equal(foundation.workBlocks[0].boundaryMethod, 'session-proxy');
  assert.equal(foundation.attempts.length, 2);
  assert.equal(foundation.outcomes.some((item) => item.state === 'accepted'), false);
  assert.equal(foundation.events.some((item) => item.type === 'retry_inferred' && item.evidence === EFFICIENCY_EVIDENCE.inferred), true);
  assert.equal(foundation.capabilityEvidence[0].class, 'confirmed-invocation');
});

test('efficiency snapshot preserves unavailable metrics, exact remote cost, and sample guardrails', () => {
  const session = efficiencySession();
  const foundation = buildEfficiencyFoundation({ sessions: [session] });
  const snapshot = efficiencySnapshot(foundation, { period: 'all', now: new Date('2026-08-22T00:00:00Z') });
  assert.equal(snapshot.models[0].exactApiCost, null);
  assert.equal(snapshot.models[0].tests.attempted, null);
  assert.equal(snapshot.models[0].comparison.eligible, false);
  const withCost = efficiencySnapshot(foundation, { period: 'all', now: new Date('2026-08-22T00:00:00Z'), remoteAnalytics: { range: { id: 'all' }, models: [{ model: 'GPT-5.6', modelId: 'gpt-5.6', provider: 'OpenAI', cost: 0.42 }] } });
  assert.equal(withCost.models[0].exactApiCost, 0.42);
  assert.match(withCost.models[0].costCoverage, /Exact OpenRouter/);
});

test('efficiency rework and model-switch inferences require explicit structural continuation evidence', () => {
  const rework = inferPossibleRework([{ id: 'a', workBlockId: 'w', timestamp: '2026-08-21T10:00:00Z', pathHash: 'file', changeKind: 'edit' }, { id: 'b', workBlockId: 'w', timestamp: '2026-08-21T10:01:00Z', pathHash: 'file', changeKind: 'revert' }]);
  assert.equal(rework[0].evidence, EFFICIENCY_EVIDENCE.inferred);
  const switches = detectedModelSwitches([{ id: 'a', continuationId: 'explicit-cycle', startedAt: '2026-08-21T10:00:00Z', identity: { modelId: 'claude-sonnet-4' } }, { id: 'b', continuationId: 'explicit-cycle', startedAt: '2026-08-21T10:05:00Z', identity: { modelId: 'gpt-5.6' } }]);
  assert.equal(switches.length, 1);
  assert.equal(detectedModelSwitches([{ id: 'a', startedAt: '2026-08-21T10:00:00Z', identity: { modelId: 'a' } }, { id: 'b', startedAt: '2026-08-21T10:05:00Z', identity: { modelId: 'b' } }]).length, 0);
});

test('efficiency user outcomes and cycles are reversible local metadata', () => {
  const folder = temp('efficiency-metadata');
  let metadata = recordOutcome({}, 'work:a', 'accepted');
  assert.equal(metadata.outcomes['work:a'].evidenceClass, EFFICIENCY_EVIDENCE.userConfirmed);
  metadata = recordOutcome(metadata, 'work:a', 'unknown');
  assert.equal(metadata.outcomes['work:a'], undefined);
  const created = createCycle(metadata, ['work:a', 'work:b']);
  saveEfficiencyMetadata(folder, created.metadata);
  assert.equal(loadEfficiencyMetadata(folder).cycles[0].boundaryMethod, 'user-confirmed-grouping');
  const applied = applyEfficiencyMetadata(buildEfficiencyFoundation({ sessions: [efficiencySession()] }), recordOutcome({}, 'work:missing', 'rejected'));
  assert.equal(applied.outcomes.some((item) => item.evidenceClass === 'user-confirmed'), true);
});

test('efficiency comparison metadata migrates old local records without promoting history', () => {
  const folder = temp('efficiency-comparison-migration');
  fs.writeFileSync(path.join(folder, 'efficiency-metadata.json'), JSON.stringify({ version: 1, outcomes: { 'work:a': { state: 'accepted', recordedAt: '2026-08-01T00:00:00.000Z' } }, cycles: [{ workBlockIds: ['work:a', 'work:b'] }] }));
  const migrated = loadEfficiencyMetadata(folder);
  assert.equal(migrated.version, EFFICIENCY_METADATA_VERSION);
  assert.equal(migrated.outcomes['work:a'].state, 'accepted');
  assert.equal(migrated.cycles[0].taskKey, null);
  assert.equal(migrated.comparison.instrumentationStartedAt, null);
  const tracked = beginComparisonTracking(migrated, new Date('2026-08-22T00:00:00.000Z'));
  assert.equal(tracked.comparison.instrumentationStartedAt, '2026-08-22T00:00:00.000Z');
  const created = createCycle(tracked, ['work:a', 'work:b'], { taskKey: 'task:opaque-1', privateLabel: 'Private local label', validationContract: { targetId: 'validator:test', kind: 'test', strength: 'V2' } });
  assert.equal(created.cycle.validationContract.strength, 'V2');
  assert.equal(created.cycle.privateLabel, 'Private local label');
  assert.equal(JSON.stringify(created.metadata).includes('prompt body'), false);
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
