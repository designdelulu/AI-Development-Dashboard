import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

export const RUNTIME_RESOURCES_SCHEMA_VERSION = 1;

const finite = (value, fallback = null) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const nonNegative = (value, fallback = null) => {
  const number = finite(value, fallback);
  return number == null ? fallback : Math.max(0, number);
};

function iso(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Normalize the small, metadata-only runtime resource shape used by the
 * Maintenance console. Existing Live Feed fields are retained for backwards
 * compatibility; richer fields are additive and may be unavailable.
 */
export function normalizeSystemResources(input = {}, { platform = process.platform, arch = process.arch, now = Date.now } = {}) {
  const total = nonNegative(input.memory?.totalBytes ?? input.ram?.total ?? input.totalMemory, 0) || 0;
  const used = nonNegative(input.memory?.usedBytes ?? input.ram?.used ?? input.ramUsed, total - nonNegative(input.memory?.freeBytes ?? input.ram?.free ?? input.freeMemory, 0));
  const free = nonNegative(input.memory?.freeBytes ?? input.ram?.free ?? input.freeMemory, Math.max(0, total - used));
  const usedPercent = total ? Math.max(0, Math.min(100, used / total * 100)) : null;
  const cpuPercent = finite(input.cpu?.percent ?? input.cpuPercent);
  const dashboardCpu = finite(input.dashboard?.cpuPercent ?? input.dashboardCpuPercent);
  const dashboardRss = nonNegative(input.dashboard?.rss ?? input.dashboardRss, 0) || 0;
  const disk = input.disk || {};
  const diskTotal = nonNegative(disk.totalBytes, null);
  const diskFree = nonNegative(disk.freeBytes, null);
  const diskUsed = diskTotal == null || diskFree == null ? null : Math.max(0, diskTotal - diskFree);
  const diskUsedPercent = diskTotal ? Math.max(0, Math.min(100, diskUsed / diskTotal * 100)) : null;
  const gpu = input.gpu || {};
  const family = platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : platform === 'linux' ? 'Linux' : platform;
  const unifiedMemory = platform === 'darwin' && /arm64|aarch64/i.test(String(arch));
  return {
    schemaVersion: RUNTIME_RESOURCES_SCHEMA_VERSION,
    sampledAt: iso(input.sampledAt) || new Date(now()).toISOString(),
    platform: { family, platform, architecture: arch },
    cpu: {
      percent: cpuPercent == null ? null : Math.max(0, Math.min(100, cpuPercent)),
      cores: Number.isInteger(input.cpu?.cores) ? Math.max(0, input.cpu.cores) : os.cpus().length,
      load1: finite(input.cpu?.load1),
      pressure: input.cpu?.pressure || null,
      evidence: input.cpu?.evidence || (cpuPercent == null ? 'unavailable' : 'local-sampler')
    },
    memory: {
      usedBytes: used,
      totalBytes: total,
      freeBytes: free,
      usedPercent,
      pressure: input.memory?.pressure || null,
      swap: input.memory?.swap || null,
      unified: unifiedMemory,
      evidence: input.memory?.evidence || (total ? 'local-sampler' : 'unavailable')
    },
    disk: {
      path: disk.path || '/',
      usedBytes: diskUsed,
      totalBytes: diskTotal,
      freeBytes: diskFree,
      usedPercent: diskUsedPercent,
      evidence: disk.evidence || (diskTotal == null ? 'unavailable' : 'local-statfs')
    },
    gpu: {
      available: gpu.available === true,
      vendor: gpu.vendor || null,
      model: gpu.model || null,
      memory: gpu.memory || null,
      temperatureC: finite(gpu.temperatureC),
      utilizationPercent: finite(gpu.utilizationPercent),
      processAttribution: gpu.processAttribution || 'unavailable',
      reason: gpu.reason || (unifiedMemory ? 'Apple Silicon uses unified memory; dedicated VRAM is not reported.' : 'No supported GPU telemetry is available.')
    },
    // Existing Overview/Live Feed consumers use these compact fields.
    ram: { used, total, free, ratio: total ? used / total : null },
    cpuPercent: cpuPercent == null ? null : Math.max(0, Math.min(100, cpuPercent)),
    dashboard: { rss: dashboardRss, cpuPercent: dashboardCpu },
    capabilities: {
      cpu: cpuPercent != null,
      memory: total > 0,
      disk: diskTotal != null,
      gpu: gpu.available === true,
      pressure: Boolean(input.cpu?.pressure || input.memory?.pressure)
    }
  };
}

export function diskUsage(root = '/', { statfs = fs.statfsSync } = {}) {
  try {
    const value = statfs(root);
    const blockSize = nonNegative(value.bsize ?? value.frsize, 0) || 0;
    const totalBytes = blockSize * nonNegative(value.blocks, 0);
    const freeBytes = blockSize * nonNegative(value.bavail ?? value.bfree, 0);
    if (!totalBytes) return { path: root, totalBytes: null, freeBytes: null, evidence: 'unavailable' };
    return { path: root, totalBytes, freeBytes, evidence: 'local-statfs' };
  } catch {
    return { path: root, totalBytes: null, freeBytes: null, evidence: 'unavailable' };
  }
}

/** Parse nvidia-smi CSV output without invoking nvidia-smi itself. */
export function parseNvidiaSmiCsv(text = '') {
  const devices = [];
  for (const line of String(text).split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
    const fields = line.split(',').map((value) => value.trim());
    if (fields.length < 7) continue;
    const [index, model, total, used, utilization, temperature, uuid] = fields;
    const totalMiB = finite(total);
    const usedMiB = finite(used);
    if (finite(index) == null || !model) continue;
    devices.push({
      index: Math.max(0, Math.round(Number(index))),
      model,
      uuid: uuid || null,
      memory: totalMiB == null ? null : { totalBytes: totalMiB * 1024 * 1024, usedBytes: (usedMiB || 0) * 1024 * 1024, freeBytes: Math.max(0, totalMiB - (usedMiB || 0)) * 1024 * 1024 },
      utilizationPercent: finite(utilization),
      temperatureC: finite(temperature),
      evidence: 'nvidia-smi'
    });
  }
  return devices;
}

/**
 * Optional, bounded NVIDIA probe. A missing/failed command is an honest
 * unavailable result; the dashboard never treats that as zero GPU capacity.
 * The result is cached briefly because this runs alongside the lightweight
 * resource sampler rather than on an HTTP request path.
 */
export function createNvidiaGpuSampler({
  platform = process.platform,
  execFile = execFileSync,
  now = Date.now,
  intervalMs = 5_000
} = {}) {
  let sampledAt = 0;
  let cached = { available: false, processAttribution: 'unavailable', reason: 'No supported GPU telemetry is available.' };
  return () => {
    const at = now();
    if (at - sampledAt < intervalMs) return cached;
    sampledAt = at;
    if (platform !== 'linux') return cached;
    try {
      const output = execFile('nvidia-smi', [
        '--query-gpu=index,name,memory.total,memory.used,utilization.gpu,temperature.gpu,uuid',
        '--format=csv,noheader,nounits'
      ], { encoding: 'utf8', timeout: 750, maxBuffer: 64 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
      const devices = parseNvidiaSmiCsv(output);
      if (!devices.length) {
        cached = { available: false, processAttribution: 'unavailable', reason: 'NVIDIA telemetry returned no usable device metadata.' };
      } else {
        const first = devices[0];
        cached = {
          available: true,
          vendor: 'NVIDIA',
          model: devices.length === 1 ? first.model : `${first.model} + ${devices.length - 1} more`,
          memory: {
            totalBytes: devices.reduce((sum, device) => sum + (device.memory?.totalBytes || 0), 0),
            usedBytes: devices.reduce((sum, device) => sum + (device.memory?.usedBytes || 0), 0),
            freeBytes: devices.reduce((sum, device) => sum + (device.memory?.freeBytes || 0), 0)
          },
          temperatureC: first.temperatureC,
          utilizationPercent: first.utilizationPercent,
          processAttribution: 'unavailable',
          devices,
          evidence: 'nvidia-smi'
        };
      }
    } catch {
      cached = { available: false, processAttribution: 'unavailable', reason: 'NVIDIA telemetry is unavailable on this host.' };
    }
    return cached;
  };
}

export function runtimeStatusLabel(state) {
  return ({ healthy: 'Healthy', degraded: 'Degraded', starting: 'Starting', unhealthy: 'Unhealthy', stopped: 'Stopped', working: 'Working', 'needs-you': 'Needs You', 'needs you': 'Needs You', recent: 'Recent', 'recently active': 'Recent', idle: 'Idle', closed: 'Closed', unknown: 'Presence Unknown', 'presence unknown': 'Presence Unknown' })[String(state || '').toLowerCase()] || 'Unknown';
}

function lifecycleForPresence(presence) {
  if (presence?.state === 'present') return 'running';
  if (presence?.state === 'closed') return 'stopped';
  return 'unknown';
}

function sourceStateFor(runtime) {
  return runtime?.sourceState || {};
}

/** Normalize an observed service descriptor; controls are explicit capability metadata. */
export function normalizeRuntimeService(value = {}) {
  const status = runtimeStatusLabel(value.status || value.activityState || value.lifecycle);
  return {
    id: String(value.id || 'unknown-service'),
    displayName: String(value.displayName || value.name || value.id || 'Unknown service'),
    category: String(value.category || 'system'),
    executable: value.executable || null,
    runtime: value.runtime || null,
    port: Number.isInteger(value.port) ? value.port : null,
    build: value.build || null,
    checks: value.checks || null,
    agent: value.agent || null,
    host: value.host || null,
    health: value.health || 'Unknown',
    status,
    lifecycle: value.lifecycle || 'unknown',
    pid: Number.isInteger(value.pid) ? value.pid : null,
    uptimeMs: finite(value.uptimeMs),
    cpuPercent: finite(value.cpuPercent),
    memoryBytes: nonNegative(value.memoryBytes, null),
    gpu: value.gpu || null,
    controls: {
      stop: Boolean(value.controls?.stop),
      restart: Boolean(value.controls?.restart),
      reason: value.controls?.reason || null
    },
    ownership: value.ownership || 'unknown',
    source: value.source || 'unknown',
    lastObservedAt: iso(value.lastObservedAt),
    error: value.error || null,
    evidence: Array.isArray(value.evidence) ? value.evidence.slice(0, 12) : []
  };
}

export function buildRuntimeServices({ runtimes = [], presence = {}, liveStates = {}, now = Date.now } = {}) {
  return (runtimes || []).filter((runtime) => runtime && runtime.liveCapable).map((runtime) => {
    const agent = runtime.agent || runtime.displayName || runtime.id;
    const processState = presence[agent] || {};
    const liveState = liveStates[agent] || {};
    const status = liveState.state || (processState.state === 'closed' ? 'Closed' : processState.state === 'present' ? 'Idle' : 'Presence Unknown');
    const sourceState = sourceStateFor(runtime);
    const lastObservedAt = liveState.lastEventAt || liveState.since || sourceState.history?.lastObservedAt || processState.checkedAt;
    return normalizeRuntimeService({
      id: runtime.id,
      displayName: runtime.displayName || agent,
      category: 'ai-runtime',
      runtime: runtime.id,
      agent,
      host: runtime.host,
      status,
      lifecycle: lifecycleForPresence(processState),
      health: runtime.capabilities?.health ? 'Observed' : 'Unavailable',
      controls: { reason: 'This adapter does not declare verified lifecycle ownership.' },
      ownership: 'adapter-observed',
      source: runtime.sourceKey || runtime.id,
      lastObservedAt,
      evidence: [
        ...(processState.evidence ? [processState.evidence] : []),
        ...(liveState.confidence ? [liveState.confidence] : []),
        ...(runtime.liveCapable ? ['declared-live-capability'] : [])
      ]
    });
  });
}

export function buildDashboardService({ runtime = null, now = Date.now, serverState = {}, version = null, head = null } = {}) {
  const startedAt = runtime?.startedAt ? new Date(runtime.startedAt).getTime() : null;
  const uptimeMs = startedAt && Number.isFinite(startedAt) ? Math.max(0, now() - startedAt) : null;
  const status = serverState.status || (serverState.bound ? 'Healthy' : 'Starting');
  return normalizeRuntimeService({
    id: 'dashboard',
    displayName: 'AI Development Dashboard',
    category: 'dashboard',
    runtime: 'localhost',
    port: runtime?.port || null,
    build: { version, head, state: serverState.buildState || 'current' },
    checks: serverState.checks || null,
    status,
    lifecycle: serverState.bound ? 'running' : 'starting',
    health: serverState.health || (serverState.bound ? 'Healthy' : 'Starting'),
    pid: runtime?.pid || null,
    uptimeMs,
    cpuPercent: serverState.cpuPercent,
    memoryBytes: serverState.memoryBytes,
    controls: { stop: serverState.bound === true, restart: serverState.bound === true, reason: serverState.bound ? null : 'The dashboard server is not listening yet.' },
    ownership: runtime?.pid === process.pid ? 'owned' : 'unknown',
    source: 'lifecycle runtime record',
    lastObservedAt: runtime?.startedAt || new Date(now()).toISOString(),
    evidence: ['loopback-health', ...(serverState.indexReady ? ['index-ready'] : []), ...(serverState.discovery ? [`discovery-${serverState.discovery}`] : [])],
    error: serverState.error || null,
    version,
    head
  });
}

export function runtimeStatusSnapshot({ dashboard, services = [], resources = null, generatedAt = Date.now, discovery = null, diagnostics = null } = {}) {
  return {
    schemaVersion: RUNTIME_RESOURCES_SCHEMA_VERSION,
    generatedAt: new Date(generatedAt()).toISOString(),
    dashboard: dashboard || null,
    services: (services || []).map(normalizeRuntimeService),
    resources: resources || null,
    discovery: discovery || null,
    diagnostics: diagnostics || null,
    privacy: 'Local normalized service/resource metadata only; no prompts, source code, credentials, environment values, or Share Stats data.'
  };
}

export function diagnosticCategory(event = {}) {
  const stage = String(event.stage || '').toLowerCase();
  const code = String(event.code || '').toLowerCase();
  if (stage.includes('error') || code.includes('error') || code.startsWith('e')) return 'Errors';
  if (stage.includes('discovery') || stage.includes('scan')) return 'Discovery';
  if (stage.includes('live') || stage.includes('watch') || stage.includes('presence')) return 'Live telemetry';
  if (stage.includes('service') || stage.includes('server') || stage.includes('listen') || stage.includes('shutdown') || stage.includes('restart')) return 'Services';
  if (stage.includes('warn') || code.includes('warn')) return 'Warnings';
  return 'Lifecycle';
}

export function normalizeDiagnostics(events = [], { category = 'All', limit = 80 } = {}) {
  const wanted = String(category || 'All');
  const filtered = (events || []).map((event) => ({ ...event, category: diagnosticCategory(event) })).filter((event) => wanted === 'All' || event.category === wanted);
  return filtered.slice(-Math.max(0, Math.min(160, Number(limit) || 80)));
}

export function createRuntimeResourceSampler({ baseSampler, statfs = fs.statfsSync, root = '/', now = Date.now, platform = process.platform, arch = process.arch, gpuSampler = null } = {}) {
  const sample = typeof baseSampler === 'function' ? baseSampler : () => ({});
  const gpu = typeof gpuSampler === 'function' ? gpuSampler : createNvidiaGpuSampler({ platform, now });
  return () => {
    const base = sample() || {};
    return normalizeSystemResources({ ...base, disk: diskUsage(root, { statfs }), cpu: { ...(base.cpu || {}), percent: base.cpuPercent, cores: os.cpus().length, load1: os.loadavg?.()[0] ?? null }, gpu: base.gpu || gpu(), sampledAt: new Date(now()).toISOString() }, { platform, arch, now });
  };
}
