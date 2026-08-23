import fs from 'node:fs';
import { readClineSessionMetadata } from './cline.js';

// Live monitoring retains only short-lived structural state. It deliberately
// ignores all transcript text, tool arguments, command bodies, and results.
const MAX_APPENDED_JSONL_BYTES = 256 * 1024;
export const CLAUDE_IN_PROGRESS_MAX_MS = 5 * 60_000;
export const CURSOR_IN_PROGRESS_MAX_MS = 5 * 60_000;
export const CLINE_IN_PROGRESS_MAX_MS = 5 * 60_000;

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
    const prior = this.sessions.get(file) || { startedAt: null };
    let started = false;
    let completed = false;
    if (metadata?.status === 'active') {
      if (prior.startedAt == null) started = true;
      prior.startedAt = prior.startedAt || at;
    } else if (metadata?.status === 'complete') {
      if (prior.startedAt != null) completed = true;
      prior.startedAt = null;
    } else if (metadata?.status === 'attention') {
      // Attention is not in-progress work; retain no Working hold.
      prior.startedAt = null;
    }
    this.sessions.set(file, prior);
    return { started, completed, active: prior.startedAt != null };
  }

  observeFile(file, at = Date.now()) { return this.observe(file, readClineSessionMetadata(file), at); }
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
      source: 'cline-structured-session-lifecycle',
      confidence: 'Structured',
      reason: 'A Cline session structurally identifies an AI turn still in progress.'
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
