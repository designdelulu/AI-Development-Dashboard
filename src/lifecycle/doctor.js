import fs from 'node:fs';
import http from 'node:http';
import { readRuntime, validRuntime } from './runtime-record.js';
import { readLifecycleEvents } from './log.js';
import { inspectPortOwner, portOwnerSummary } from './port-owner.js';

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

function request(url, { timeout = 1_500, headers = {} } = {}) {
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

export async function doctorAsync(paths, script, { port = 4177, expectedBuild = null, portInspector = inspectPortOwner } = {}) {
  const base = doctor(paths, script);
  const runtime = readRuntime(paths.runtimeFile);
  const checks = [...base.checks];
  const lifecycle = readLifecycleEvents(paths.lifecycleFile, 32);
  const lastDiscoveryStart = [...lifecycle].reverse().find((event) => event.stage === 'discovery-start');
  const lastDiscoveryEnd = [...lifecycle].reverse().find((event) => ['discovery-complete', 'discovery-error'].includes(event.stage));
  const owned = runtime && validRuntime(runtime, { script });
  const discovery = owned && lastDiscoveryStart && (!lastDiscoveryEnd || lastDiscoveryEnd.at < lastDiscoveryStart.at) ? 'running' : 'idle';
  const index = fs.existsSync(paths.indexFile || '') ? 'ready' : 'pending';
  const actualPort = Number(runtime?.port) > 0 ? Number(runtime.port) : Number(port);
  let portOwner = null;
  try { portOwner = portInspector ? await portInspector(actualPort, { script, root: paths.root || null, dataDir: paths.dataDir, expectedBuild }) : null; }
  catch { portOwner = { port: actualPort, occupied: null, classification: 'unknown', inspectionAvailable: false }; }
  const portSummary = portOwnerSummary(portOwner);
  // A valid runtime plus its instance-authenticated health response is
  // stronger ownership evidence than a transient lsof timeout.  Do not tell
  // the user that a healthy owned service is stopped/unknown merely because
  // the optional process snapshot was briefly unavailable.
  const portOk = portOwner?.occupied === false || (portOwner?.classification === 'dashboard' && portOwner?.verified === true && Boolean(owned));
  checks.push({ id: 'port', ok: portOk, detail: portOwner?.occupied === false ? `Port ${actualPort} is free.` : portOwner?.classification === 'dashboard' ? (owned ? `Port ${actualPort} is owned by the recorded dashboard process.` : `Port ${actualPort} contains an orphaned dashboard instance.`) : portOwner?.classification === 'unrelated' ? `Port ${actualPort} is occupied by another application.` : `Port ${actualPort} ownership could not be verified.` });
  let loopback = { state: portOwner?.classification === 'dashboard' && portOwner?.health?.state === 'healthy' ? 'healthy' : portOwner?.occupied ? 'occupied' : 'stopped' };
  let liveState = { state: 'unavailable' };
  if (owned) {
    try {
      const health = await request(`${runtime.url}/api/health`, { headers: { 'X-AI-Dashboard-Control': runtime.controlToken } });
      const body = JSON.parse(health.body || '{}');
      loopback = health.status === 200 && body.instanceId === runtime.instanceId ? { state: 'healthy' } : { state: 'unhealthy' };
      if (loopback.state === 'healthy' && portOwner?.occupied == null) {
        const portCheck = checks.find((check) => check.id === 'port');
        if (portCheck) { portCheck.ok = true; portCheck.detail = `Port ${actualPort} is authenticated by the recorded dashboard health response; process snapshot was temporarily unavailable.`; }
      }
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
  } else if (portOwner?.classification === 'dashboard' && portOwner?.health?.state === 'healthy') {
    checks.push({ id: 'loopback-health', ok: true, detail: 'Orphaned dashboard listener responds to its loopback health endpoint.' });
    const began = Date.now();
    try {
      const live = await request(`http://127.0.0.1:${actualPort}/api/live-state`, { timeout: 1_200 });
      liveState = live.status === 200 ? { state: 'healthy', latencyMs: Date.now() - began } : { state: 'degraded', latencyMs: Date.now() - began };
    } catch { liveState = { state: 'degraded', latencyMs: Date.now() - began }; }
    checks.push({ id: 'live-state', ok: liveState.state === 'healthy', detail: liveState.state === 'healthy' ? `Live state responded in ${liveState.latencyMs}ms.` : 'Live state is slow or unavailable.' });
  }
  const ok = checks.every((check) => check.ok);
  let recommendation = null;
  if (portOwner?.classification === 'dashboard' && !owned) recommendation = 'Run ai-dashboard open to recover the orphaned dashboard automatically.';
  else if (portOwner?.classification === 'unrelated') recommendation = `Port ${actualPort} is occupied by another application. Stop or reconfigure that application, then run ai-dashboard open.`;
  else if (!ok) recommendation = 'Run ai-dashboard report-bug to save a sanitized local diagnostic bundle.';
  return {
    ...base,
    ok,
    state: ok ? 'healthy' : (loopback.state === 'healthy' ? 'degraded' : 'needs-attention'),
    checks,
    loopback,
    liveState,
    index: { state: index },
    discovery: { state: discovery },
    port: { port: actualPort, ...portSummary, classification: portOwner?.classification || 'unknown', staleBuild: Boolean(portOwner?.staleBuild), recoveryAvailable: portOwner?.classification === 'dashboard' && portOwner?.verified === true },
    recommendation
  };
}
