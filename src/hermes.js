import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lookupBinary } from './open-agent.js';
import { emptyTokens, tokenActivity } from './core-tokens.js';
import { sessionIdentity } from './identity.js';

// Hermes's SQLite store also contains every message body, prompt, tool call,
// and FTS index. This module only delegates to the narrowly allowlisted helper
// below; never add a generic SQLite reader here.
const HERMES_SQLITE_HELPER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'hermes-sqlite-ro.py');
const HERMES_CONFIG_MAX_BYTES = 128 * 1024;
const HERMES_MAX_SESSIONS = 2_000;
const emptyLiveResult = (probe = 'unavailable') => ({ supported: false, probe, sessions: [], modelUsage: [], turnLeases: [] });
const exists = (value) => { try { return Boolean(value) && fs.statSync(value).isDirectory(); } catch { return false; } };
const fileExists = (value) => { try { return Boolean(value) && fs.statSync(value).isFile(); } catch { return false; } };
const asIso = (value) => {
  if (value == null || value === '') return null;
  const number = Number(value);
  const date = Number.isFinite(number) ? new Date(number < 100_000_000_000 ? number * 1_000 : number) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};
const normal = (value) => path.resolve(value).replace(/\\/g, '/');
const within = (child, parent) => normal(child).startsWith(`${normal(parent)}/`) || normal(child) === normal(parent);

export function hermesHost(source) {
  const value = String(source || '').trim().toLowerCase();
  if (value === 'desktop' || value === 'gui') return 'Hermes Desktop';
  if (value === 'tui') return 'Hermes TUI';
  if (value === 'cli') return 'Hermes CLI';
  if (value === 'gateway') return 'Hermes Gateway';
  return 'Hermes Agent';
}

function modelConfig(file) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > HERMES_CONFIG_MAX_BYTES) return { provider: null, model: null };
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    let inModel = false, provider = null, model = null;
    for (const line of lines) {
      if (!line.trim() || /^\s*#/.test(line)) continue;
      if (/^model\s*:\s*(?:#.*)?$/.test(line)) { inModel = true; continue; }
      if (/^[^\s].*:\s*/.test(line)) { inModel = false; continue; }
      if (!inModel) continue;
      const match = line.match(/^\s{2,}(provider|default)\s*:\s*["']?([^#"']+?)["']?\s*(?:#.*)?$/);
      if (!match) continue;
      if (match[1] === 'provider') provider = match[2].trim() || null;
      if (match[1] === 'default') model = match[2].trim() || null;
    }
    return { provider, model };
  } catch { return { provider: null, model: null }; }
}

export function hermesHomes(root = path.join(os.homedir(), '.hermes')) {
  const homes = exists(root) ? [{ root, profile: 'Default' }] : [];
  const profiles = path.join(root, 'profiles');
  try {
    for (const entry of fs.readdirSync(profiles, { withFileTypes: true })) {
      if (entry.isDirectory()) homes.push({ root: path.join(profiles, entry.name), profile: `Profile ${homes.length}` });
    }
  } catch {}
  return homes;
}

export function hermesInstallation({ homeDir = os.homedir(), env = process.env } = {}) {
  const root = env.HERMES_HOME || path.join(homeDir, '.hermes');
  const binary = lookupBinary('hermes', [path.join(homeDir, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'], env);
  const homes = hermesHomes(root);
  const installations = homes.map((home) => ({
    ...home,
    configFile: path.join(home.root, 'config.yaml'),
    dbFile: path.join(home.root, 'state.db'),
    activeSessionsFile: path.join(home.root, 'runtime', 'active_sessions.json')
  }));
  const primary = installations[0] || { root, configFile: path.join(root, 'config.yaml'), dbFile: path.join(root, 'state.db'), activeSessionsFile: path.join(root, 'runtime', 'active_sessions.json'), profile: 'Default' };
  const config = modelConfig(primary.configFile);
  const installed = Boolean(binary || homes.length || fileExists(primary.configFile) || fileExists(primary.dbFile));
  return { root, binary, homes: installations, primary, config, installed };
}

function helper(dbFile, operation = 'history', timeoutMs = 5_000) {
  if (!fileExists(dbFile)) return emptyLiveResult('not-configured');
  try {
    const child = spawnSync('python3', [HERMES_SQLITE_HELPER, dbFile, operation, String(HERMES_MAX_SESSIONS)], { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    if (child.error || child.status !== 0) return emptyLiveResult();
    const value = JSON.parse(child.stdout || '{}');
    return value && typeof value === 'object' ? value : emptyLiveResult();
  } catch { return emptyLiveResult(); }
}

function helperAsync(dbFile, operation = 'live', timeoutMs = 900) {
  if (!fileExists(dbFile)) return Promise.resolve(emptyLiveResult('not-configured'));
  return new Promise((resolve) => {
    let settled = false, output = '', timer = null;
    const finish = (value) => { if (settled) return; settled = true; if (timer) clearTimeout(timer); resolve(value); };
    try {
      const child = spawn('python3', [HERMES_SQLITE_HELPER, dbFile, operation, String(HERMES_MAX_SESSIONS)], { stdio: ['ignore', 'pipe', 'ignore'] });
      child.stdout.on('data', (chunk) => { output = `${output}${chunk}`; if (output.length > 2 * 1024 * 1024) { try { child.kill('SIGKILL'); } catch {} finish(emptyLiveResult()); } });
      child.once('error', () => finish(emptyLiveResult()));
      child.once('close', (code) => { if (code !== 0) return finish(emptyLiveResult()); try { const value = JSON.parse(output || '{}'); finish(value && typeof value === 'object' ? value : emptyLiveResult()); } catch { finish(emptyLiveResult()); } });
      timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} finish(emptyLiveResult()); }, timeoutMs);
      timer.unref?.();
    } catch { finish(emptyLiveResult()); }
  });
}

function projectFor(projects, candidate) {
  if (!candidate || typeof candidate !== 'string') return null;
  return (projects || []).filter((project) => project?.canonicalPath && within(candidate, project.canonicalPath)).sort((a, b) => b.canonicalPath.length - a.canonicalPath.length)[0] || null;
}

function tokensFrom(row = {}) {
  return {
    ...emptyTokens(),
    freshInput: Number(row.input_tokens) || 0,
    output: Number(row.output_tokens) || 0,
    cacheRead: Number(row.cache_read_tokens) || 0,
    cacheCreation: Number(row.cache_write_tokens) || 0,
    reasoning: Number(row.reasoning_tokens) || 0
  };
}

function routeFor(row = {}, config = {}) {
  const viaOpenRouter = String(row.billing_provider || '').toLowerCase() === 'openrouter';
  return {
    model: typeof row.model === 'string' && row.model ? row.model : null,
    gateway: viaOpenRouter ? 'OpenRouter' : null,
    configuredGateway: String(config.provider || '').toLowerCase() === 'openrouter' ? 'OpenRouter' : null
  };
}

function sessionRecord(row, projects, { profile = 'Default', config = {}, suffix = null } = {}) {
  const route = routeFor(row, config);
  if (!row?.id || !route.model) return null;
  const project = projectFor(projects, row.git_repo_root || row.cwd);
  const tokens = tokensFrom(row);
  const timestamp = asIso(row.last_seen || row.last_activity_at || row.ended_at || row.started_at);
  const identity = sessionIdentity({ agent: 'Hermes Agent', host: hermesHost(row.source), gateway: route.gateway, model: route.model, inferAgent: false });
  return {
    id: `Hermes:${row.id}${suffix || ''}`,
    adapterId: 'hermes',
    ...identity,
    // Never persist the actual database or home directory path into the index.
    sourceFile: '<hermes-state-db>',
    sourceFingerprint: `${row.id}:${row.last_seen || row.last_activity_at || row.ended_at || row.started_at || ''}:${route.model}`,
    timestamp,
    usageAt: timestamp,
    projectId: project?.id || null,
    projectPath: project?.canonicalPath || null,
    attributionConfidence: project ? 'Confirmed' : 'Unknown',
    tokens,
    tools: Number(row.tool_call_count) || 0,
    compactions: 0,
    hermes: {
      source: typeof row.source === 'string' ? row.source : 'unknown',
      profile,
      sessionEnded: row.ended_at != null,
      configuredGateway: route.configuredGateway,
      tokenEvidence: tokenActivity(tokens) > 0 ? 'Exact' : 'Unavailable'
    }
  };
}

export function readHermesHistory({ installation, projects = [], now = new Date() } = {}) {
  const install = installation || hermesInstallation();
  const sessions = [], diagnostics = { hermesDatabasesInspected: 0, hermesRecordsParsed: 0, hermesUnsupported: 0 };
  for (const home of install.homes || []) {
    const value = helper(home.dbFile, 'history');
    diagnostics.hermesDatabasesInspected++;
    if (!value.supported) { diagnostics.hermesUnsupported++; continue; }
    const usageBySession = new Map();
    for (const row of value.modelUsage || []) {
      if (!row?.session_id || !row?.model) continue;
      const list = usageBySession.get(row.session_id) || [];
      list.push(row);
      usageBySession.set(row.session_id, list);
    }
    for (const row of value.sessions || []) {
      const usage = usageBySession.get(row.id) || [];
      const records = usage.length ? usage.map((item) => ({ ...row, ...item, last_seen: item.last_seen || row.last_activity_at })) : [row];
      for (const [index, item] of records.entries()) {
        const record = sessionRecord(item, projects, { profile: home.profile, config: install.config, suffix: usage.length ? `:${index}` : null });
        if (record) sessions.push(record);
      }
    }
  }
  diagnostics.hermesRecordsParsed = sessions.length;
  return { sessions, diagnostics, observedAt: new Date(now).toISOString() };
}

export function discoverHermes({ homeDir = os.homedir(), env = process.env, now = new Date() } = {}) {
  const installation = hermesInstallation({ homeDir, env });
  const historyPaths = installation.homes.flatMap((home) => [home.dbFile, home.activeSessionsFile]);
  const historyRoot = historyPaths.some(fileExists);
  const history = readHermesHistory({ installation, now });
  return {
    installed: { state: installation.installed ? 'detected' : 'not-detected', evidence: [installation.binary && 'binary', installation.homes.length && 'hermes-home'].filter(Boolean), version: null, observedAt: new Date(now).toISOString() },
    history: history.sessions.length ? { state: 'observed', recordCount: history.sessions.length, newestAt: history.sessions.map((session) => session.timestamp).filter(Boolean).sort().at(-1) || null, reason: null } : { state: installation.installed ? 'none-yet' : 'unsupported', recordCount: 0, reason: historyRoot ? 'Hermes state exists; no allowlisted observed session was found.' : 'Use Hermes once to create supported structural session metadata.' },
    live: { state: 'unknown', evidence: [], freshness: 'unavailable', reason: 'Only a current Hermes turn lease can create live work.' },
    connection: { state: String(installation.config.provider || '').toLowerCase() === 'openrouter' ? 'configured' : 'not-applicable', provider: installation.config.provider || null },
    health: { level: installation.installed ? 'ok' : 'unknown', code: installation.installed ? 'detected' : 'not-detected', checkedAt: new Date(now).toISOString() },
    installation: { cli: Boolean(installation.binary), profiles: installation.homes.length, configuredProvider: installation.config.provider || null, configuredModel: installation.config.model || null, stateDatabase: installation.homes.some((home) => fileExists(home.dbFile)), activeRegistry: installation.homes.some((home) => fileExists(home.activeSessionsFile)) }
  };
}

function activeRegistry(file) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 256 * 1024) return [];
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
    return entries.flatMap((entry) => entry && typeof entry.session_id === 'string' ? [{ sessionId: entry.session_id, surface: typeof entry.surface === 'string' ? entry.surface : null }] : []);
  } catch { return []; }
}

// A durable session_turn_leases row is Hermes's current-turn ownership signal.
// It is intentionally distinct from active_sessions.json, which reserves a
// runtime slot and may exist while a desktop conversation is idle.
export function readHermesLive({ installation, now = Date.now() } = {}) {
  const install = installation || hermesInstallation();
  const active = [];
  for (const home of install.homes || []) {
    const value = helper(home.dbFile, 'live', 3_000);
    active.push(...liveRows(value, home, install, now));
  }
  return active.sort((a, b) => String(a.since).localeCompare(String(b.since)));
}

function liveRows(value, home, install, now) {
  if (!value?.supported) return [];
  const active = [], registry = new Map(activeRegistry(home.activeSessionsFile).map((entry) => [entry.sessionId, entry]));
  for (const lease of value.turnLeases || []) {
    const expires = Number(lease.expires_at) * 1_000;
    if (!lease?.conversation_id || !Number.isFinite(expires) || expires <= now) continue;
    const row = (value.sessions || []).find((session) => session.id === lease.conversation_id);
    if (!row) continue;
    const registryEntry = registry.get(lease.conversation_id), route = routeFor(row, install.config);
    active.push({ agent: 'Hermes Agent', profile: home.profile, sessionHash: crypto.createHash('sha256').update(`${home.profile}:${lease.conversation_id}`).digest('hex').slice(0, 16), host: registryEntry?.surface ? hermesHost(registryEntry.surface) : hermesHost(row.source), model: route.model, provider: sessionIdentity({ model: route.model, inferAgent: false }).provider, gateway: route.gateway, since: asIso(lease.acquired_at), leaseUntil: asIso(lease.expires_at), source: 'hermes-durable-turn-lease', confidence: 'Structured', reason: 'Hermes holds a current durable turn lease for this session.' });
  }
  return active;
}

export async function readHermesLiveAsync({ installation, now = Date.now(), timeoutMs = 3000 } = {}) {
  return (await readHermesLiveSnapshotAsync({ installation, now, timeoutMs })).turns;
}

// A failed narrow read is not the same thing as a successful read with no
// lease. Callers use this distinction to preserve a previously validated turn
// only until its own persisted expiry, never by an invented timeout.
export async function readHermesLiveSnapshotAsync({ installation, now = Date.now(), timeoutMs = 3000 } = {}) {
  const install = installation || hermesInstallation();
  if (!(install.homes || []).length) return { turns: [], probe: { state: 'not-configured', availableProfiles: [], unavailableProfiles: [], checkedAt: new Date(now).toISOString() } };
  const values = await Promise.all((install.homes || []).map(async (home) => ({ home, value: await helperAsync(home.dbFile, 'live', timeoutMs) })));
  const supported = values.filter(({ value }) => value?.supported);
  const state = supported.length === values.length ? 'ok'
    : supported.length ? 'partial'
      : values.every(({ value }) => value?.probe === 'unsupported') ? 'unsupported' : 'unavailable';
  return {
    turns: supported.flatMap(({ home, value }) => liveRows(value, home, install, now)).sort((a, b) => String(a.since).localeCompare(String(b.since))),
    probe: { state, availableProfiles: supported.map(({ home }) => home.profile), unavailableProfiles: values.filter(({ value }) => !value?.supported).map(({ home }) => home.profile), checkedAt: new Date(now).toISOString() }
  };
}

export function reconcileHermesLiveTurns(previous = [], snapshot = {}, now = Date.now()) {
  const retained = (previous || []).filter((turn) => new Date(turn?.leaseUntil).getTime() > now);
  const probe = snapshot?.probe || { state: 'unavailable', availableProfiles: [] };
  if (!['ok', 'partial'].includes(probe.state)) return { turns: retained, completed: [], probe, retainedByProbeFailure: retained.length > 0 };
  const availableProfiles = new Set(probe.availableProfiles || []);
  const readablePrior = retained.filter((turn) => availableProfiles.has(turn.profile));
  const unreadablePrior = retained.filter((turn) => !availableProfiles.has(turn.profile));
  const next = Array.isArray(snapshot?.turns) ? snapshot.turns : [];
  return { turns: [...next, ...unreadablePrior], completed: hermesLiveCompletions(readablePrior, next, now), probe, retainedByProbeFailure: unreadablePrior.length > 0 };
}

// Completion is a lifecycle transition, not an inference from a quiet file or
// a vanished process. This compact event feeds the existing Recent decay only
// after a previously observed durable turn lease is gone.
export function hermesLiveCompletions(previous = [], next = [], now = Date.now()) {
  const current = new Set((next || []).map((turn) => turn.sessionHash || `${turn.since || ''}|${turn.model || ''}|${turn.host || ''}`));
  return (previous || []).filter((turn) => !current.has(turn.sessionHash || `${turn.since || ''}|${turn.model || ''}|${turn.host || ''}`)).map((turn) => ({ agent: 'Hermes Agent', sessionHash: turn.sessionHash || null, host: turn.host || 'Hermes Agent', model: turn.model || null, timestamp: new Date(now).toISOString(), kind: 'hermes-durable-turn-completed' }));
}
