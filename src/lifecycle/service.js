import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readRuntime, validRuntime } from './runtime-record.js';

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => { let text=''; res.on('data', (chunk) => text += chunk); res.on('end', () => resolve({ status: res.statusCode, body: text })); });
    if (options.timeout) req.setTimeout(options.timeout, () => req.destroy(new Error('Local request timed out.')));
    req.on('error', reject); req.end();
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

export async function startService({ paths, script, port = 4177, timeoutMs = 6000 }) {
  const current = await serviceStatus(paths, script);
  if (current.state === 'running') return current;
  fs.mkdirSync(paths.dataDir, { recursive: true, mode: 0o700 });
  const output = fs.openSync(paths.logFile, 'a', 0o600);
  const child = spawn(process.execPath, [script, 'serve', '--port', String(port)], { detached: true, stdio: ['ignore', output, output], env: { ...process.env, AI_DASHBOARD_DATA_DIR: paths.dataDir } });
  child.unref();
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const status = await serviceStatus(paths, script);
    if (status.state === 'running') return status;
  }
  return { state: 'error', error: 'The dashboard did not become healthy before the timeout.' };
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
