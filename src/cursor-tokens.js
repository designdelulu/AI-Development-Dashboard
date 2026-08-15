import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emptyTokens } from './core-tokens.js';
import { addTokens } from './tokens.js';
import { aggregateTokenDays, tokensFromDays } from './usage-events.js';
import { TOKEN_EVIDENCE } from './token-evidence.js';

export const CURSOR_TOKEN_CLASSIFICATION = 'yellow-undocumented-local-storage';
export const CURSOR_CHARS_PER_TOKEN = 4;
export const CURSOR_LOOKBACK_DAYS = 180;
export const CURSOR_PROVENANCE = 'Adapted from CodeBurn MIT Cursor provider ideas (cursorDiskKV bubbleId/composerData, known {0,0} tokenCount bug, composerData.promptTokenBreakdown as a context meter). Small internal adapter; not a vendored copy.';

export function estimateTokensFromChars(chars) {
  const count = Number(chars) || 0;
  if (count <= 0) return 0;
  return Math.round(count / CURSOR_CHARS_PER_TOKEN);
}

export function cursorDbPath(homeDir = os.homedir()) {
  if (process.platform === 'darwin') return path.join(homeDir, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  if (process.platform === 'win32') return path.join(homeDir, 'AppData', 'Roaming', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  return path.join(homeDir, '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
}

const helper = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'cursor-sqlite-ro.py');

function sqliteJson(dbPath, sql, { timeout = 20_000 } = {}) {
  const result = spawnSync('python3', [helper, dbPath], {
    input: sql,
    encoding: 'utf8',
    timeout,
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.error) {
    const error = result.error;
    error.busy = error.code === 'ETIMEDOUT' || /busy|locked/i.test(error.message || '');
    throw error;
  }
  if (result.status !== 0) {
    const err = (result.stderr || result.stdout || '').trim() || `python sqlite exit ${result.status}`;
    const error = new Error(err);
    error.busy = /busy|locked|timeout/i.test(err);
    throw error;
  }
  const text = (result.stdout || '').trim();
  if (!text) return [];
  return JSON.parse(text);
}

function iso(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function composerIdFromBubbleKey(key) {
  const match = String(key || '').match(/^bubbleId:([^:]+):/);
  return match ? match[1] : null;
}

export function cursorEventsFromRows({ bubbles = [], composers = [] } = {}) {
  const composerMeta = new Map();
  for (const row of composers) {
    const id = String(row.composer_id || '').replace(/^composerData:/, '');
    const tokens = Number(row.used || row.ctx) || 0;
    composerMeta.set(id, { tokens, createdAt: iso(row.created_at), model: row.model || null });
  }
  const byComposer = new Map();
  for (const row of bubbles) {
    const id = row.composer_id || composerIdFromBubbleKey(row.key);
    if (!id) continue;
    const list = byComposer.get(id) || [];
    list.push(row);
    byComposer.set(id, list);
  }
  const events = [];
  const composersSeen = new Set([...byComposer.keys(), ...composerMeta.keys()]);
  for (const id of composersSeen) {
    const rows = byComposer.get(id) || [];
    const meta = composerMeta.get(id);
    const hasExactBubble = rows.some((row) => (Number(row.input_tokens) || 0) > 0 || (Number(row.output_tokens) || 0) > 0);
    for (const row of rows) {
      const timestamp = iso(row.created_at);
      if (!timestamp) continue;
      const input = Number(row.input_tokens) || 0;
      const output = Number(row.output_tokens) || 0;
      const textLen = Number(row.text_len) || 0;
      const type = Number(row.bubble_type);
      let tokens = emptyTokens();
      let evidence = TOKEN_EVIDENCE.exact;
      let recordType = 'cursor-bubble-tokens';
      if (input > 0 || output > 0) {
        tokens = { ...emptyTokens(), freshInput: input, output };
      } else if (textLen > 0) {
        if (hasExactBubble) continue;
        const estimated = estimateTokensFromChars(textLen);
        if (!estimated) continue;
        evidence = TOKEN_EVIDENCE.estimated;
        recordType = 'cursor-char-estimate';
        if (type === 1) tokens = { ...emptyTokens(), freshInput: estimated };
        else tokens = { ...emptyTokens(), output: estimated };
        if (meta?.tokens > 0 && type === 1) continue;
      } else {
        continue;
      }
      events.push({
        timestamp,
        tokens,
        evidence,
        recordType,
        charCount: textLen || null,
        messageId: row.key || null,
        model: row.model || meta?.model || null,
        sessionId: id
      });
    }
    if (!hasExactBubble && meta?.tokens > 0) {
      const timestamp = meta.createdAt || iso(rows.find((row) => row.created_at)?.created_at);
      if (!timestamp) continue;
      events.push({
        timestamp,
        tokens: { ...emptyTokens(), freshInput: meta.tokens },
        evidence: TOKEN_EVIDENCE.exact,
        recordType: 'cursor-composer-meter',
        charCount: null,
        messageId: `composerData:${id}`,
        model: meta.model || null,
        sessionId: id
      });
    }
  }
  return events;
}

export function scanCursorTokenDb(dbPath, { now = new Date(), lookbackDays = CURSOR_LOOKBACK_DAYS } = {}) {
  if (!dbPath || !fs.existsSync(dbPath)) {
    return { status: 'unavailable', reason: 'Local token telemetry unavailable', events: [], sessions: [], classification: CURSOR_TOKEN_CLASSIFICATION };
  }
  const floor = new Date(now);
  floor.setDate(floor.getDate() - lookbackDays);
  const floorIso = floor.toISOString();
  try {
    const composers = sqliteJson(dbPath, `
      SELECT
        substr(key, length('composerData:') + 1) AS composer_id,
        json_extract(value, '$.promptTokenBreakdown.totalUsedTokens') AS used,
        json_extract(value, '$.contextTokensUsed') AS ctx,
        json_extract(value, '$.createdAt') AS created_at,
        json_extract(value, '$.modelInfo.model') AS model
      FROM cursorDiskKV
      WHERE key >= 'composerData:' AND key < 'composerData;'
    `, { timeout: 25_000 });
    const recent = composers
      .map((row) => ({ ...row, createdIso: iso(row.created_at) }))
      .filter((row) => !row.createdIso || row.createdIso >= floorIso)
      .sort((a, b) => String(b.createdIso || '').localeCompare(String(a.createdIso || '')))
      .slice(0, 24);
    const bubbles = [];
    const started = Date.now();
    for (const row of recent) {
      if (Date.now() - started > 8_000) break;
      const id = String(row.composer_id || '').replace(/[^0-9a-f-]/gi, '');
      if (!id) continue;
      try {
        const rows = sqliteJson(dbPath, `
        SELECT
          key,
          json_extract(value, '$.createdAt') AS created_at,
          json_extract(value, '$.type') AS bubble_type,
          json_extract(value, '$.tokenCount.inputTokens') AS input_tokens,
          json_extract(value, '$.tokenCount.outputTokens') AS output_tokens,
          json_extract(value, '$.modelInfo.model') AS model,
          length(COALESCE(json_extract(value, '$.text'), '')) AS text_len
        FROM cursorDiskKV
        WHERE key >= 'bubbleId:${id}:' AND key < 'bubbleId:${id};'
      `, { timeout: 3_000 });
        for (const bubble of rows) bubbles.push({ ...bubble, composer_id: id });
      } catch {
        continue;
      }
    }
    const events = cursorEventsFromRows({ bubbles, composers });
    const bySession = new Map();
    for (const event of events) {
      const list = bySession.get(event.sessionId) || [];
      list.push(event);
      bySession.set(event.sessionId, list);
    }
    const sessions = [...bySession.entries()].map(([id, list]) => {
      const days = aggregateTokenDays(list);
      const tokens = tokensFromDays(days);
      const times = list.map((event) => event.timestamp).sort();
      const model = list.find((event) => event.model)?.model || null;
      return {
        composerId: id,
        model,
        tokens,
        tokenDays: days,
        tokenEventCount: list.length,
        usageStartedAt: times[0] || null,
        usageEndedAt: times.at(-1) || null,
        evidence: list.some((event) => event.evidence === TOKEN_EVIDENCE.estimated) && list.some((event) => event.evidence === TOKEN_EVIDENCE.exact)
          ? TOKEN_EVIDENCE.mixed
          : list.some((event) => event.evidence === TOKEN_EVIDENCE.estimated) ? TOKEN_EVIDENCE.estimated : TOKEN_EVIDENCE.exact
      };
    });
    const exactEvents = events.filter((event) => event.evidence === TOKEN_EVIDENCE.exact).length;
    const estimatedEvents = events.filter((event) => event.evidence === TOKEN_EVIDENCE.estimated).length;
    return {
      status: events.length ? (estimatedEvents && exactEvents ? 'mixed' : estimatedEvents ? 'estimated' : 'exact') : 'empty',
      reason: events.length
        ? (estimatedEvents ? 'Estimated local token telemetry' : 'Local token telemetry')
        : 'Local token telemetry unavailable',
      classification: CURSOR_TOKEN_CLASSIFICATION,
      provenance: CURSOR_PROVENANCE,
      events,
      sessions,
      exactEvents,
      estimatedEvents
    };
  } catch (error) {
    return {
      status: error.busy ? 'busy' : 'error',
      reason: error.busy ? 'Local Cursor database busy; token telemetry skipped this scan.' : 'Local token telemetry unavailable',
      detail: error.message,
      classification: CURSOR_TOKEN_CLASSIFICATION,
      events: [],
      sessions: []
    };
  }
}

function diagnosticsFromCursorSessions(sessions, fingerprint, source = 'scanned') {
  const levels = sessions.map((session) => session.tokenEvidence).filter(Boolean);
  const estimated = levels.some((level) => level === TOKEN_EVIDENCE.estimated || level === TOKEN_EVIDENCE.mixed);
  const exact = levels.some((level) => level === TOKEN_EVIDENCE.exact || level === TOKEN_EVIDENCE.mixed);
  const status = sessions.length
    ? (estimated && exact ? 'mixed' : estimated ? 'estimated' : exact ? 'exact' : 'empty')
    : 'empty';
  return {
    cursorTokenSource: source,
    cursorTokenStatus: status,
    cursorTokenReason: status === 'estimated'
      ? 'Estimated local token telemetry'
      : status === 'mixed'
        ? 'Local token telemetry includes estimates'
        : status === 'exact'
          ? 'Local token telemetry'
          : 'Local token telemetry unavailable',
    cursorTokenClassification: CURSOR_TOKEN_CLASSIFICATION,
    cursorTokenExactEvents: sessions.reduce((count, session) => count + (session.tokenEvidence === TOKEN_EVIDENCE.estimated ? 0 : session.tokenEventCount || 0), 0),
    cursorTokenEstimatedEvents: sessions.reduce((count, session) => count + ((session.tokenEvidence === TOKEN_EVIDENCE.estimated || session.tokenEvidence === TOKEN_EVIDENCE.mixed) ? session.tokenEventCount || 0 : 0), 0),
    cursorTokenFingerprint: fingerprint
  };
}

export function cursorTokenSessionsFromDb(homeDir = os.homedir(), previous = new Map(), now = new Date()) {
  const dbPath = cursorDbPath(homeDir);
  const stat = (() => { try { return fs.statSync(dbPath); } catch { return null; } })();
  const fingerprint = stat ? `${stat.size}:${Math.round(stat.mtimeMs)}` : null;
  const reuse = [...previous.values()].filter((session) => session.sourceFile?.startsWith('cursorDiskKV:') && session.sourceFingerprint === fingerprint);
  if (fingerprint && reuse.length) {
    return { sessions: reuse, diagnostics: diagnosticsFromCursorSessions(reuse, fingerprint, 'cached') };
  }
  const scanned = scanCursorTokenDb(dbPath, { now });
  const sessions = scanned.sessions.map((row) => ({
    id: `Cursor:${row.composerId}`,
    agent: 'Cursor',
    host: 'Cursor',
    provider: 'Unknown',
    providerConfidence: 'Unavailable',
    model: row.model,
    modelLabel: row.model,
    sourceFile: `cursorDiskKV:${row.composerId}`,
    sourceFingerprint: fingerprint,
    timestamp: row.usageEndedAt,
    tokens: row.tokens,
    tokenDays: row.tokenDays,
    tokenEventCount: row.tokenEventCount,
    usageStartedAt: row.usageStartedAt,
    usageEndedAt: row.usageEndedAt,
    recordedAt: new Date(now).toISOString(),
    tokenEvidence: row.evidence,
    tools: 0,
    compactions: 0,
    attributedSkills: [],
    attributionConfidence: 'Unknown'
  }));
  return {
    sessions,
    diagnostics: {
      ...diagnosticsFromCursorSessions(sessions, fingerprint, 'scanned'),
      cursorTokenStatus: scanned.status,
      cursorTokenReason: scanned.reason,
      cursorTokenClassification: scanned.classification,
      cursorTokenExactEvents: scanned.exactEvents || 0,
      cursorTokenEstimatedEvents: scanned.estimatedEvents || 0
    }
  };
}

export function addEvidenceTokens(target, source, evidence) {
  const next = { exact: addTokens(emptyTokens(), target?.exact), estimated: addTokens(emptyTokens(), target?.estimated) };
  if (evidence === TOKEN_EVIDENCE.estimated) next.estimated = addTokens(next.estimated, source);
  else next.exact = addTokens(next.exact, source);
  return next;
}