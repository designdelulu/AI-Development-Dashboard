import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { processCommand } from './runtime-record.js';

export const DASHBOARD_SERVICE_ID = 'ai-development-dashboard';

function normalized(value) {
  return String(value || '').replace(/\\/g, '/');
}

function parseFields(text = '') {
  const records = [];
  let current = null;
  for (const line of String(text).split(/\r?\n/)) {
    if (!line) continue;
    const kind = line[0];
    const value = line.slice(1);
    if (kind === 'p') {
      if (current?.pid) records.push(current);
      current = { pid: Number(value) || null };
    } else if (current && kind === 'c') current.command = value;
    else if (current && kind === 'u') current.userId = value;
    else if (current && kind === 'f') current.fd = value;
  }
  if (current?.pid) records.push(current);
  return records;
}

function parseProcessFiles(text = '') {
  const files = {};
  let kind = null;
  for (const line of String(text).split(/\r?\n/)) {
    if (!line) continue;
    if (line.startsWith('f')) { kind = line.slice(1); continue; }
    if (line.startsWith('n') && kind) files[kind] ||= line.slice(1);
  }
  return files;
}

function run(command, args, options = {}) {
  // macOS `lsof -iTCP` can take a little over a second when the machine has
  // many local sockets.  A sub-second timeout turns a real dashboard listener
  // into an "unknown" owner during startup, which then looks like a port
  // conflict and leaves the freshly spawned child orphaned.  Keep the probe
  // bounded, but give the OS enough time to return a snapshot.
  return execFileSync(command, args, { encoding: 'utf8', timeout: 3_000, stdio: ['ignore', 'pipe', 'ignore'], ...options });
}

export function parsePortListeners(text = '') {
  return parseFields(text).filter((item) => Number.isInteger(item.pid) && item.pid > 0);
}

export function processMetadata(pid, { runner = run } = {}) {
  const command = processCommand(pid, { run: runner });
  let files = {};
  try { files = parseProcessFiles(runner('lsof', ['-nP', '-a', '-p', String(pid), '-d', 'cwd,txt', '-Fn'])); } catch {}
  let startedAt = null;
  try { startedAt = String(runner('ps', ['-p', String(pid), '-o', 'lstart='])).trim() || null; } catch {}
  return {
    command: command || null,
    cwd: files.cwd || null,
    executable: files.txt || null,
    startedAt,
    evidence: [
      ...(command ? ['process-command'] : []),
      ...(files.cwd ? ['process-cwd'] : []),
      ...(files.txt ? ['process-executable'] : [])
    ]
  };
}

function healthRequest(port, { timeout = 500 } = {}) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: Number(port), path: '/api/health', method: 'GET', timeout }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(body || '{}'); } catch {}
        resolve({ state: res.statusCode === 200 ? 'healthy' : 'unhealthy', status: res.statusCode, body: parsed });
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve({ state: 'unavailable', status: null, body: null }));
    req.end();
  });
}

function scriptMatches(command, script) {
  if (!command || !script) return false;
  const commandPath = normalized(command);
  const expected = normalized(script);
  return commandPath.includes(expected) || commandPath.includes(path.basename(expected));
}

function dashboardCommand(command) {
  const value = normalized(command);
  return /(?:^|\/)ai-dashboard(?:\.js)?(?:\s|$)/i.test(value) && /(?:^|\s)serve(?:\s|$)/i.test(value);
}

function dashboardPath(value) {
  return /(?:ai-development-dashboard|AI-Development-Dashboard)/i.test(normalized(value));
}

/**
 * Inspect a local port without relying on a PID supplied by the user. The
 * result is intentionally metadata-only; command arguments are retained only
 * in-memory for the ownership decision and are never printed or exported.
 */
export async function inspectPortOwner(port, {
  script = null,
  root = null,
  dataDir = null,
  expectedBuild = null,
  runner = run,
  health = healthRequest,
  listeners = null
} = {}) {
  const requestedPort = Number(port);
  if (!Number.isInteger(requestedPort) || requestedPort <= 0) return { port: requestedPort, occupied: false, classification: 'free', listeners: [] };
  let parsed = listeners;
  let inspectionAvailable = true;
  if (!parsed) {
    try { parsed = parsePortListeners(runner('lsof', ['-nP', `-iTCP:${requestedPort}`, '-sTCP:LISTEN', '-Fpcu'])); }
    catch (error) {
      // lsof exits 1 when no process owns the port. ENOENT means the platform
      // lacks the optional inspector; that is unknown, never free.
      if (error?.status === 1) parsed = [];
      else { parsed = []; inspectionAvailable = false; }
    }
  }
  if (!parsed.length) return { port: requestedPort, occupied: inspectionAvailable ? false : null, classification: inspectionAvailable ? 'free' : 'unknown', inspectionAvailable, listeners: [] };

  const inspectedHealth = await health(requestedPort);
  const entries = parsed.map((listener) => {
    const metadata = { ...listener, ...processMetadata(listener.pid, { runner }) };
    const command = metadata.command || listener.command || '';
    const commandMatch = dashboardCommand(command) || scriptMatches(command, script);
    const pathMatch = dashboardPath(command) || dashboardPath(metadata.cwd) || dashboardPath(metadata.executable) || dashboardPath(dataDir) || scriptMatches(command, script);
    const healthBody = inspectedHealth?.body || null;
    const healthMarker = healthBody?.service === DASHBOARD_SERVICE_ID;
    const legacyHealthMarker = healthBody?.state === 'ok' && healthBody?.localOnly === true;
    const verifiedDashboard = healthMarker || (commandMatch && pathMatch && (legacyHealthMarker || inspectedHealth?.state === 'unavailable' || inspectedHealth?.state === 'unhealthy'));
    const possibleDashboard = healthMarker || (commandMatch && pathMatch);
    const build = healthBody?.build && typeof healthBody.build === 'object' ? healthBody.build : null;
    const staleBuild = Boolean(expectedBuild && build?.commit && expectedBuild.commit && build.commit !== expectedBuild.commit);
    const legacyBuild = Boolean(verifiedDashboard && !build);
    const classification = verifiedDashboard || possibleDashboard ? 'dashboard' : healthBody?.service ? 'unrelated' : 'unknown';
    return {
      ...listener,
      pid: Number(listener.pid),
      command,
      cwd: metadata.cwd || null,
      executable: metadata.executable || null,
      startedAt: metadata.startedAt || null,
      classification,
      verified: verifiedDashboard,
      commandMatch,
      pathMatch,
      health: inspectedHealth,
      build,
      staleBuild,
      legacyBuild,
      evidence: [
        ...(commandMatch ? ['dashboard-command'] : []),
        ...(pathMatch ? ['dashboard-path'] : []),
        ...(healthMarker ? ['dashboard-health-marker'] : []),
        ...(legacyHealthMarker ? ['legacy-dashboard-health'] : [])
      ]
    };
  });
  const dashboard = entries.find((item) => item.classification === 'dashboard' && item.verified);
  if (dashboard) return { port: requestedPort, occupied: true, classification: 'dashboard', verified: true, health: dashboard.health, staleBuild: dashboard.staleBuild || dashboard.legacyBuild, listener: dashboard, listeners: entries, inspectionAvailable };
  const unrelated = entries.find((item) => item.classification === 'unrelated');
  if (unrelated) return { port: requestedPort, occupied: true, classification: 'unrelated', verified: false, health: unrelated.health, listener: unrelated, listeners: entries, inspectionAvailable };
  return { port: requestedPort, occupied: true, classification: 'unknown', verified: false, health: inspectedHealth, listener: entries[0], listeners: entries, inspectionAvailable };
}

export function portOwnerSummary(owner = {}) {
  if (!owner || owner.occupied === false) return { state: 'free', occupied: false };
  if (owner.occupied == null) return { state: 'inspection-unavailable', occupied: null, health: owner.health?.state || null };
  if (owner.classification === 'dashboard') return { state: owner.staleBuild ? 'orphaned-dashboard' : 'dashboard', occupied: true, health: owner.health?.state || 'unknown' };
  if (owner.classification === 'unrelated') return { state: 'occupied-by-other', occupied: true, health: owner.health?.state || 'unknown' };
  return { state: 'occupied-unknown', occupied: true, health: owner.health?.state || 'unknown' };
}

/**
 * Return only the port facts that are safe to expose in status/diagnostics.
 * Process command lines, cwd, executable paths, and listener PIDs stay inside
 * the ownership decision so a status request cannot become a process
 * inspection or secret-disclosure surface.
 */
export function publicPortOwner(owner = {}) {
  // A healthy recorded runtime does not need a second lsof pass.  Preserve
  // that absence as `null` instead of manufacturing an "occupied-unknown"
  // object from the default parameter.
  if (!owner || typeof owner !== 'object' || Object.keys(owner).length === 0) return null;
  const summary = portOwnerSummary(owner);
  return {
    port: Number.isInteger(Number(owner.port)) ? Number(owner.port) : null,
    state: summary.state,
    occupied: summary.occupied,
    classification: owner.classification || 'unknown',
    verified: owner.verified === true,
    staleBuild: owner.staleBuild === true,
    health: owner.health?.state || null
  };
}
