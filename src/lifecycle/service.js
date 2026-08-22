import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { readRuntime, validRuntime } from './runtime-record.js';
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

export async function serviceStatus(paths, script) {
  const runtime = readRuntime(paths.runtimeFile);
  if (!validRuntime(runtime, { script })) return { state: 'stopped', runtime: null };
  try {
    const health = await request(`${runtime.url}/api/health`, { headers: { 'X-AI-Dashboard-Control': runtime.controlToken }, timeout: 800 });
    const body = JSON.parse(health.body || '{}');
    return { state: health.status === 200 && body.instanceId === runtime.instanceId ? 'running' : 'unhealthy', runtime };
  }
  catch { return { state: 'unhealthy', runtime }; }
}

export async function startService({ paths, script, port = 4177, timeoutMs = 30_000, portProbe = portOccupied, spawnProcess = spawn, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), lifecycleLog = null }) {
  const current = await serviceStatus(paths, script);
  if (current.state === 'running') return current;
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
  const error = 'The dashboard did not become healthy before the timeout. Run ai-dashboard doctor for the local lifecycle state.';
  lifecycleLog?.({ stage: 'health-timeout', code: 'HEALTH_TIMEOUT', message: error, durationMs: Date.now() - started });
  return { state: 'error', reasonCode: 'health-timeout', stage: 'health-check', error };
}

export async function stopService({ paths, script }) {
  const current = await serviceStatus(paths, script);
  if (current.state === 'stopped') return current;
  const { runtime } = current;
  try {
    const response = await request(`${runtime.url}/api/control/stop`, { method: 'POST', headers: { 'X-AI-Dashboard-Control': runtime.controlToken, Origin: runtime.url }, timeout: 1500 });
    if (response.status !== 200) return { state: 'error', error: 'The owned dashboard service rejected the stop request.' };
  } catch { return { state: 'error', error: 'Unable to contact the owned dashboard service; no process was killed.' }; }
  const started = Date.now();
  while (Date.now() - started < 2_000) {
    await new Promise((resolve) => setTimeout(resolve, 75));
    if ((await serviceStatus(paths, script)).state === 'stopped') return { state: 'stopped', runtime: null };
  }
  return { state: 'error', error: 'The owned dashboard service did not stop cleanly; no process was killed.' };
}
