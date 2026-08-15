import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { remainingFromUsed, claudeCapacityFromState, ensureClaudeCapacityCapture, statuslineCommand, readClaudeSettings } from '../src/claude-capacity.js';
import { cursorEventsFromRows, estimateTokensFromChars, scanCursorTokenDb, cursorTokenSessionsFromDb, cursorDbPath, CURSOR_CHARS_PER_TOKEN } from '../src/cursor-tokens.js';
import { tokenReports, localDateKey } from '../src/tokens.js';
import { tokenModule } from '../public/live-ui.js';
import { createSnapshot, shareCardSvg } from '../src/sharing.js';
import { cursorTokenAvailability } from '../src/cursor-usage.js';
import { discoverNativeAutomations, groupCapabilities } from '../src/core.js';
import { TELEMETRY_CONTRACT } from '../src/telemetry-contract.js';
import { formatObservedTokens } from '../src/token-evidence.js';

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), name));
const tokens = (freshInput=0, output=0) => ({ freshInput, output, cacheRead: 0, cacheCreation: 0, reasoning: 0, other: 0 });

test('Claude used percentage converts to remaining and never shows 0 for missing limits', () => {
  assert.equal(remainingFromUsed(26), 74);
  assert.equal(remainingFromUsed(57), 43);
  const missing = claudeCapacityFromState(null, { version: '2.1.198' });
  assert.equal(missing.status, 'Waiting');
  assert.equal(missing.windows.length, 0);
  const unsupported = claudeCapacityFromState(null, { version: '2.0.0' });
  assert.equal(unsupported.status, 'Unsupported');
  const active = claudeCapacityFromState({
    availability: 'active',
    capturedAt: '2026-08-16T01:00:00.000Z',
    fiveHour: { usedPercentage: 26, remainingPercentage: 74, resetsAt: '2026-08-16T06:00:00.000Z' },
    sevenDay: { usedPercentage: 57, remainingPercentage: 43, resetsAt: '2026-08-20T00:00:00.000Z' }
  });
  assert.equal(active.status, 'Available');
  assert.equal(active.windows[0].remainingPercent, 74);
  assert.equal(active.windows[1].remainingPercent, 43);
});

test('existing statusline command is preserved by chaining capture', () => {
  const home = tmp('statusline-');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({
    hooks: { Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'keep-me' }] }] },
    statusLine: { type: 'command', command: 'jq -r .model.display_name' }
  }));
  const result = ensureClaudeCapacityCapture(home);
  const settings = readClaudeSettings(home);
  assert.equal(result.preserved, true);
  assert.match(statuslineCommand(settings), /claude-capacity-capture/);
  assert.match(statuslineCommand(settings), /jq -r \.model\.display_name/);
  assert.match(JSON.stringify(settings.hooks), /keep-me/);
  const again = ensureClaudeCapacityCapture(home);
  assert.equal(again.changed, false);
});

test('Cursor exact bubble tokens beat estimates, and known zero-with-text is estimated', () => {
  const exact = cursorEventsFromRows({
    bubbles: [{ key: 'bubbleId:a:1', composer_id: 'a', created_at: '2026-08-16T03:00:00.000Z', input_tokens: 40, output_tokens: 12, text_len: 9999, bubble_type: 2 }],
    composers: []
  });
  assert.equal(exact.length, 1);
  assert.equal(exact[0].evidence, 'exact');
  assert.equal(exact[0].tokens.freshInput, 40);
  const estimated = cursorEventsFromRows({
    bubbles: [{ key: 'bubbleId:b:1', composer_id: 'b', created_at: '2026-08-16T03:00:00.000Z', input_tokens: 0, output_tokens: 0, text_len: 40, bubble_type: 2 }],
    composers: []
  });
  assert.equal(estimated[0].evidence, 'estimated');
  assert.equal(estimated[0].tokens.output, estimateTokensFromChars(40));
  assert.equal(CURSOR_CHARS_PER_TOKEN, 4);
  const genuineZero = cursorEventsFromRows({
    bubbles: [{ key: 'bubbleId:c:1', composer_id: 'c', created_at: '2026-08-16T03:00:00.000Z', input_tokens: 0, output_tokens: 0, text_len: 0, bubble_type: 2 }],
    composers: []
  });
  assert.equal(genuineZero.length, 0);
});

test('read-only Cursor database missing or busy degrades without a fake zero', () => {
  const missing = scanCursorTokenDb(path.join(os.tmpdir(), 'no-cursor-db-xyz.vscdb'));
  assert.equal(missing.status, 'unavailable');
  assert.equal(cursorTokenAvailability(missing).available, false);
  assert.match(cursorTokenAvailability(missing).reason, /Local token telemetry unavailable/);
  const dir = tmp('cursor-db-');
  const db = path.join(dir, 'state.vscdb');
  spawnSync('sqlite3', [db, 'CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT); INSERT INTO cursorDiskKV VALUES (\'composerData:aaaa-bbbb-cccc-dddd-eeeeeeeeeeee\', \'{"createdAt":"2026-08-16T01:00:00.000Z","promptTokenBreakdown":{"totalUsedTokens":800},"contextTokensUsed":800}\');'], { encoding: 'utf8' });
  const scanned = scanCursorTokenDb(db, { now: new Date('2026-08-16T12:00:00+07:00') });
  assert.equal(scanned.status, 'exact');
  assert.equal(scanned.sessions[0].tokens.freshInput, 800);
});

test('mixed exact and estimated aggregates stay labelled mixed', () => {
  const now = new Date(2026, 7, 16, 12, 0, 0);
  const today = localDateKey(now);
  const sessions = [
    { id: 'Claude:a', agent: 'Claude', tokenDays: { [today]: { date: today, tokens: tokens(100, 20), exactTokens: tokens(100, 20), estimatedTokens: tokens(), evidenceCounts: { exact: 1, estimated: 0 }, eventCount: 1, firstAt: now.toISOString(), lastAt: now.toISOString() } } },
    { id: 'Cursor:b', agent: 'Cursor', tokenEvidence: 'estimated', tokenDays: { [today]: { date: today, tokens: tokens(0, 40), exactTokens: tokens(), estimatedTokens: tokens(0, 40), evidence: 'estimated', evidenceCounts: { exact: 0, estimated: 1 }, eventCount: 1, firstAt: now.toISOString(), lastAt: now.toISOString() } } }
  ];
  const { reports } = tokenReports(sessions, now, { knownAgents: ['Cursor'] });
  assert.equal(reports.today.evidence, 'mixed');
  assert.equal(reports.today.exactObservedActivity, 120);
  assert.equal(reports.today.estimatedObservedActivity, 40);
  const cursor = reports.today.byAgent.find((row) => row.agent === 'Cursor');
  assert.equal(cursor.available, true);
  assert.equal(cursor.evidence, 'estimated');
  const html = tokenModule(reports.today, { selected: 'today', expanded: true, explainOpen: true });
  assert.match(html, /Estimated/);
  assert.match(html, /~40/);
});

test('estimated Share Stats values are rounded, not false-precision integers', () => {
  const dir = tmp('share-');
  const index = {
    summary: { agents: ['Cursor'] },
    sessions: [{ agent: 'Cursor', timestamp: new Date().toISOString(), tokens: { freshInput: 6812443, output: 1, cacheRead: 0, cacheCreation: 0 } }],
    tokenReports: { month: { evidence: 'estimated', tokens: { freshInput: 6812443, output: 1, cacheRead: 0, cacheCreation: 0 } } },
    efficiency: { components: {} },
    capabilities: [],
    capabilityUsageEvents: []
  };
  const snap = createSnapshot(index, ['freshInput'], '1:1', dir, 'month', {}, { persist: false });
  assert.equal(snap.metrics[0].evidence, 'estimated');
  assert.match(shareCardSvg(snap), /~6\.8M|~6\.8\s*M|~6\.8/);
  assert.doesNotMatch(shareCardSvg(snap), />6,812,443</);
});

test('DST-capable timezone midnight uses event time, not file mtime', () => {
  assert.equal(localDateKey(new Date('2026-03-08T04:59:00.000Z'), 'America/New_York'), '2026-03-07');
  assert.equal(localDateKey(new Date('2026-03-08T05:00:00.000Z'), 'America/New_York'), '2026-03-08');
  assert.equal(localDateKey(new Date('2026-11-01T03:59:00.000Z'), 'America/New_York'), '2026-10-31');
  assert.equal(localDateKey(new Date('2026-11-01T04:00:00.000Z'), 'America/New_York'), '2026-11-01');
});

test('Claude Plan Capacity integration stays separate from Auto-Compact', () => {
  const home = tmp('caps-');
  fs.mkdirSync(path.join(home, '.claude', 'ai-dashboard'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({
    autoCompactEnabled: true,
    autoCompactWindow: 300000,
    statusLine: { type: 'command', command: 'node "/tmp/claude-capacity-capture.mjs"' }
  }));
  const raw = discoverNativeAutomations(home);
  assert.equal(raw.some((item) => item.name === 'Claude Auto-Compact' && item.type === 'Automation'), true);
  assert.equal(raw.some((item) => item.name === 'Claude Plan Capacity' && item.type === 'Integration'), true);
  const grouped = groupCapabilities(raw, []);
  assert.equal(grouped.find((item) => item.name === 'Claude Plan Capacity').type, 'Integrations');
});

test('cached Cursor sessions keep exact/estimated status diagnostics', () => {
  const home = tmp('cursor-home-');
  const db = cursorDbPath(home);
  fs.mkdirSync(path.dirname(db), { recursive: true });
  spawnSync('sqlite3', [db, 'CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT); INSERT INTO cursorDiskKV VALUES (\'composerData:aaaa-bbbb-cccc-dddd-eeeeeeeeeeee\', \'{"createdAt":"2026-08-16T01:00:00.000Z","promptTokenBreakdown":{"totalUsedTokens":800},"contextTokensUsed":800}\');'], { encoding: 'utf8' });
  const now = new Date('2026-08-16T12:00:00+07:00');
  const first = cursorTokenSessionsFromDb(home, new Map(), now);
  assert.equal(first.diagnostics.cursorTokenStatus, 'exact');
  const prior = new Map(first.sessions.map((session) => [session.sourceFile, session]));
  const second = cursorTokenSessionsFromDb(home, prior, now);
  assert.equal(second.diagnostics.cursorTokenSource, 'cached');
  assert.equal(second.diagnostics.cursorTokenStatus, 'exact');
  assert.equal(second.sessions.length, 1);
});

test('stale Cursor unavailable flag does not hide dated token days', () => {
  const now = new Date(2026, 7, 16, 12, 0, 0);
  const today = localDateKey(now);
  const sessions = [{
    id: 'Cursor:keep',
    agent: 'Cursor',
    tokenEvidence: 'exact',
    tokenDays: { [today]: { date: today, tokens: tokens(50, 0), exactTokens: tokens(50, 0), estimatedTokens: tokens(), evidenceCounts: { exact: 1, estimated: 0 }, eventCount: 1, firstAt: now.toISOString(), lastAt: now.toISOString() } }
  }];
  const { reports } = tokenReports(sessions, now, {
    knownAgents: ['Cursor'],
    unavailableAgents: { Cursor: 'Local token telemetry unavailable' }
  });
  const cursor = reports.today.byAgent.find((row) => row.agent === 'Cursor');
  assert.equal(cursor.available, true);
  assert.equal(cursor.observedActivity, 50);
});

test('future adapter contract names evidence without implementing extra providers', () => {
  assert.ok(TELEMETRY_CONTRACT.fields.includes('tokenEvidence'));
  assert.ok(TELEMETRY_CONTRACT.tokenEvidence.includes('exact'));
  assert.equal(formatObservedTokens(6812443, { estimated: true }), '~6.8M');
});
