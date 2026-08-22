import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { extractUsageEvent, dedupeUsageEvents, aggregateTokenDays, normalizeUsage } from '../src/usage-events.js';
import { buildTokenCalendar, localDateKey, periodBounds, tokenReports } from '../src/tokens.js';
import { liveFeedSignalState, liveLanes, tokenModule } from '../public/live-ui.js';
import { brandOf as brand } from '../public/brands.js';
import { readPlanCapacity } from '../src/capacity.js';
import { cursorTokenAvailability } from '../src/cursor-usage.js';

const tokens = (freshInput=0, output=0, cacheRead=0, cacheCreation=0) => ({ freshInput, output, cacheRead, cacheCreation, reasoning: 0, other: 0 });
const day = (date, t, firstAt, lastAt=firstAt, eventCount=1) => ({ date, tokens: t, eventCount, firstAt, lastAt });

test('token calendar uses usage-event days, not session end or file mtime', () => {
  const now = new Date(2026, 7, 15, 21, 0, 0);
  const today = localDateKey(now);
  const yesterday = localDateKey(new Date(2026, 7, 14, 12, 0, 0));
  const sessions = [{
    id: 'Claude:span',
    agent: 'Claude',
    host: 'Claude Code',
    provider: 'Anthropic',
    model: 'claude-sonnet-5',
    timestamp: now.toISOString(),
    recordedAt: now.toISOString(),
    tokens: tokens(13, 5, 400, 20),
    tokenDays: {
      [yesterday]: day(yesterday, tokens(10, 4, 300, 10), new Date(2026, 7, 14, 11, 0, 0).toISOString()),
      [today]: day(today, tokens(3, 1, 100, 10), new Date(2026, 7, 15, 8, 0, 0).toISOString())
    }
  }];
  const { reports } = tokenReports(sessions, now, { knownAgents: ['Cursor'], unavailableAgents: { Cursor: cursorTokenAvailability().reason } });
  assert.equal(reports.today.tokens.freshInput, 3);
  assert.equal(reports.today.tokens.cacheRead, 100);
  assert.equal(reports.yesterday.tokens.freshInput, 10);
  assert.equal(reports.today.eventCount, 1);
  assert.equal(reports.today.byAgent.find((row) => row.agent === 'Claude').observedActivity, 114);
  assert.equal(reports.today.byAgent.find((row) => row.agent === 'Codex'), undefined);
  const cursor = reports.today.byAgent.find((row) => row.agent === 'Cursor');
  assert.equal(cursor.available, false);
  assert.match(cursor.reason, /Local token telemetry unavailable/);
  assert.equal(reports.today.freshPlusOutput, 4);
  assert.equal(reports.all.freshPlusOutput, 18);
  assert.equal(reports.today.label, 'Today');
  assert.equal(reports.all.label, 'Since tracking began');
});

test('backfill recorded today does not move historical usage into today', () => {
  const now = new Date(2026, 7, 15, 18, 0, 0);
  const yesterday = localDateKey(new Date(2026, 7, 14, 18, 0, 0));
  const sessions = [{
    id: 'Claude:old',
    agent: 'Kimi',
    host: 'Claude Code',
    provider: 'Moonshot',
    model: 'kimi-k3',
    timestamp: now.toISOString(),
    recordedAt: now.toISOString(),
    tokens: tokens(8, 2, 50, 1),
    tokenDays: { [yesterday]: day(yesterday, tokens(8, 2, 50, 1), new Date(2026, 7, 14, 9, 0, 0).toISOString()) }
  }];
  const { reports } = tokenReports(sessions, now);
  assert.equal(reports.today.observedActivity, 0);
  assert.equal(reports.yesterday.tokens.freshInput, 8);
  assert.equal(reports.today.explain.contributors.length, 0);
});

test('local midnight boundary splits adjacent usage events', () => {
  const now = new Date(2026, 7, 15, 0, 30, 0);
  const before = new Date(2026, 7, 14, 23, 59, 0);
  const after = new Date(2026, 7, 15, 0, 1, 0);
  assert.equal(localDateKey(before), localDateKey(new Date(2026, 7, 14, 12, 0, 0)));
  assert.equal(localDateKey(after), localDateKey(now));
  assert.notEqual(localDateKey(before), localDateKey(after));
  const sessions = [{
    id: 'Claude:midnight',
    agent: 'Claude',
    host: 'Claude Code',
    provider: 'Anthropic',
    tokenDays: {
      [localDateKey(before)]: day(localDateKey(before), tokens(5, 1, 0, 0), before.toISOString()),
      [localDateKey(after)]: day(localDateKey(after), tokens(7, 2, 0, 0), after.toISOString())
    }
  }];
  const { reports } = tokenReports(sessions, now);
  assert.equal(reports.today.tokens.freshInput, 7);
  assert.equal(reports.yesterday.tokens.freshInput, 5);
});

test('sessions without tokenDays are not attributed by session timestamp', () => {
  const now = new Date(2026, 7, 15, 12, 0, 0);
  const calendar = buildTokenCalendar([{
    id: 'Claude:mtime',
    agent: 'Claude',
    timestamp: now.toISOString(),
    tokens: tokens(100, 20, 999, 1)
  }], now);
  assert.equal(Object.keys(calendar.days).length, 0);
  assert.equal(calendar.unallocated.length, 1);
});

test('Claude streaming duplicates collapse to one usage event', () => {
  const ts = '2026-08-15T01:00:00.000Z';
  const row = (uuid) => ({ type: 'assistant', timestamp: ts, uuid, message: { id: 'msg_1', usage: { input_tokens: 2, output_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 5 } } });
  const events = dedupeUsageEvents([extractUsageEvent(row('a')), extractUsageEvent(row('b'))]);
  assert.equal(events.length, 1);
  const days = aggregateTokenDays(events);
  const key = Object.keys(days)[0];
  assert.equal(days[key].eventCount, 1);
  assert.equal(days[key].tokens.output, 10);
});

test('Codex last_token_usage is dated and total_token_usage is ignored', () => {
  const event = extractUsageEvent({
    timestamp: '2026-08-14T10:00:00.000Z',
    payload: {
      info: {
        last_token_usage: { input_tokens: 20, output_tokens: 5, cached_input_tokens: 8, cache_write_input_tokens: 1, reasoning_output_tokens: 2 },
        total_token_usage: { input_tokens: 9999, output_tokens: 9999, cached_input_tokens: 9999 }
      }
    }
  });
  assert.equal(event.recordType, 'codex-last-token-usage');
  assert.equal(event.tokens.freshInput, 20);
  assert.equal(event.tokens.cacheRead, 8);
  assert.equal(event.tokens.cacheCreation, 1);
  assert.equal(event.tokens.reasoning, 2);
  assert.equal(normalizeUsage({ payload: { info: { last_token_usage: { input_tokens: 3, output_tokens: 1 } } } }).freshInput, 3);
});

test('selected range labels stay consistent in the token module', () => {
  const html = tokenModule({
    label: 'Today',
    observedActivity: 114,
    freshPlusOutput: 4,
    tokens: tokens(3, 1, 100, 10),
    byAgent: [{ agent: 'Claude', available: true, observedActivity: 114, share: 1 }, { agent: 'Cursor', available: false, reason: 'Local token telemetry unavailable' }],
    explain: { range: { label: 'Today', timezone: 'Asia/Bangkok' }, timestampDefinition: 'usage-record timestamp', observedActivity: 114, freshPlusOutput: 4, tokens: tokens(3, 1, 100, 10), eventCount: 1, sessionCount: 1, byAgent: [], byProvider: [], byModel: [], contributors: [], unavailable: [{ agent: 'Cursor', reason: 'Local token telemetry unavailable' }] }
  }, { selected: 'today', expanded: true, explainOpen: true });
  assert.match(html, /Fresh \+ Output · Today/);
  assert.match(html, /Local token telemetry unavailable/);
  assert.match(html, /Explain this number/);
  assert.match(html, /Why this number/);
  assert.doesNotMatch(html, />Unavailable</);
});

test('dynamic lanes use declared runtimes, preserve host/model separation, and support five sources', () => {
  const runtimes = ['Claude', 'Codex', 'Cursor', 'OpenCode', 'Gemini CLI'].map((agent, index) => ({ id: `fixture-${index}`, agent, host: agent === 'Claude' ? 'Claude Code' : agent, liveCapable: true }));
  const lanes = liveLanes([{ agent: 'Claude', timestamp: new Date().toISOString() }], [{ adapterId: 'fixture-0', agent: 'Kimi', host: 'Claude Code', model: 'kimi-k3', modelLabel: 'Kimi k3', provider: 'Moonshot', timestamp: new Date().toISOString() }], { runtimes });
  const claude = lanes.find((lane) => lane.agent === 'Claude');
  assert.equal(lanes.length, 5);
  assert.equal(claude.host, 'Claude Code');
  assert.equal(claude.model, 'kimi-k3');
  assert.equal(claude.eventAgent, 'Claude');
  assert.equal(lanes.some((lane) => lane.agent === 'Kimi'), false);
  assert.equal(liveLanes([], [], { runtimes: [] }).length, 0);
  assert.equal(brand('Kimi').fallback, true);
  assert.equal(brand('Kimi').letter, 'K');
  assert.equal(brand('Claude').file, 'claude.png');
});

test('live feed signal uses working, recent, then idle', () => {
  assert.equal(liveFeedSignalState({ Claude: { state: 'Working' }, Codex: { state: 'Idle' } }).mode, 'working');
  assert.equal(liveFeedSignalState({ Claude: { state: 'Recently Active' }, Codex: { state: 'Idle' } }).mode, 'recent');
  assert.equal(liveFeedSignalState({ Claude: { state: 'Idle' }, Codex: { state: 'Idle' } }).mode, 'idle');
  assert.equal(liveFeedSignalState({ Cursor: { state: 'Closed' }, Claude: { state: 'Presence Unknown' } }).mode, 'idle');
});

test('plan capacity stays on account sources, not model lanes', () => {
  const value = readPlanCapacity();
  assert.deepEqual(value.providers.map((row) => row.provider), ['Claude', 'Codex', 'Cursor']);
  assert.match(value.privacy, /not a per-model card/);
});

test('plan capacity renders registered sources rather than a fixed card set', () => {
  const value = readPlanCapacity(process.cwd(), {
    now: () => new Date('2026-08-22T00:00:00.000Z'),
    sources: [{ id: 'Fixture account', collect: () => ({ provider: 'Fixture account', status: 'Available', windows: [{ id: 'shared', label: 'Shared', remainingPercent: 55, resetAt: null }], observedAt: '2026-08-22T00:00:00.000Z' }) }]
  });
  assert.deepEqual(value.providers.map((item) => item.provider), ['Fixture account']);
  assert.equal(value.providers[0].windows[0].remainingPercent, 55);
});

test('Munder-specific public docs are gone', () => {
  const root = process.cwd();
  assert.equal(fs.existsSync(path.join(root, 'docs/MUNDER-DIFFLIN-COMPARISON.md')), false);
  const files = [path.join(root, 'README.md'), ...fs.readdirSync(path.join(root, 'docs')).filter((name) => name.endsWith('.md')).map((name) => path.join(root, 'docs', name))];
  for (const file of files) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /Munder Difflin/i, file);
  }
  assert.ok(fs.existsSync(path.join(root, 'docs/assets/ai-development-dashboard-live-activity.png')));
  assert.match(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), /docs\/assets\/ai-development-dashboard-live-activity\.png/);
});
