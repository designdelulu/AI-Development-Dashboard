import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboardService, buildRuntimeServices, createNvidiaGpuSampler, diagnosticCategory, diskUsage, normalizeDiagnostics, normalizeRuntimeService, normalizeSystemResources, parseNvidiaSmiCsv, runtimeStatusSnapshot } from '../src/runtime-resources.js';

test('runtime resource normalization preserves legacy fields and honest unavailable hardware', () => {
  const value = normalizeSystemResources({ totalMemory: 1_000, freeMemory: 250, cpuPercent: 42, dashboardRss: 40, disk: { totalBytes: 2_000, freeBytes: 500 } }, { platform: 'darwin', arch: 'arm64', now: () => 1_000 });
  assert.equal(value.ram.used, 750);
  assert.equal(value.memory.usedPercent, 75);
  assert.equal(value.cpu.percent, 42);
  assert.equal(value.disk.usedPercent, 75);
  assert.equal(value.memory.unified, true);
  assert.equal(value.gpu.available, false);
  assert.match(value.gpu.reason, /unified memory/i);
});

test('nvidia fixture parsing is structural and does not require a host command', () => {
  const devices = parseNvidiaSmiCsv('0, NVIDIA RTX Fixture, 8192, 2048, 17, 48, GPU-fixture\n');
  assert.equal(devices.length, 1);
  assert.equal(devices[0].memory.totalBytes, 8192 * 1024 * 1024);
  assert.equal(devices[0].memory.usedBytes, 2048 * 1024 * 1024);
  assert.equal(devices[0].utilizationPercent, 17);
});

test('bounded NVIDIA probe normalizes a fixture and stays unavailable on unsupported hosts', () => {
  let calls = 0;
  const sample = createNvidiaGpuSampler({ platform: 'linux', now: () => 10_000, execFile: () => { calls += 1; return '0, NVIDIA Fixture, 4096, 1024, 12, 49, GPU-fixture'; } });
  const first = sample();
  const second = sample();
  assert.equal(calls, 1);
  assert.equal(first.available, true);
  assert.equal(first.vendor, 'NVIDIA');
  assert.equal(first.memory.totalBytes, 4096 * 1024 * 1024);
  assert.equal(second.model, 'NVIDIA Fixture');
  const unsupported = createNvidiaGpuSampler({ platform: 'darwin', now: () => 10_000, execFile: () => { throw new Error('must not run'); } });
  assert.equal(unsupported().available, false);
});

test('runtime service model keeps observed runtimes separate from lifecycle controls', () => {
  const services = buildRuntimeServices({
    runtimes: [{ id: 'cline', displayName: 'Cline', agent: 'Cline', host: 'Cursor', sourceKey: 'Cline', liveCapable: true, capabilities: { health: true } }],
    presence: { Cline: { state: 'present', checkedAt: '2026-08-24T00:00:00.000Z' } },
    liveStates: { Cline: { state: 'Working', confidence: 'Structured', since: '2026-08-24T00:00:00.000Z' } }
  });
  assert.equal(services[0].status, 'Working');
  assert.equal(services[0].lifecycle, 'running');
  assert.equal(services[0].controls.stop, false);
  assert.match(services[0].controls.reason, /ownership/i);
  assert.equal(services[0].host, 'Cursor');
});

test('dashboard descriptor exposes only owned dashboard controls and process resources', () => {
  const service = buildDashboardService({ runtime: { pid: 123, port: 4177, startedAt: '2026-08-24T00:00:00.000Z' }, version: '0.1.0', head: 'abc1234', now: () => Date.parse('2026-08-24T00:10:00Z'), serverState: { bound: true, status: 'Healthy', health: 'Healthy', indexReady: true, discovery: 'idle', cpuPercent: 7.5, memoryBytes: 1234, checks: { health: 'healthy', liveState: 'available', index: 'ready', discovery: 'idle' } } });
  assert.equal(service.status, 'Healthy');
  assert.equal(service.controls.restart, true);
  assert.equal(service.controls.stop, true);
  assert.equal(service.ownership, 'unknown');
  assert.equal(service.port, 4177);
  assert.equal(service.cpuPercent, 7.5);
  assert.equal(service.memoryBytes, 1234);
  assert.equal(service.build.head, 'abc1234');
  assert.equal(service.build.state, 'current');
  assert.equal(service.checks.liveState, 'available');
});

test('diagnostics are categorized and bounded without changing sanitized event content', () => {
  const events = [
    { at: '2026-08-24T00:00:00.000Z', stage: 'discovery-start', message: 'safe' },
    { at: '2026-08-24T00:00:01.000Z', stage: 'server-error', code: 'EFAIL', message: 'failure' },
    { at: '2026-08-24T00:00:02.000Z', stage: 'presence-poll', message: 'safe' }
  ];
  assert.equal(diagnosticCategory(events[0]), 'Discovery');
  assert.equal(diagnosticCategory(events[1]), 'Errors');
  assert.equal(normalizeDiagnostics(events, { category: 'Live telemetry' }).length, 1);
  assert.equal(normalizeDiagnostics(events, { limit: 1 }).length, 1);
});

test('runtime status snapshot is local and excludes raw request data', () => {
  const snapshot = runtimeStatusSnapshot({ dashboard: normalizeRuntimeService({ id: 'dashboard', displayName: 'Dashboard', status: 'Healthy' }), services: [], resources: { cpu: { percent: 2 } }, generatedAt: () => 0 });
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.dashboard.status, 'Healthy');
  assert.equal(JSON.stringify(snapshot).includes('toolArguments'), false);
  assert.equal(JSON.stringify(snapshot).includes('apiKey'), false);
});

test('disk usage returns unavailable instead of inventing capacity', () => {
  const unavailable = diskUsage('/', { statfs: () => { throw new Error('fixture'); } });
  assert.equal(unavailable.totalBytes, null);
  assert.equal(unavailable.freeBytes, null);
  assert.equal(unavailable.evidence, 'unavailable');
});
