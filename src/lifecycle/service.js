import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { readRuntime, validRuntime, ownsProcess, processAlive, removeRuntimeIfOwned, removeRuntime } from './runtime-record.js';
import { readLifecycleEvents } from './log.js';

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => { let text=''; res.on('data', (chunk) => text += chunk); res.on('end', () => resolve({ status: res.statusCode, body: text })); });
    if (options.timeout) req.setTimeout(options.timeout, () => req.destroy(new Error('Local request timed out.')));
    req.on('error', reject); req.end();
  });
}

export function portOccupied(port, { host = '127.0.0.1', timeout = 250, connect = net.createConnection } = {}) {
  if (!Number.isInteger(Number(port)) || Number(port) <= 0) return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    let socket;
    try { socket = connect({ host, port: Number(port) }); }
    catch { finish(false); return; }
    const timer = setTimeout(() => { try { socket.destroy(); } catch {} finish(false); }, timeout);
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); finish(true); });
    socket.once('error', () => { clearTimeout(timer); finish(false); });
  });
}

export async function serviceStatus(paths, script, { probeLive = false } = {}) {
  const runtime = readRuntime(paths.runtimeFile);
  if (!runtime) return { state: 'stopped', runtime: null, reason: 'No owned lifecycle record exists.' };
  if (!validRuntime(runtime, { script })) return { state: 'stale', runtime, reason: 'The recorded owner is no longer a live dashboard process.' };
  try {
    const health = await request(`${runtime.url}/api/health`, { headers: { 'X-AI-Dashboard-Control': runtime.controlToken }, timeout: 800 });
    const body = JSON.parse(health.body || '{}');
    if (!(health.status === 200 && body.instanceId === runtime.instanceId)) return { state: 'unhealthy', runtime, reason: 'The loopback health endpoint returned an unexpected response.' };
    if (probeLive) {
      const began = Date.now();
      try {
        await request(`${runtime.url}/api/live-state`, { headers: { 'X-AI-Dashboard-Control': runtime.controlToken }, timeout: 900 });
        return { state: 'running', health: 'healthy', liveState: 'healthy', latencyMs: Date.now() - began, runtime };
      } catch {
        return { state: 'running', health: 'healthy', liveState: 'degraded', latencyMs: Date.now() - began, runtime, reason: 'Loopback health is responsive but live-state is slow or unavailable.' };
      }
    }
    return { state: 'running', health: 'healthy', liveState: 'unknown', runtime };
  }
  catch { return { state: 'unhealthy', runtime, reason: 'The owned dashboard process exists but its loopback health endpoint is not responding.' }; }
}

export async function startService({ paths, script, port = 4177, timeoutMs = 30_000, portProbe = portOccupied, spawnProcess = spawn, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), lifecycleLog = null }) {
  const current = await serviceStatus(paths, script);
  if (current.state === 'running') return current;
  if (current.state === 'stale') {
    removeRuntime(paths.runtimeFile);
  }
  if (current.state === 'unhealthy') {
    return { state: 'error', reasonCode: 'owned-service-unhealthy', stage: 'health-check', error: 'An owned dashboard process is present but its health endpoint is not responding. Run ai-dashboard doctor before retrying.' };
  }
  if (await portProbe(port)) {
    const error = `Port ${port} is already in use. The dashboard did not start and no process was stopped. Run ai-dashboard status or ai-dashboard doctor, then retry with --port N if needed.`;
    lifecycleLog?.({ stage: 'port-check', code: 'EADDRINUSE', message: error });
    return { state: 'error', reasonCode: 'port-occupied', stage: 'port-check', error };
  }
  fs.mkdirSync(paths.dataDir, { recursive: true, mode: 0o700 });
  const output = fs.openSync(paths.logFile, 'a', 0o600);
  let childExit = null;
  let childError = null;
  const child = spawnProcess(process.execPath, [script, 'serve', '--port', String(port)], { detached: true, stdio: ['ignore', output, output], env: { ...process.env, AI_DASHBOARD_DATA_DIR: paths.dataDir } });
  child.once?.('error', (error) => { childError = error; });
  child.once?.('exit', (code, signal) => { childExit = { code, signal }; });
  child.unref();
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await sleep(100);
    const status = await serviceStatus(paths, script);
    if (status.state === 'running') return status;
    if (childError || childExit) {
      const recentFailure = readLifecycleEvents(paths.lifecycleFile, 8).reverse().find((event) => event.stage === 'server-error');
      const detail = childError?.message || (childExit?.signal ? `process received ${childExit.signal}` : `process exited with code ${childExit?.code ?? 'unknown'}`);
      const error = recentFailure?.code === 'EADDRINUSE'
        ? `Port ${port} is already in use. The dashboard did not start and no process was stopped. Run ai-dashboard status or ai-dashboard doctor, then retry with --port N if needed.`
        : recentFailure?.code === 'EPERM'
          ? `The dashboard could not bind its loopback port (${recentFailure.message || 'permission denied'}). Run ai-dashboard doctor and check local port permissions.`
          : `Dashboard exited during startup (${detail}).`;
      lifecycleLog?.({ stage: 'child-exit', code: recentFailure?.code || childError?.code || 'STARTUP_EXIT', message: error, durationMs: Date.now() - started });
      return { state: 'error', reasonCode: recentFailure?.code === 'EADDRINUSE' ? 'port-occupied' : 'startup-exit', stage: 'child-exit', error };
    }
  }
  // A startup timeout is a failed ownership attempt, not permission to leave
  // a detached child running in the background. Terminate only the child we
  // spawned and remove a record written by that exact PID, if one exists.
  if (!childExit && child?.pid) {
    try { child.kill('SIGTERM'); } catch {}
    const record = readRuntime(paths.runtimeFile);
    if (record?.pid === child.pid) removeRuntimeIfOwned(paths.runtimeFile, { pid: child.pid, instanceId: record.instanceId });
  }
  const error = 'The dashboard did not become healthy before the timeout. Run ai-dashboard doctor for the local lifecycle state.';
  lifecycleLog?.({ stage: 'health-timeout', code: 'HEALTH_TIMEOUT', message: error, durationMs: Date.now() - started });
  return { state: 'error', reasonCode: 'health-timeout', stage: 'health-check', error };
}

export async function stopService({ paths, script }) {
  const current = await serviceStatus(paths, script);
  if (current.state === 'stopped') return { ...current, message: 'AI Dashboard is already stopped.' };
  if (current.state === 'stale') {
    removeRuntime(paths.runtimeFile);
    return { state: 'stopped', runtime: null, stale: true, message: 'AI Dashboard was already stopped; stale lifecycle state was cleared.' };
  }
  const { runtime } = current;
  const waitForExit = async (timeoutMs) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 75));
      if (!processAlive(runtime.pid)) return true;
    }
    return !processAlive(runtime.pid);
  };
  try {
    const response = await request(`${runtime.url}/api/control/stop`, { method: 'POST', headers: { 'X-AI-Dashboard-Control': runtime.controlToken, Origin: runtime.url }, timeout: 1500 });
    if (response.status !== 200) return { state: 'error', error: 'The owned dashboard service rejected the stop request.' };
    if (await waitForExit(2_000)) {
      removeRuntimeIfOwned(paths.runtimeFile, { pid: runtime.pid, instanceId: runtime.instanceId });
      return { state: 'stopped', runtime: null, message: 'AI Dashboard stopped.' };
    }
  } catch {}

  // A wedged event loop may not answer /api/control/stop. Only signal after a
  // fresh command-line ownership check; never target a PID from a stale file.
  if (ownsProcess(runtime, { script })) {
    try { process.kill(runtime.pid, 'SIGTERM'); } catch {}
    if (await waitForExit(2_000)) {
      removeRuntimeIfOwned(paths.runtimeFile, { pid: runtime.pid, instanceId: runtime.instanceId });
      return { state: 'stopped', runtime: null, forced: true, message: 'AI Dashboard stopped after a bounded graceful-shutdown timeout.' };
    }
    return { state: 'error', error: 'The owned dashboard did not stop after a verified graceful shutdown and SIGTERM. Run ai-dashboard doctor; no unrelated process was targeted.' };
  }
  return { state: 'error', error: 'The dashboard did not respond and process ownership could not be re-verified; no process was killed.' };
}
