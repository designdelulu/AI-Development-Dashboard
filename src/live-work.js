import fs from 'node:fs';

// Live monitoring retains only short-lived structural state. It deliberately
// ignores all transcript text, tool arguments, command bodies, and results.
const MAX_APPENDED_JSONL_BYTES = 256 * 1024;
export const CLAUDE_IN_PROGRESS_MAX_MS = 5 * 60_000;

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
  return rows.some((row) => ['user', 'assistant'].includes(String(row?.type || row?.role || '').toLowerCase()));
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
