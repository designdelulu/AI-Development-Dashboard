import fs from 'node:fs';
import { readClineSessionMetadata } from './cline.js';

// Live monitoring retains only short-lived structural state. It deliberately
// ignores all transcript text, tool arguments, command bodies, and results.
const MAX_APPENDED_JSONL_BYTES = 256 * 1024;
export const CLAUDE_IN_PROGRESS_MAX_MS = 5 * 60_000;
export const CURSOR_IN_PROGRESS_MAX_MS = 5 * 60_000;
// Cline's session snapshot is a sparse lifecycle record.  Real observations
// on the installed Cursor extension showed roughly minute-long gaps between
// structural writes during a long-running turn, so the lease is measured from
// the last validated progress rather than from turn start.  Fifteen minutes is
// deliberately finite: it tolerates a slow remote model/tool without allowing
// an abandoned active snapshot to become a permanent Working state.
export const CLINE_IN_PROGRESS_MAX_MS = 15 * 60_000;

// A server restart may see a historical snapshot whose last status was still
// active.  Only a recently written active snapshot is safe to bootstrap as a
// current turn; otherwise it is merely retained for future change detection.
export function clineSnapshotBootstrapEligible(metadata, mtimeMs, now = Date.now(), maxAgeMs = CLINE_IN_PROGRESS_MAX_MS) {
  if (metadata?.status !== 'active' || !Number.isFinite(Number(mtimeMs))) return false;
  const age = now - Number(mtimeMs);
  return age >= -10_000 && age <= maxAgeMs;
}

function jsonRows(text, { skipFirst = false } = {}) {
  const lines = text.split('\n');
  const remainder = lines.pop() || '';
  return {
    rows: lines.slice(skipFirst ? 1 : 0).flatMap((line) => {
      try { return line ? [JSON.parse(line)] : []; } catch { return []; }
    }),
    remainder
  };
}

export function readAppendedJsonlRows(file, start = 0, carry = '') {
  try {
    const size = fs.statSync(file).size;
    const offset = Math.max(0, Math.min(size, Number(start) || 0));
    const bytes = Math.min(MAX_APPENDED_JSONL_BYTES, Math.max(0, size - offset));
    const actualStart = size - bytes;
    if (!bytes) return { rows: [], carry, size, truncated: false };
    const buffer = Buffer.alloc(bytes);
    const fd = fs.openSync(file, 'r');
    fs.readSync(fd, buffer, 0, bytes, actualStart);
    fs.closeSync(fd);
    const parsed = jsonRows(`${carry}${buffer.toString('utf8')}`, { skipFirst: actualStart > offset });
    return { ...parsed, size, truncated: actualStart > offset };
  } catch {
    return { rows: [], carry, size: 0, truncated: false };
  }
}

function contentRows(row) {
  return Array.isArray(row?.message?.content) ? row.message.content : [];
}

export function claudeToolLifecycleEvents(rows = []) {
  const events = [];
  for (const row of rows) for (const item of contentRows(row)) {
    if (item?.type === 'tool_use' && typeof item.id === 'string' && item.id) events.push({ type: 'started', id: item.id });
    if (item?.type === 'tool_result' && typeof item.tool_use_id === 'string' && item.tool_use_id) events.push({ type: 'completed', id: item.tool_use_id });
  }
  return events;
}

// Cursor's initial transcript marker is a `turn_ended` row. It does not prove
// a user asked its agent to work. User/assistant turn rows are safe structural
// evidence; their bodies are never retained.
export function cursorTranscriptHasAgentTurn(rows = []) {
  return rows.some((row) => {
    const type = String(row?.type || row?.role || '').toLowerCase();
    const nestedRole = String(row?.message?.role || row?.message?.type || '').toLowerCase();
    return ['user', 'assistant', 'turn_started', 'turn_start', 'agent_turn_started', 'composer_turn_started'].includes(type)
      || ['user', 'assistant'].includes(nestedRole)
      || (type === 'message' && ['user', 'assistant'].includes(nestedRole));
  });
}

const CURSOR_TURN_START_TYPES = new Set(['user', 'assistant', 'turn_started', 'turn_start', 'agent_turn_started', 'composer_turn_started']);
const CURSOR_TURN_END_TYPES = new Set(['turn_ended', 'turn_end', 'turn_complete', 'turn_completed', 'agent_turn_completed', 'composer_turn_completed']);

function cursorRowType(row = {}) {
  return String(row?.type || row?.role || row?.event || '').toLowerCase();
}

function cursorRowRole(row = {}) {
  return String(row?.message?.role || row?.message?.type || '').toLowerCase();
}

export function cursorTurnLifecycle(rows = []) {
  const events = [];
  for (const row of rows) {
    const type = cursorRowType(row);
    const role = cursorRowRole(row);
    if (CURSOR_TURN_END_TYPES.has(type) || (type === 'status' && ['complete', 'completed', 'success', 'done'].includes(String(row?.status || '').toLowerCase()))) events.push({ type: 'completed' });
    else if (CURSOR_TURN_START_TYPES.has(type) || ['user', 'assistant'].includes(role)) events.push({ type: 'started' });
  }
  return events;
}

export class CursorTurnTracker {
  constructor({ maxAgeMs = CURSOR_IN_PROGRESS_MAX_MS } = {}) {
    this.maxAgeMs = maxAgeMs;
    this.sessions = new Map();
  }

  observe(file, rows = [], at = Date.now()) {
    if (!file) return { started: false, completed: false, active: false };
    const prior = this.sessions.get(file) || { startedAt: null };
    let started = false;
    let completed = false;
    for (const event of cursorTurnLifecycle(rows)) {
      if (event.type === 'started') {
        if (prior.startedAt == null) started = true;
        prior.startedAt = at;
      } else if (event.type === 'completed') {
        if (prior.startedAt != null) completed = true;
        prior.startedAt = null;
      }
    }
    this.sessions.set(file, prior);
    return { started, completed, active: prior.startedAt != null };
  }

  remove(file) { this.sessions.delete(file); }
  clear() { this.sessions.clear(); }

  signal(now = Date.now()) {
    let since = null;
    for (const session of this.sessions.values()) {
      if (session.startedAt == null || now - session.startedAt > this.maxAgeMs) {
        session.startedAt = null;
        continue;
      }
      since = since == null ? session.startedAt : Math.min(since, session.startedAt);
    }
    return since == null ? null : {
      active: true,
      since: new Date(since).toISOString(),
      source: 'cursor-structured-turn-lifecycle',
      confidence: 'Structured',
      reason: 'A Cursor transcript structurally identifies an AI turn still in progress.'
    };
  }
}

// Cline session snapshots expose a small structural lifecycle state. Keep the
// in-progress hold separate from file-growth pulses so a sparse long-running
// turn remains Working without fabricating events. Unknown/complete snapshots
// never create activity.
export class ClineSessionTracker {
  constructor({ maxAgeMs = CLINE_IN_PROGRESS_MAX_MS } = {}) {
    this.maxAgeMs = maxAgeMs;
    this.sessions = new Map();
  }

  observe(file, metadata = null, at = Date.now()) {
    if (!file) return { started: false, completed: false, active: false };
    // JSON manifests and the Cline session database describe the same task.
    // Merge them by the stable session id so a quiet manifest cannot hide a
    // fresh database heartbeat (or cause a completion update to miss the
    // existing Working record).
    const sessionId = metadata?.id ? String(metadata.id) : null;
    const key = sessionId ? `session:${sessionId}` : file;
    const priorKey = sessionId
      ? [...this.sessions.entries()].find(([, value]) => value.sessionId === sessionId)?.[0]
      : null;
    const prior = this.sessions.get(key) || (priorKey ? this.sessions.get(priorKey) : null) || this.sessions.get(file) || { sessionId, sourcePath: file, sourcePaths: new Set(), startedAt: null, lastProgressAt: null, leaseUntil: null, status: null, authoritativeStatus: null, databaseRoute: null, fingerprint: null, expired: false, model: null, provider: null, gateway: null, host: null, reasonCode: null };
    if (priorKey && priorKey !== key) this.sessions.delete(priorKey);
    prior.sessionId = sessionId || prior.sessionId || null;
    prior.sourcePath = file || prior.sourcePath;
    if (!(prior.sourcePaths instanceof Set)) prior.sourcePaths = new Set(prior.sourcePath ? [prior.sourcePath] : []);
    if (file) prior.sourcePaths.add(file);
    let started = false;
    let completed = false;
    const fingerprint = metadata?.sourceFingerprint || null;
    const changed = fingerprint != null && fingerprint !== prior.fingerprint;
    const databaseSource = metadata?.sourceType === 'cline-session-db';
    if (databaseSource) prior.authoritativeStatus = metadata.status || prior.authoritativeStatus;
    // The lifecycle DB is also the freshest route identity during a live
    // turn. A quiet JSON manifest can retain the previous task's model, so it
    // must not overwrite a model/provider/gateway already confirmed by DB.
    if (databaseSource) {
      prior.databaseRoute ||= {};
      if (metadata?.route?.model) prior.databaseRoute.model = metadata.route.model;
      if (metadata?.route?.provider) prior.databaseRoute.provider = metadata.route.provider;
      if (metadata?.route?.gateway) prior.databaseRoute.gateway = metadata.route.gateway;
    }
    const route = databaseSource ? metadata?.route : (prior.databaseRoute || metadata?.route);
    if (route?.model) prior.model = route.model;
    if (route?.provider) prior.provider = route.provider;
    if (route?.gateway) prior.gateway = route.gateway;
    if (metadata?.host) prior.host = metadata.host;
    // The reviewed session DB is the stronger lifecycle source. Once it has
    // recorded a terminal state, a quiet/old JSON manifest cannot re-arm the
    // same session from a stale `running` snapshot. A genuinely resumed task
    // will produce a fresh database `running` row and clear this guard.
    if (metadata?.status === 'active' && prior.authoritativeStatus === 'complete' && !databaseSource) {
      prior.fingerprint = fingerprint || prior.fingerprint;
      this.sessions.set(key, prior);
      return { started: false, completed: false, active: false };
    }
    if (metadata?.status === 'active') {
      // An unchanged active snapshot is not a fresh turn. Once the bounded
      // orphan hold expires, do not re-arm it until the source fingerprint
      // changes or a completion record is observed.  While the lease is
      // valid, however, sparse snapshots remain Working; a remote model or a
      // long tool can legitimately leave the file unchanged for a while.
      if (prior.startedAt == null && (prior.status !== 'active' || changed || !prior.expired)) started = true;
      if (started || prior.startedAt != null) {
        prior.startedAt = prior.startedAt || at;
        if (started || changed || prior.lastProgressAt == null) {
          prior.lastProgressAt = at;
          prior.leaseUntil = at + this.maxAgeMs;
        } else if (prior.leaseUntil == null) {
          prior.leaseUntil = (prior.lastProgressAt || prior.startedAt) + this.maxAgeMs;
        }
        prior.expired = false;
        prior.reasonCode = databaseSource || (prior.authoritativeStatus === 'active' && prior.databaseRoute?.model)
          ? 'database-running'
          : (changed ? 'session-snapshot-progress' : 'active-turn-lease');
      }
    } else if (metadata?.status === 'complete') {
      if (prior.startedAt != null) completed = true;
      prior.startedAt = null;
      prior.lastProgressAt = null;
      prior.leaseUntil = null;
      prior.expired = false;
      prior.reasonCode = metadata?.sourceType === 'cline-session-db' ? 'database-complete' : 'session-complete';
    } else if (metadata?.status === 'attention') {
      // Attention is not in-progress work; retain no Working hold.
      prior.startedAt = null;
      prior.lastProgressAt = null;
      prior.leaseUntil = null;
      prior.expired = false;
      prior.reasonCode = 'attention-request';
    }
    prior.status = metadata?.status || prior.status;
    prior.fingerprint = fingerprint || prior.fingerprint;
    this.sessions.set(key, prior);
    return { started, completed, active: prior.startedAt != null };
  }

  observeFile(file, at = Date.now()) { return this.observe(file, readClineSessionMetadata(file), at); }
  remove(file) {
    this.sessions.delete(file);
    for (const [key, value] of this.sessions) if (value.sourcePath === file || value.sourcePaths?.has(file)) this.sessions.delete(key);
  }
  clear() { this.sessions.clear(); }

  signal(now = Date.now()) {
    let since = null;
    for (const session of this.sessions.values()) {
      const leaseUntil = session.leaseUntil ?? ((session.lastProgressAt || session.startedAt || 0) + this.maxAgeMs);
      if (session.startedAt == null || now > leaseUntil) {
        session.startedAt = null;
        session.lastProgressAt = null;
        session.leaseUntil = null;
        session.expired = true;
        continue;
      }
      since = since == null ? session.startedAt : Math.min(since, session.startedAt);
    }
    return since == null ? null : {
      active: true,
      since: new Date(since).toISOString(),
      source: 'cline-structured-session-lifecycle',
      confidence: 'Structured',
      reason: 'A Cline session structurally identifies an AI turn still in progress.',
      reasonCode: [...this.sessions.values()].find((session) => session.startedAt === since)?.reasonCode || 'active-turn-lease',
      model: [...this.sessions.values()].find((session) => session.startedAt === since)?.model || null,
      provider: [...this.sessions.values()].find((session) => session.startedAt === since)?.provider || null,
      gateway: [...this.sessions.values()].find((session) => session.startedAt === since)?.gateway || null,
      host: [...this.sessions.values()].find((session) => session.startedAt === since)?.host || null
    };
  }
}

export class ClaudeToolTracker {
  constructor({ maxAgeMs = CLAUDE_IN_PROGRESS_MAX_MS } = {}) {
    this.maxAgeMs = maxAgeMs;
    this.sessions = new Map();
  }

  observe(file, { previousSize = 0, at = Date.now() } = {}) {
    const prior = this.sessions.get(file) || { carry: '', active: new Map() };
    const parsed = readAppendedJsonlRows(file, previousSize, prior.carry);
    const active = prior.active;
    for (const event of claudeToolLifecycleEvents(parsed.rows)) {
      if (event.type === 'started') active.set(event.id, at);
      else active.delete(event.id);
    }
    this.sessions.set(file, { carry: parsed.carry, active });
    return { active: active.size, rows: parsed.rows.length, truncated: parsed.truncated };
  }

  remove(file) { this.sessions.delete(file); }
  clear() { this.sessions.clear(); }

  signal(now = Date.now()) {
    let since = null;
    let count = 0;
    for (const session of this.sessions.values()) {
      for (const [id, startedAt] of session.active) {
        if (!Number.isFinite(startedAt) || now - startedAt > this.maxAgeMs) {
          session.active.delete(id);
          continue;
        }
        count += 1;
        since = since == null ? startedAt : Math.min(since, startedAt);
      }
    }
    return count ? {
      active: true,
      since: new Date(since).toISOString(),
      source: 'claude-structured-tool-lifecycle',
      confidence: 'Structured',
      reason: 'A Claude session has a structurally observed tool still in progress.'
    } : null;
  }
}
