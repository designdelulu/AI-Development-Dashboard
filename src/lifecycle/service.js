import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { readRuntime, validRuntime, ownsProcess, processAlive, removeRuntimeIfOwned, removeRuntime } from './runtime-record.js';
import { readLifecycleEvents } from './log.js';
import { DASHBOARD_SERVICE_ID, inspectPortOwner } from './port-owner.js';

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

function ownerReason(owner, port) {
  if (!owner || owner.occupied === false) return 'No listener is using the dashboard port.';
  if (owner.classification === 'dashboard') {
    if (owner.staleBuild) return `Port ${port} contains an orphaned or stale AI Dashboard instance.`;
    return `Port ${port} contains an AI Dashboard instance without a valid lifecycle record.`;
  }
  if (owner.classification === 'unrelated') return `Port ${port} is occupied by another application.`;
  return `Port ${port} is occupied by an unrecognized local process.`;
}

async function inspectOwner({ port, paths, script, expectedBuild, portInspector }) {
  if (portInspector === null) return null;
  try {
    return await (portInspector || inspectPortOwner)(port, { script, root: paths.root, dataDir: paths.dataDir, expectedBuild });
  } catch {
    return { port, occupied: null, classification: 'unknown', inspectionAvailable: false, listeners: [] };
  }
}

export async function serviceStatus(paths, script, { probeLive = false, port = 4177, expectedBuild = null, portInspector = inspectPortOwner } = {}) {
  const runtime = readRuntime(paths.runtimeFile);
  const runtimePort = Number(runtime?.port) > 0 ? Number(runtime.port) : Number(port);
  if (!runtime) {
    const owner = await inspectOwner({ port: runtimePort, paths, script, expectedBuild, portInspector });
    if (!owner || owner.occupied === false) return { state: 'stopped', runtime: null, port: runtimePort, portOwner: owner, reason: 'No owned lifecycle record exists.' };
    // A bounded metadata probe can time out on a busy macOS machine even
    // though the socket is free.  Preserve that uncertainty; do not turn it
    // into a false occupied-port diagnosis or authorize any recovery action.
    if (owner.occupied == null) return { state: 'port-unknown', runtime: null, port: runtimePort, portOwner: owner, reason: `Port ${runtimePort} ownership could not be inspected safely.` };
    if (owner.classification === 'dashboard' && owner.verified) {
      return { state: 'orphaned', runtime: null, port: runtimePort, portOwner: owner, reason: ownerReason(owner, runtimePort) };
    }
    return { state: 'port-occupied', runtime: null, port: runtimePort, portOwner: owner, reason: ownerReason(owner, runtimePort) };
  }
  if (!validRuntime(runtime, { script })) {
    const owner = await inspectOwner({ port: runtimePort, paths, script, expectedBuild, portInspector });
    if (owner?.classification === 'dashboard' && owner.verified) return { state: 'orphaned', runtime, port: runtimePort, portOwner: owner, reason: ownerReason(owner, runtimePort) };
    return { state: 'stale', runtime, port: runtimePort, portOwner: owner, reason: 'The recorded owner is no longer a live dashboard process.' };
  }
  try {
    // Health is intentionally cheap, but the local process can briefly be
    // busy with bounded filesystem polling or a browser connection.  Allow a
    // short, deterministic liveness window before calling a valid owned
    // service unhealthy; the endpoint still does no index/discovery work.
    const health = await request(`${runtime.url}/api/health`, { headers: { 'X-AI-Dashboard-Control': runtime.controlToken }, timeout: 1_500 });
    const body = JSON.parse(health.body || '{}');
    if (!(health.status === 200 && body.instanceId === runtime.instanceId && (!body.service || body.service === DASHBOARD_SERVICE_ID))) return { state: 'unhealthy', runtime, reason: 'The loopback health endpoint returned an unexpected response.' };
    if (expectedBuild && (!body.build?.commit || (expectedBuild.commit && body.build.commit !== expectedBuild.commit))) {
      return { state: 'stale-build', runtime, port: runtimePort, build: body.build || null, expectedBuild, reason: 'A verified dashboard is running an older build.' };
    }
    if (probeLive) {
      const began = Date.now();
      try {
        await request(`${runtime.url}/api/live-state`, { headers: { 'X-AI-Dashboard-Control': runtime.controlToken }, timeout: 900 });
        return { state: 'running', health: 'healthy', liveState: 'healthy', latencyMs: Date.now() - began, runtime };
      } catch {
        return { state: 'running', health: 'healthy', liveState: 'degraded', latencyMs: Date.now() - began, runtime, reason: 'Loopback health is responsive but live-state is slow or unavailable.' };
      }
    }
    return { state: 'running', health: 'healthy', liveState: 'unknown', runtime, build: body.build || null };
  }
  catch {
    const owner = await inspectOwner({ port: runtimePort, paths, script, expectedBuild, portInspector });
    return { state: 'unhealthy', runtime, port: runtimePort, portOwner: owner, reason: 'The owned dashboard process exists but its loopback health endpoint is not responding.' };
  }
}

async function waitForProcessExit(pid, { timeoutMs = 2_000, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), alive = processAlive } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!alive(pid)) return true;
    await sleep(75);
  }
  return !alive(pid);
}

async function terminateVerifiedDashboard(target, { script, runtimeFile = null, instanceId = null, sleep, kill = process.kill, alive = processAlive, lifecycleLog = null } = {}) {
  const pid = Number(target?.portOwner?.listener?.pid || target?.listener?.pid || target?.runtime?.pid);
  if (!Number.isInteger(pid) || pid <= 0) return { state: 'error', reasonCode: 'ownership-unknown', error: 'Dashboard ownership could not be verified; no process was stopped.' };
  const verifiedPortOwner = target?.portOwner?.classification === 'dashboard' && target.portOwner.verified === true;
  const verifiedRuntime = target?.runtime && ownsProcess(target.runtime, { script });
  if (!verifiedPortOwner && !verifiedRuntime) return { state: 'error', reasonCode: 'ownership-unknown', error: 'Dashboard process ownership could not be re-verified; no unrelated process was targeted.' };
  lifecycleLog?.({ stage: 'orphan-recovery-start', message: 'Verified dashboard process recovery started.' });
  try { kill(pid, 'SIGTERM'); } catch (error) {
    if (error?.code !== 'ESRCH') return { state: 'error', reasonCode: 'recovery-signal-failed', error: 'The verified dashboard process could not be signaled safely.' };
  }
  if (await waitForProcessExit(pid, { sleep, alive })) {
    if (runtimeFile) removeRuntimeIfOwned(runtimeFile, { pid, instanceId: instanceId || target?.runtime?.instanceId });
    lifecycleLog?.({ stage: 'orphan-recovery-complete', message: 'Verified dashboard process stopped and lifecycle ownership was cleared.' });
    return { state: 'stopped', recovered: true };
  }
  lifecycleLog?.({ stage: 'orphan-recovery-error', code: 'RECOVERY_TIMEOUT', message: 'Verified dashboard process did not exit after SIGTERM.' });
  return { state: 'error', reasonCode: 'recovery-timeout', error: 'The verified dashboard process did not stop after a bounded SIGTERM. Run ai-dashboard doctor; no unrelated process was targeted.' };
}

export async function startService({ paths, script, port = 4177, timeoutMs = 30_000, portProbe = portOccupied, portInspector = null, expectedBuild = null, spawnProcess = spawn, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), lifecycleLog = null, kill = process.kill, alive = processAlive }) {
  // Existing unit callers inject a port probe; production uses the richer
  // lsof/health inspector alongside the default socket probe.
  const inspector = portInspector || (portProbe === portOccupied ? inspectPortOwner : null);
  const current = await serviceStatus(paths, script, { port, expectedBuild, portInspector: inspector });
  if (current.state === 'running') return current;
  if (current.state === 'orphaned' || current.state === 'stale-build' || (current.state === 'unhealthy' && current.portOwner?.classification === 'dashboard')) {
    const recovered = await terminateVerifiedDashboard(current, { script, runtimeFile: paths.runtimeFile, instanceId: current.runtime?.instanceId, sleep, kill, alive, lifecycleLog });
    if (recovered.state !== 'stopped') return { state: 'error', reasonCode: recovered.reasonCode || 'orphan-recovery-failed', stage: 'orphan-recovery', error: recovered.error };
    removeRuntime(paths.runtimeFile);
  } else if (current.state === 'stale') {
    // A stale record is cleared only after checking that no verified dashboard
    // process is still attached to its port. Never leave a live process
    // orphaned merely because an invocation path changed.
    removeRuntime(paths.runtimeFile);
  } else if (current.state === 'unhealthy') {
    return { state: 'error', reasonCode: 'owned-service-unhealthy', stage: 'health-check', error: 'An owned dashboard process is present but its health endpoint is not responding. Run ai-dashboard doctor before retrying.' };
  } else if (current.state === 'port-occupied') {
    const error = `${current.reason || `Port ${port} is already in use.`} The dashboard did not start and no process was stopped. Run ai-dashboard doctor for details.`;
    lifecycleLog?.({ stage: 'port-check', code: 'EADDRINUSE', message: error });
    return { state: 'error', reasonCode: 'port-occupied', stage: 'port-check', error, portOwner: current.portOwner };
  }
  if (await portProbe(port)) {
    const error = `Port ${port} is already in use. The dashboard did not start and no process was stopped. Run ai-dashboard doctor for details.`;
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
    const status = await serviceStatus(paths, script, { port, expectedBuild, portInspector: inspector });
    if (status.state === 'running') return status;
    const startupChildOwnsPort = child?.pid && status.portOwner?.verified === true && Number(status.portOwner.listener?.pid) === Number(child.pid);
    if (startupChildOwnsPort && ['orphaned', 'port-occupied'].includes(status.state)) {
      // A new server can bind before its runtime record and health identity
      // are visible to this process. Only the exact child spawned above may
      // receive this short startup handoff grace; a different listener is a
      // real port conflict and must never be adopted.
      continue;
    }
    if (status.state === 'port-occupied' || status.state === 'orphaned') {
      const error = status.reason || `Port ${port} became occupied during startup.`;
      lifecycleLog?.({ stage: 'port-check', code: 'EADDRINUSE', message: error });
      return { state: 'error', reasonCode: 'port-occupied', stage: 'port-check', error };
    }
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

export async function stopService({ paths, script, port = 4177, expectedBuild = null, portInspector = inspectPortOwner, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), kill = process.kill, alive = processAlive, lifecycleLog = null }) {
  const current = await serviceStatus(paths, script, { port, expectedBuild, portInspector });
  if (current.state === 'stopped') return { ...current, message: 'AI Dashboard is already stopped.' };
  if (current.state === 'port-unknown') return { state: 'stopped', runtime: null, portOwner: current.portOwner, message: `AI Dashboard is not running. ${current.reason || `Port ${port} ownership could not be verified.`} No process was stopped.` };
  if (current.state === 'port-occupied') return { state: 'stopped', runtime: null, portOwner: current.portOwner, message: `AI Dashboard is not running. ${current.reason || `Port ${port} is occupied by another application.`} No process was stopped.` };
  if (current.state === 'orphaned') {
    const recovered = await terminateVerifiedDashboard(current, { script, runtimeFile: paths.runtimeFile, instanceId: current.runtime?.instanceId, sleep, kill, alive, lifecycleLog });
    if (recovered.state !== 'stopped') return recovered;
    removeRuntime(paths.runtimeFile);
    return { state: 'stopped', runtime: null, recovered: true, message: 'AI Dashboard orphan recovered and stopped.' };
  }
  if (current.state === 'stale') {
    removeRuntime(paths.runtimeFile);
    return { state: 'stopped', runtime: null, stale: true, message: 'AI Dashboard was already stopped; stale lifecycle state was cleared.' };
  }
  if (current.state === 'stale-build') {
    const recovered = await terminateVerifiedDashboard(current, { script, runtimeFile: paths.runtimeFile, instanceId: current.runtime?.instanceId, sleep, kill, alive, lifecycleLog });
    if (recovered.state !== 'stopped') return recovered;
    removeRuntime(paths.runtimeFile);
    return { state: 'stopped', runtime: null, recovered: true, message: 'AI Dashboard stopped; its stale build was replaced by the next open.' };
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
