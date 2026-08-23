import fs from 'node:fs';
import http from 'node:http';
import { readRuntime, validRuntime } from './runtime-record.js';
import { readLifecycleEvents } from './log.js';

export function doctor(paths, script) {
  const runtime = readRuntime(paths.runtimeFile);
  const checks = [
    { id: 'data-directory', ok: (() => { try { fs.mkdirSync(paths.dataDir, { recursive: true, mode: 0o700 }); return true; } catch { return false; } })() },
    { id: 'runtime-record', ok: !runtime || validRuntime(runtime, { script }) },
    { id: 'index-readable', ok: !fs.existsSync(paths.indexFile || '') || (() => { try { fs.accessSync(paths.indexFile, fs.constants.R_OK); return true; } catch { return false; } })() },
    { id: 'local-only', ok: true }
  ];
  return { ok: checks.every((check) => check.ok), state: checks.every((check) => check.ok) ? 'ready' : 'needs-attention', checks, runtime: runtime ? { state: validRuntime(runtime, { script }) ? 'owned' : 'stale' } : { state: 'absent' } };
}

function request(url, { timeout = 900, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { headers }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.setTimeout(timeout, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

export async function doctorAsync(paths, script) {
  const base = doctor(paths, script);
  const runtime = readRuntime(paths.runtimeFile);
  const checks = [...base.checks];
  const lifecycle = readLifecycleEvents(paths.lifecycleFile, 32);
  const lastDiscoveryStart = [...lifecycle].reverse().find((event) => event.stage === 'discovery-start');
  const lastDiscoveryEnd = [...lifecycle].reverse().find((event) => ['discovery-complete', 'discovery-error'].includes(event.stage));
  const owned = runtime && validRuntime(runtime, { script });
  const discovery = owned && lastDiscoveryStart && (!lastDiscoveryEnd || lastDiscoveryEnd.at < lastDiscoveryStart.at) ? 'running' : 'idle';
  const index = fs.existsSync(paths.indexFile || '') ? 'ready' : 'pending';
  let loopback = { state: runtime && validRuntime(runtime, { script }) ? 'starting' : 'stopped' };
  let liveState = { state: 'unavailable' };
  if (runtime && validRuntime(runtime, { script })) {
    try {
      const health = await request(`${runtime.url}/api/health`, { headers: { 'X-AI-Dashboard-Control': runtime.controlToken } });
      const body = JSON.parse(health.body || '{}');
      loopback = health.status === 200 && body.instanceId === runtime.instanceId ? { state: 'healthy' } : { state: 'unhealthy' };
      checks.push({ id: 'loopback-health', ok: loopback.state === 'healthy', detail: loopback.state === 'healthy' ? 'Health endpoint responded.' : 'Health endpoint returned an unexpected response.' });
      if (loopback.state === 'healthy') {
        const began = Date.now();
        try {
          const live = await request(`${runtime.url}/api/live-state`, { headers: { 'X-AI-Dashboard-Control': runtime.controlToken }, timeout: 1_200 });
          liveState = live.status === 200 ? { state: 'healthy', latencyMs: Date.now() - began } : { state: 'degraded', latencyMs: Date.now() - began };
        } catch { liveState = { state: 'degraded', latencyMs: Date.now() - began }; }
        checks.push({ id: 'live-state', ok: liveState.state === 'healthy', detail: liveState.state === 'healthy' ? `Live state responded in ${liveState.latencyMs}ms.` : 'Live state is slow or unavailable.' });
      }
    } catch {
      loopback = { state: 'unhealthy' };
      checks.push({ id: 'loopback-health', ok: false, detail: 'Owned process exists but the loopback health endpoint is unresponsive.' });
    }
  }
  const ok = checks.every((check) => check.ok);
  return { ...base, ok, state: ok ? 'healthy' : (loopback.state === 'healthy' ? 'degraded' : base.state), checks, loopback, liveState, index: { state: index }, discovery: { state: discovery }, recommendation: ok ? null : 'Run ai-dashboard report-bug to save a sanitized local diagnostic bundle.' };
}
