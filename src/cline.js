import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lookupBinary } from './open-agent.js';
import { sessionIdentity, inferProvider } from './identity.js';
import { emptyTokens, tokenActivity } from './core-tokens.js';
import { aggregateTokenDays, dedupeUsageEvents, tokensFromDays } from './usage-events.js';

// Cline has both a CLI and editor clients. This adapter only reads the stable,
// metadata-oriented session artifacts advertised by current Cline releases.
// It never opens providers.json, secret storage, message bodies, or tool input.
export const CLINE_SCHEMA_VERSION = 1;
export const CLINE_MAX_SESSION_BYTES = 2 * 1024 * 1024;
// The installed Cline 4.1.x SDK persists its canonical session lifecycle in
// sessions.db.  A fresh database timestamp is evidence of a current session;
// an old row that still says running is not enough to bootstrap live work.
export const CLINE_DB_LIVE_MAX_AGE_MS = 2 * 60_000;
const CLINE_DB_HELPER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'cline-sqlite-ro.py');

const CLINE_EXTENSION_IDS = Object.freeze(['saoudrizwan.claude-dev', 'rooveterinaryinc.cline']);
const JSON_EXT = /\.(?:json|jsonl)$/i;
const SESSION_FILE = /(?:^|[._-])(?:session|messages|manifest|snapshot)(?:[._-]|$)|\.json$/i;
const SECRET_KEY = /(?:api.?key|token|secret|password|credential|cookie|jwt|authorization)/i;
const CONTENT_KEY = /^(?:prompt|response|text|content|messages?|history|conversation|transcript|reasoning|tool(?:_?input|_?output|_?args?))$/i;
const CONTAINER_KEYS = new Set(['manifest', 'metadata', 'session', 'state', 'runtime', 'config', 'selection', 'model', 'usage', 'tokenUsage', 'tokens', 'stats', 'result', 'workspace', 'context', 'provider', 'llm', 'settings', 'info']);
const STATUS_ACTIVE = new Set(['active', 'working', 'running', 'executing', 'processing', 'streaming', 'planning', 'in_progress', 'in-progress', 'tool_running', 'tool-running', 'awaiting_tool', 'awaiting-tool']);
const STATUS_COMPLETE = new Set(['complete', 'completed', 'done', 'success', 'succeeded', 'idle', 'closed', 'failed', 'cancelled', 'canceled', 'archived', 'abandoned']);
const STATUS_ATTENTION = new Set(['ask', 'awaiting_user', 'awaiting-user', 'needs_input', 'needs-input', 'awaiting_approval', 'awaiting-approval', 'approval_required', 'approval-required']);

const normal = (value) => String(value || '').replace(/\\/g, '/');
const stat = (file) => { try { return fs.statSync(file); } catch { return null; } };
const exists = (file) => Boolean(stat(file));
const iso = (value) => {
  if (value == null || value === '') return null;
  const numeric = typeof value === 'number' || /^\d{10,}$/.test(String(value).trim()) ? Number(value) : NaN;
  const date = Number.isFinite(numeric) ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
const title = (value) => String(value || '').trim().replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function extensionRoots(homeDir, platform = process.platform) {
  const roots = [path.join(homeDir, '.vscode', 'extensions')];
  if (platform === 'darwin') roots.push(path.join(homeDir, 'Library', 'Application Support', 'Code', 'User', 'extensions'));
  if (platform === 'win32') roots.push(path.join(homeDir, 'AppData', 'Roaming', 'Code', 'User', 'extensions'));
  return roots;
}

// Cursor keeps extensions separate from vanilla VS Code. The dot-directory is
// the current macOS/Linux location; the application-support location is kept
// as a compatibility probe for builds that follow the VS Code layout.
function cursorExtensionRoots(homeDir, platform = process.platform) {
  const roots = [path.join(homeDir, '.cursor', 'extensions')];
  if (platform === 'darwin') roots.push(path.join(homeDir, 'Library', 'Application Support', 'Cursor', 'User', 'extensions'));
  if (platform === 'win32') roots.push(path.join(homeDir, 'AppData', 'Roaming', 'Cursor', 'User', 'extensions'));
  if (platform !== 'darwin' && platform !== 'win32') roots.push(path.join(homeDir, '.config', 'Cursor', 'User', 'extensions'));
  return roots;
}

function extensionRecordsFromRoots(roots, host) {
  return roots.flatMap((base) => {
    let entries = [];
    try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch {}
    return entries.filter((entry) => entry.isDirectory() && CLINE_EXTENSION_IDS.some((id) => entry.name === id || entry.name.startsWith(`${id}-`))).map((entry) => {
      const extensionPath = path.join(base, entry.name);
      let manifest = {};
      try { manifest = JSON.parse(fs.readFileSync(path.join(extensionPath, 'package.json'), 'utf8')); } catch {}
      return {
        path: extensionPath,
        host,
        id: `${manifest.publisher || entry.name.split('-')[0]}.${manifest.name || entry.name}`,
        displayName: typeof manifest.displayName === 'string' ? manifest.displayName : 'Cline',
        version: typeof manifest.version === 'string' ? manifest.version : null
      };
    });
  });
}

function extensionHostRecords(homeDir, platform) {
  return [
    ...extensionRecordsFromRoots(extensionRoots(homeDir, platform), 'VS Code'),
    ...extensionRecordsFromRoots(cursorExtensionRoots(homeDir, platform), 'Cursor')
  ];
}

export function clineHostForInstallation(installation = {}) {
  const hosts = [...new Set((installation.extensionRecords || []).map((record) => record.host).filter(Boolean))];
  if (hosts.length === 1 && !installation.binary) return hosts[0];
  if (!hosts.length && installation.binary) return 'Cline CLI';
  // When both an extension and the CLI are installed, a shared ~/.cline
  // session cannot be attributed safely without an explicit session field.
  return null;
}

export function clineHostForPath(file, installation = null) {
  const value = normal(file);
  if (/\/\.cursor\/extensions\//i.test(value) || /\/Application Support\/Cursor\/User\/extensions\//i.test(value) || /\/Application Support\/Cursor\/User\/globalStorage\//i.test(value)) return 'Cursor';
  if (/\/\.vscode\/extensions\//i.test(value) || /\/Application Support\/Code\/User\/extensions\//i.test(value)) return 'VS Code';
  return clineHostForInstallation(installation || {}) || null;
}

export function clineInstallation({ homeDir = os.homedir(), env = process.env, platform = process.platform } = {}) {
  const root = path.join(homeDir, '.cline');
  const dataRoot = path.join(root, 'data');
  const sessionsRoot = path.join(dataRoot, 'sessions');
  const dbRoot = path.join(dataRoot, 'db');
  const binary = lookupBinary('cline', [path.join(homeDir, '.local', 'bin'), path.join(homeDir, '.npm-global', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'], env);
  const extensionRecords = extensionHostRecords(homeDir, platform);
  const extensions = extensionRecords.map((record) => record.path);
  return {
    root, dataRoot, sessionsRoot, dbRoot, dbFile: path.join(dbRoot, 'sessions.db'), binary, extensions, extensionRecords,
    cursorExtensions: extensionRecords.filter((record) => record.host === 'Cursor'),
    vscodeExtensions: extensionRecords.filter((record) => record.host === 'VS Code')
  };
}

function isSessionFile(file, sessionsRoot) {
  const relative = normal(path.relative(sessionsRoot, file));
  if (!relative || relative.startsWith('../') || !JSON_EXT.test(file)) return false;
  // Cline stores transcript/message bodies beside the structural snapshot.
  // They are deliberately excluded before opening them.
  if (/sessions\.db(?:[-.].*)?$/i.test(file) || /\.compaction\.json$/i.test(file) || /\.messages\.json$/i.test(file)) return false;
  return SESSION_FILE.test(path.basename(file));
}

function collectSessionFiles(sessionsRoot, maxDepth = 4, depth = 0, out = []) {
  if (!exists(sessionsRoot) || depth > maxDepth || out.length >= 500) return out;
  let entries = [];
  try { entries = fs.readdirSync(sessionsRoot, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (out.length >= 500) break;
    const file = path.join(sessionsRoot, entry.name);
    if (entry.isDirectory()) collectSessionFiles(file, maxDepth, depth + 1, out);
    else if (isSessionFile(file, sessionsRoot)) out.push(file);
  }
  return out;
}

// Traversal is intentionally limited to metadata containers. Content-bearing
// keys are never inspected for a model, project, state, or token value.
function metadataValues(value, keys, depth = 0, seen = new Set()) {
  if (!value || typeof value !== 'object' || depth > 4 || seen.has(value)) return [];
  seen.add(value);
  const found = [];
  if (Array.isArray(value)) return value.slice(0, 20).flatMap((item) => metadataValues(item, keys, depth + 1, seen));
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key) || CONTENT_KEY.test(key)) continue;
    if (keys.has(key) && (typeof child === 'string' || typeof child === 'number' || typeof child === 'boolean')) found.push(child);
    if (CONTAINER_KEYS.has(key) || depth === 0) found.push(...metadataValues(child, keys, depth + 1, seen));
  }
  return found;
}

function firstString(value, keys) {
  return metadataValues(value, new Set(keys)).find((item) => typeof item === 'string' && item.trim())?.trim() || null;
}
function firstNumber(value, keys) {
  return metadataValues(value, new Set(keys)).map(number).find((item) => item != null) ?? null;
}
function firstTime(value, keys) {
  return metadataValues(value, new Set(keys)).map(iso).find(Boolean) || null;
}

function normalizedStatus(value) {
  const status = String(value || '').trim().toLowerCase().replace(/[\s.]+/g, '_');
  if (STATUS_ATTENTION.has(status)) return 'attention';
  if (STATUS_ACTIVE.has(status)) return 'active';
  if (STATUS_COMPLETE.has(status)) return 'complete';
  return null;
}

function tokenValues(value) {
  if (!value || typeof value !== 'object') return null;
  const candidates = [value, ...metadataObjects(value, new Set(['usage', 'tokenUsage', 'tokens', 'stats', 'result']))];
  for (const candidate of candidates) {
    const tokens = {
      freshInput: number(candidate.input_tokens ?? candidate.inputTokens ?? candidate.prompt_tokens ?? candidate.promptTokens),
      output: number(candidate.output_tokens ?? candidate.outputTokens ?? candidate.completion_tokens ?? candidate.completionTokens),
      cacheRead: number(candidate.cache_read_input_tokens ?? candidate.cacheReadInputTokens ?? candidate.cached_tokens ?? candidate.cacheReadTokens),
      cacheCreation: number(candidate.cache_creation_input_tokens ?? candidate.cacheCreationInputTokens ?? candidate.cacheWriteTokens),
      reasoning: number(candidate.reasoning_tokens ?? candidate.reasoningTokens ?? candidate.reasoning_output_tokens),
      other: number(candidate.other_tokens ?? candidate.otherTokens)
    };
    for (const key of Object.keys(tokens)) if (tokens[key] == null) tokens[key] = 0;
    if (tokenActivity(tokens) > 0) return tokens;
  }
  return null;
}

function metadataObjects(value, keys, depth = 0, seen = new Set()) {
  if (!value || typeof value !== 'object' || depth > 4 || seen.has(value)) return [];
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 20).flatMap((item) => metadataObjects(item, keys, depth + 1, seen));
  const found = [];
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key) || CONTENT_KEY.test(key)) continue;
    if (keys.has(key) && child && typeof child === 'object' && !Array.isArray(child)) found.push(child);
    if (CONTAINER_KEYS.has(key) || depth === 0) found.push(...metadataObjects(child, keys, depth + 1, seen));
  }
  return found;
}

function modelAndRoute(value) {
  const model = firstString(value, ['modelId', 'model_id', 'currentModelId', 'current_model_id', 'model', 'modelName', 'model_name']);
  const rawProvider = firstString(value, ['gateway', 'gatewayId', 'gateway_id', 'providerId', 'provider_id', 'apiProvider', 'api_provider', 'provider']);
  const explicitUnderlying = firstString(value, ['underlyingProvider', 'underlying_provider', 'modelProvider', 'model_provider', 'upstreamProvider', 'upstream_provider']);
  const isOpenRouter = /openrouter/i.test(String(rawProvider || '')) || /openrouter/i.test(String(firstString(value, ['route', 'providerName', 'provider_name']) || ''));
  const inferred = inferProvider(model, { agent: 'Cline' });
  const provider = explicitUnderlying || (isOpenRouter ? (inferred.provider === 'Unknown' ? null : inferred.provider) : (rawProvider || (inferred.provider === 'Unknown' ? null : inferred.provider)));
  return { model, provider: provider ? title(provider) : null, gateway: isOpenRouter ? 'OpenRouter' : (rawProvider && !/openrouter/i.test(rawProvider) ? title(rawProvider) : null), gatewayConfigured: Boolean(isOpenRouter), modelConfigured: model };
}

function unsupportedSchema(value) {
  const version = firstNumber(value, ['schemaVersion', 'schema_version']);
  return version != null && version > CLINE_SCHEMA_VERSION;
}

function metadataRecord(value, file, { fallbackId = null, hostHint = null } = {}) {
  if (unsupportedSchema(value)) return null;
  const explicitId = firstString(value, ['sessionId', 'session_id', 'taskId', 'task_id', 'conversationId', 'conversation_id', 'id']);
  const route = modelAndRoute(value);
  // The current Cline session snapshot also carries a host-side process id
  // and source marker.  These are structural lifecycle metadata only; they
  // are never used to read command lines, credentials, or message bodies.
  const processId = firstNumber(value, ['pid', 'processId', 'process_id']);
  const source = firstString(value, ['source', 'sourceName', 'source_name']);
  const client = firstString(value, ['client', 'clientName', 'client_name', 'host', 'runtime', 'frontend']);
  const explicitHost = /cursor/i.test(String(client || '')) ? 'Cursor' : /vscode|visual studio code|code/i.test(String(client || '')) ? 'VS Code' : /cli|terminal/i.test(String(client || '')) ? 'Cline CLI' : null;
  const host = explicitHost || hostHint || 'Cline';
  const status = normalizedStatus(firstString(value, ['status', 'state', 'phase', 'lifecycle', 'sessionStatus', 'session_status', 'mode']));
  const cwd = firstString(value, ['cwd', 'workspaceRoot', 'workspace_root', 'projectPath', 'project_path', 'projectRoot', 'project_root', 'rootPath', 'root_path']);
  const timestamp = firstTime(value, ['updatedAt', 'updated_at', 'lastActivityAt', 'last_activity_at', 'endedAt', 'ended_at', 'completedAt', 'completed_at', 'startedAt', 'started_at', 'createdAt', 'created_at', 'timestamp', 'ts']);
  const usage = tokenValues(value);
  // A filename alone is not historical-use evidence. Only use a filename
  // fallback when the record also exposes a bounded structural signal.
  const id = explicitId || ((fallbackId && (status || timestamp || route.model || cwd || usage)) ? fallbackId : null);
  if (!id) return null;
  const usageAt = firstTime(value, ['usageAt', 'usage_at', 'updatedAt', 'updated_at', 'lastActivityAt', 'last_activity_at', 'timestamp', 'ts']) || timestamp;
  return { id: String(id), host, hostEvidence: explicitHost ? 'session-record' : hostHint ? 'installation-context' : 'unknown', cwd, status, timestamp, startedAt: firstTime(value, ['startedAt', 'started_at']), processId, source, usage, usageAt, route, tools: firstNumber(value, ['toolCalls', 'tool_calls', 'toolCount', 'tool_count']) || 0, requestCount: firstNumber(value, ['requestCount', 'request_count']) || null };
}

function parseJsonFile(file, { hostHint = null } = {}) {
  const source = stat(file);
  if (!source || source.size > CLINE_MAX_SESSION_BYTES) return { record: null, usage: [], oversized: true };
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    const unsupported = unsupportedSchema(value);
    const record = metadataRecord(value, file, { fallbackId: path.basename(file).replace(/\.(?:messages\.)?json$/i, ''), hostHint });
    const tokens = record?.usage;
    return { record, usage: tokens && record.usageAt ? [{ timestamp: record.usageAt, tokens, evidence: 'Exact', recordType: 'cline-session-usage', uuid: hash(`${file}:${record.usageAt}:${tokenActivity(tokens)}`) }] : [], unsupported, oversized: false };
  } catch { return { record: null, usage: [], malformed: true }; }
}

function parseJsonlFile(file, { hostHint = null } = {}) {
  const source = stat(file);
  if (!source || source.size > CLINE_MAX_SESSION_BYTES) return { record: null, usage: [], oversized: true };
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return { record: null, usage: [], malformed: true }; }
  const rows = [];
  for (const line of text.split(/\r?\n/).filter(Boolean).slice(-5000)) {
    try { rows.push(JSON.parse(line)); } catch {}
  }
  const unsupported = rows.filter(unsupportedSchema).length;
  const records = rows.filter((row) => !unsupportedSchema(row)).map((row) => metadataRecord(row, file, { fallbackId: path.basename(file, '.jsonl'), hostHint })).filter(Boolean);
  const latest = records.sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || ''))).at(-1) || null;
  const usage = rows.filter((row) => !unsupportedSchema(row)).map((row) => { const record = metadataRecord(row, file, { fallbackId: path.basename(file, '.jsonl'), hostHint }); return record?.usage && record.usageAt ? { timestamp: record.usageAt, tokens: record.usage, evidence: 'Exact', recordType: 'cline-jsonl-usage', uuid: hash(`${file}:${record.usageAt}:${tokenActivity(record.usage)}`) } : null; }).filter(Boolean);
  return { record: latest, usage, rows, unsupported, oversized: false };
}

export function readClineSessionMetadata(file, { hostHint = null } = {}) {
  if (!file || !JSON_EXT.test(file)) return null;
  if (/\.messages\.json$/i.test(file) || /\.compaction\.json$/i.test(file)) return null;
  const parsed = file.toLowerCase().endsWith('.jsonl') ? parseJsonlFile(file, { hostHint }) : parseJsonFile(file, { hostHint });
  if (!parsed.record) return null;
  return { ...parsed.record, file, sourceFingerprint: sourceFingerprint(file), usage: undefined, usageEvents: parsed.usage || [] };
}

// Cline's current SDK keeps the durable session lifecycle in SQLite while the
// adjacent JSON manifest is primarily a creation/history artifact.  Keep this
// query deliberately narrow: no prompt, message, metadata, credential, or
// transcript columns are ever selected.
export function clineDbRowMetadata(row, { hostHint = null } = {}) {
  if (!row || typeof row !== 'object' || !String(row.session_id || '').trim()) return null;
  const updatedAt = iso(row.updated_at);
  const startedAt = iso(row.started_at);
  const endedAt = iso(row.ended_at);
  const record = metadataRecord({
    session_id: row.session_id,
    pid: row.pid,
    status: row.status,
    started_at: row.started_at,
    ended_at: row.ended_at,
    provider: row.provider,
    model: row.model,
    cwd: row.cwd,
    workspace_root: row.workspace_root,
    updated_at: row.updated_at,
    status_lock: row.status_lock
  }, '<cline-session-db>', { fallbackId: row.session_id, hostHint });
  if (!record) return null;
  return {
    ...record,
    // The generic metadata walker intentionally preserves source-agnostic
    // timestamp behavior. For the lifecycle DB, freshness is specifically
    // the heartbeat column, not the original session start time.
    timestamp: updatedAt || record.timestamp,
    updatedAt,
    startedAt: startedAt || record.startedAt,
    endedAt,
    source: 'cline-session-db',
    sourceType: 'cline-session-db',
    sessionDb: true,
    sourceFingerprint: `db:${row.updated_at || ''}:${row.status_lock ?? ''}:${row.status || ''}:${row.model || ''}`
  };
}

export function clineDbActiveEligible(metadata, now = Date.now(), maxAgeMs = CLINE_DB_LIVE_MAX_AGE_MS) {
  if (!metadata || metadata.status !== 'active') return false;
  const at = Date.parse(metadata.updatedAt || metadata.timestamp || '');
  if (!Number.isFinite(at)) return false;
  const age = Number(now) - at;
  return age >= -10_000 && age <= maxAgeMs;
}

export function readClineSessionDbMetadata(dbFile, { hostHint = null, timeoutMs = 1_000 } = {}) {
  if (!dbFile || !exists(dbFile)) return Promise.resolve([]);
  return new Promise((resolve) => {
    let child;
    let output = '';
    let settled = false;
    const finish = (rows = []) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const parsed = Array.isArray(rows) ? rows.map((row) => clineDbRowMetadata(row, { hostHint })).filter(Boolean) : [];
      resolve(parsed);
    };
    const timer = setTimeout(() => {
      try { child?.kill('SIGTERM'); } catch {}
      finish([]);
    }, Math.max(100, Number(timeoutMs) || 1_000));
    try {
      child = spawn('python3', [CLINE_DB_HELPER, dbFile], { stdio: ['pipe', 'pipe', 'ignore'] });
      child.stdout.on('data', (chunk) => {
        output += chunk.toString('utf8');
        if (output.length > 2 * 1024 * 1024) {
          try { child.kill('SIGTERM'); } catch {}
          finish([]);
        }
      });
      child.once('error', () => finish([]));
      child.once('close', (code) => {
        if (code !== 0 || !output.trim()) return finish([]);
        try { finish(JSON.parse(output)); } catch { finish([]); }
      });
      child.stdin.end();
    } catch { finish([]); }
  });
}

export function clineLiveDecision(file, previous, next, metadata = null) {
  if (!file || !/\/\.cline\/data\/sessions\//i.test(normal(file)) || !next) return { emit: false, keep: Boolean(next), active: false, completed: !next, reason: 'unsupported-path' };
  const grew = !previous ? next.size > 0 : next.size > previous.size;
  const active = metadata?.status === 'active';
  const completed = metadata?.status === 'complete';
  // The tracker owns the sustained Working hold. Emit a discrete event only
  // for bytes/lifecycle changes; repeatedly polling an unchanged active
  // snapshot must not fabricate zero-byte waveform pulses.
  if (completed || grew) return { emit: true, keep: true, active, completed, attention: metadata?.status === 'attention', reason: completed ? 'structured-session-complete' : 'session-growth' };
  return { emit: false, keep: true, active: false, completed: false, reason: 'no-validated-change' };
}

export function clineInstallationState({ homeDir = os.homedir(), env = process.env, platform = process.platform } = {}) {
  const installation = clineInstallation({ homeDir, env, platform });
  const evidence = [];
  if (installation.binary) evidence.push('binary');
  if (exists(installation.root)) evidence.push('local-root');
  if (installation.cursorExtensions.length) evidence.push('cursor-extension');
  if (installation.vscodeExtensions.length) evidence.push('vscode-extension');
  const sessionEvidence = exists(installation.sessionsRoot) ? 'session-root' : exists(installation.dbFile) ? 'session-index' : null;
  if (sessionEvidence) evidence.push(sessionEvidence);
  const installed = evidence.length > 0;
  const hosts = [...new Set(installation.extensionRecords.map((record) => record.host))];
  return { ...installation, installed, evidence, hosts, primaryHost: clineHostForInstallation(installation), schema: sessionEvidence ? 'cline-session-artifacts' : null };
}

export function discoverCline({ homeDir = os.homedir(), env = process.env, platform = process.platform, now = new Date() } = {}) {
  const installation = clineInstallationState({ homeDir, env, platform });
  const files = collectSessionFiles(installation.sessionsRoot);
  const historySupported = exists(installation.sessionsRoot) || exists(installation.dbFile);
  // A session root is only installation/telemetry evidence. Promote it to
  // historical use only when at least one bounded structural snapshot parses;
  // message bodies and unsupported schemas never establish history.
  const observedFiles = files.filter((file) => Boolean(readClineSessionMetadata(file, { hostHint: clineHostForPath(file, installation) })));
  const version = installation.extensionRecords.map((record) => record.version).filter(Boolean).sort().at(-1) || null;
  return {
    installed: { state: installation.installed ? 'detected' : 'not-detected', evidence: installation.evidence, version, observedAt: new Date(now).toISOString() },
    history: historySupported ? (observedFiles.length ? { state: 'observed', recordCount: observedFiles.length, reason: 'Supported structural Cline session metadata has been observed.' } : { state: 'none-yet', recordCount: 0, reason: files.length ? 'Cline session artifacts exist, but no supported structural record has been confirmed.' : 'Use Cline once to create a supported local session artifact.' }) : { state: installation.installed ? 'none-yet' : 'unsupported', recordCount: 0, reason: installation.installed ? 'Cline is installed; no supported session artifact exists yet.' : 'Cline is not detected.' },
    live: { state: 'unknown', evidence: [], freshness: 'unavailable', reason: 'Only structured Cline session state can create live work; editor presence alone is not activity.' },
    connection: { state: 'not-applicable' },
    installation: { hosts: installation.hosts, primaryHost: installation.primaryHost, cursorExtension: installation.cursorExtensions.length > 0, vscodeExtension: installation.vscodeExtensions.length > 0, cli: Boolean(installation.binary), versions: installation.extensionRecords.map((record) => record.version).filter(Boolean) },
    telemetry: { sessionRoot: exists(installation.sessionsRoot), sessionIndex: exists(installation.dbFile), extension: installation.extensions.length > 0, jsonSnapshots: files.length, gatewayRouting: 'Observed session metadata only; provider settings and credentials are not read.' },
    health: { level: installation.installed ? 'ok' : 'unknown', code: installation.installed ? 'detected' : 'not-detected', checkedAt: new Date(now).toISOString() }
  };
}

function sourceFingerprint(file) { const value = stat(file); return value ? `${value.size}:${Math.round(value.mtimeMs)}` : null; }
function projectFor(projects, cwd) { const target = normal(cwd); if (!target) return null; return projects.filter((project) => { const root = normal(project.canonicalPath); return target === root || target.startsWith(`${root}/`); }).sort((a, b) => normal(b.canonicalPath).length - normal(a.canonicalPath).length)[0] || null; }
function normalizedSession(file, parsed, projects) {
  const record = parsed.record;
  if (!record) return null;
  const project = projectFor(projects, record.cwd);
  const identity = sessionIdentity({ agent: 'Cline', host: record.host, provider: record.route.provider, gateway: record.route.gateway, model: record.route.model, inferAgent: false });
  const days = aggregateTokenDays(dedupeUsageEvents(parsed.usage || []));
  const tokens = tokensFromDays(days);
  return {
    id: `Cline:${record.id}`,
    adapterId: 'cline',
    ...identity,
    hostEvidence: record.hostEvidence || 'unknown',
    sourceFile: file,
    sourceFingerprint: sourceFingerprint(file),
    timestamp: record.timestamp,
    projectId: project?.id || null,
    projectPath: project?.canonicalPath || null,
    attributionConfidence: project ? 'Confirmed' : 'Unknown',
    modelSource: record.route.model ? 'cline-session-record' : null,
    modelConfidence: record.route.model ? 'Observed' : null,
    tokens,
    tokenDays: days,
    tokenEventCount: Object.values(days).reduce((total, day) => total + (day.eventCount || 0), 0),
    usageStartedAt: Object.values(days).map((day) => day.firstAt).filter(Boolean).sort()[0] || null,
    usageEndedAt: Object.values(days).map((day) => day.lastAt).filter(Boolean).sort().at(-1) || null,
    recordedAt: new Date().toISOString(),
    tools: record.tools || 0,
    compactions: 0,
    attributedSkills: [],
    efficiencyEvents: [],
    harnessRunId: null,
    clineStatus: record.status || 'unknown',
    clineTelemetry: { source: 'metadata-only-session-artifact', gatewayConfigured: record.route.gatewayConfigured, requestCount: record.requestCount, hostEvidence: record.hostEvidence || 'unknown', evidence: tokens && tokenActivity(tokens) > 0 ? 'Exact' : 'Unavailable' }
  };
}

function reuse(prior, { hostHint = null } = {}) {
  const next = { ...prior, tokenDays: prior.tokenDays || {}, tokens: prior.tokens || emptyTokens(), efficiencyEvents: prior.efficiencyEvents || [], attributedSkills: prior.attributedSkills || [] };
  // A prior index may have been written before Cursor extension probing was
  // added. Upgrade only the old generic Cline host; never overwrite an
  // explicit Cline CLI/VS Code/session-record identity.
  if (hostHint && (!prior.host || prior.host === 'Cline')) {
    const identity = sessionIdentity({ agent: 'Cline', host: hostHint, provider: prior.provider || null, gateway: prior.gateway || null, account: prior.account || null, model: prior.modelRaw || prior.model, role: prior.role || null, harness: prior.harness || 'standalone', inferAgent: false });
    Object.assign(next, identity, { hostEvidence: 'installation-context' });
  }
  return next;
}

export function scanCline(projects = [], root = path.join(os.homedir(), '.cline'), previous = new Map(), { now = new Date(), installation = null } = {}) {
  const sessionsRoot = path.join(root, 'data', 'sessions');
  const sourceInstallation = installation || clineInstallation({ homeDir: path.dirname(root), env: process.env, platform: process.platform });
  const files = collectSessionFiles(sessionsRoot);
  const sessions = [];
  let inspected = 0, parsed = 0, changed = 0, malformed = 0, oversized = 0, unsupported = 0;
  for (const file of files) {
    inspected++;
    const fingerprint = sourceFingerprint(file);
    const hostHint = clineHostForPath(file, sourceInstallation);
    const prior = previous.get(file);
    if (prior?.sourceFingerprint === fingerprint && prior?.adapterId === 'cline') { sessions.push(reuse(prior, { hostHint })); continue; }
    changed++;
    const parsedFile = file.toLowerCase().endsWith('.jsonl') ? parseJsonlFile(file, { hostHint }) : parseJsonFile(file, { hostHint });
    if (parsedFile.oversized) { oversized++; continue; }
    if (parsedFile.malformed) { malformed++; continue; }
    unsupported += parsedFile.unsupported || 0;
    if (parsedFile.record) { parsed++; const session = normalizedSession(file, parsedFile, projects); if (session) sessions.push(session); }
  }
  return { sessions, diagnostics: { clineFilesInspected: inspected, clineFilesChanged: changed, clineRecordsParsed: parsed, clineUnsupported: unsupported, clineMalformed: malformed, clineOversized: oversized, clineSessionRoot: sessionsRoot, clineSessionIndex: exists(path.join(root, 'data', 'db', 'sessions.db')) } , observedAt: now.toISOString() };
}
