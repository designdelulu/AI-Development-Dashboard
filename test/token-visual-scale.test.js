import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTokenVisualScale, TOKEN_VISUAL_BOOTSTRAP_FLOOR } from '../src/token-visual-scale.js';
import { derive, SCHEMA_VERSION } from '../src/core.js';
import { tokenBarRows, tokenModule } from '../public/live-ui.js';

const tokens = (freshInput = 0, output = 0, cacheRead = 0, cacheCreation = 0) => ({ freshInput, output, cacheRead, cacheCreation, reasoning: 0, other: 0 });
const calendar = (values = {}) => ({ days: Object.fromEntries(Object.entries(values).map(([date, value]) => [date, { date, tokens: tokens(value, 0), evidence: 'exact' }])) });
const localNoon = (date) => new Date(`${date}T12:00:00`);

test('token visual scale starts from a deterministic floor and never lets cache dominate intensity', () => {
  const now = localNoon('2026-08-31');
  const empty = buildTokenVisualScale(calendar(), null, now);
  assert.equal(empty.current.value, 0);
  assert.equal(empty.recent.visualCeiling, TOKEN_VISUAL_BOOTSTRAP_FLOOR);
  const current = buildTokenVisualScale({ days: { '2026-08-31': { date: '2026-08-31', tokens: tokens(10_000, 5_000, 9_000_000), evidence: 'exact' } } }, null, now);
  assert.equal(current.current.value, 15_000);
  assert.equal(current.current.evidence, 'exact');
  assert.equal(current.recent.learned, false);
});

test('token visual scale learns a recent P95 from completed comparable local days', () => {
  const values = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`2026-08-${String(index + 1).padStart(2, '0')}`, (index + 1) * 200_000]));
  const scale = buildTokenVisualScale(calendar(values), null, localNoon('2026-08-20'));
  assert.equal(scale.bucket.label, '1 local calendar day');
  assert.equal(scale.recent.sampleCount, 10);
  assert.equal(scale.recent.p95, 2_000_000);
  assert.equal(scale.recent.learned, true);
  assert.equal(scale.recent.visualCeiling, 2_500_000);
  assert.equal(scale.lifetimeHigh.value, 2_000_000);
});

test('an old extreme lifetime high does not flatten the recent visual range', () => {
  const values = { '2026-07-01': 9_000_000 };
  for (let index = 1; index <= 30; index++) values[`2026-08-${String(index).padStart(2, '0')}`] = 100_000;
  const scale = buildTokenVisualScale(calendar(values), null, localNoon('2026-09-01'));
  assert.equal(scale.lifetimeHigh.value, 9_000_000);
  assert.equal(scale.recent.p95, 100_000);
  assert.equal(scale.recent.visualCeiling, 125_000);
});

test('a new lifetime high is recorded only after the active bucket closes, not from backfill', () => {
  const first = buildTokenVisualScale(calendar({ '2026-08-29': 100_000, '2026-08-30': 300_000 }), null, localNoon('2026-08-30'));
  assert.equal(first.record, null);
  const closed = buildTokenVisualScale(calendar({ '2026-08-29': 100_000, '2026-08-30': 300_000 }), first, localNoon('2026-08-31'));
  assert.equal(closed.record.value, 300_000);
  assert.equal(closed.record.previousHigh, 100_000);
  assert.equal(closed.lifetimeHigh.value, 300_000);
  const backfill = buildTokenVisualScale(calendar({ '2026-08-01': 300_000 }), null, localNoon('2026-08-31'));
  assert.equal(backfill.record, null);
});

test('invalid input is ignored for scale learning and persisted high survives missing historical buckets', () => {
  const invalid = { days: {
    '2026-08-01': { date: '2026-08-01', tokens: tokens(Number.POSITIVE_INFINITY), evidence: 'exact' },
    '2026-08-02': { date: '2026-08-02', tokens: tokens(50_000), evidence: 'mixed' }
  } };
  const scale = buildTokenVisualScale(invalid, null, localNoon('2026-08-03'));
  assert.equal(scale.recent.sampleCount, 1);
  assert.equal(scale.lifetimeHigh.value, 50_000);
  const restarted = buildTokenVisualScale(calendar(), { lifetimeHigh: { value: 800_000, date: '2026-08-02', evidence: 'mixed' } }, localNoon('2026-08-04'));
  assert.equal(restarted.lifetimeHigh.value, 800_000);
  assert.equal(restarted.current.evidence, 'unavailable');
});

test('schema migration adds a recomputable visual scale without changing legacy token records', () => {
  const legacy = derive({ schemaVersion: 12, projects: [], capabilities: [], capabilityUsageEvents: [], errors: [], sources: {}, sessions: [] });
  assert.equal(legacy.schemaVersion, SCHEMA_VERSION);
  assert.equal(legacy.tokenVisualScale.version, 1);
  assert.equal(legacy.tokenVisualScale.current.evidence, 'unavailable');
  assert.deepEqual(legacy.sessions, []);
});

test('unchanged normalized data retains derived scale state until a bucket closes or data changes', () => {
  const initial = buildTokenVisualScale(calendar({ '2026-08-01': 50_000, '2026-08-02': 60_000 }), null, localNoon('2026-08-03'));
  const retained = buildTokenVisualScale(calendar({ '2026-08-01': 50_000, '2026-08-02': 60_000 }), initial, localNoon('2026-08-03'));
  assert.equal(retained, initial);
  const updated = buildTokenVisualScale(calendar({ '2026-08-01': 50_000, '2026-08-02': 70_000 }), initial, localNoon('2026-08-03'));
  assert.notEqual(updated, initial);
});

test('token contributor bars use the displayed selected-range observed-token share, never adaptive intensity', () => {
  const html = tokenBarRows([
    { agent: 'Codex', available: true, freshPlusOutput: 10_000, observedActivity: 66, evidence: 'exact', share: 0.66 },
    { agent: 'Claude', available: true, freshPlusOutput: 40_000, observedActivity: 34, evidence: 'mixed', share: 0.34 },
    { agent: 'Tiny source', available: true, freshPlusOutput: 999_999, observedActivity: .3, evidence: 'exact', share: .003 },
    { agent: 'Cursor', available: false, reason: 'Unavailable' }
  ], { visualCeiling: 100_000 });
  assert.match(html, /width:66%/);
  assert.match(html, /width:34%/);
  assert.match(html, /width:0\.3%/);
  assert.match(html, /66%/);
  assert.match(html, /34%/);
  assert.match(html, /&lt;1%/);
  assert.match(html, /Selected-range observed token activity share/);
  assert.match(html, /Estimated/);
});

test('large token totals switch to readable billions without changing values or share geometry', () => {
  const html = tokenBarRows([{ agent: 'Codex', available: true, observedActivity: 7_717_900_000, share: .66 }]);
  assert.match(html, /7\.72B · 66%/);
  assert.match(html, /width:66%/);
});

test('token contributor share geometry remains proportional for balanced, dominant, and dynamic sources', () => {
  for (const [left, right] of [[.5, .5], [.9, .1], [.01, .99]]) {
    const html = tokenBarRows([
      { agent: 'First', available: true, observedActivity: left * 100, share: left },
      { agent: 'Second', available: true, observedActivity: right * 100, share: right },
      { agent: 'Fourth dynamic runtime', available: true, observedActivity: 0, share: 0 }
    ]);
    assert.match(html, new RegExp(`width:${left * 100}%`));
    assert.match(html, new RegExp(`width:${right * 100}%`));
  }
});

test('token module renders quiet through record states as one adaptive intensity surface', () => {
  const report = { label: 'Today', observedActivity: 9_010_000, freshPlusOutput: 40_000, evidence: 'mixed', tokens: tokens(30_000, 10_000, 9_000_000), byAgent: [{ agent: 'Synthetic', available: true, freshPlusOutput: 40_000, observedActivity: 9_010_000, evidence: 'mixed', share: 1 }] };
  const visualScale = { bucket: { label: '1 local calendar day' }, current: { value: 40_000, evidence: 'mixed', ratio: 0.4 }, recent: { p95: 80_000, visualCeiling: 100_000 }, lifetimeHigh: { value: 150_000, evidence: 'exact' }, record: { value: 150_000, evidence: 'exact', previousCeiling: 100_000 } };
  const html = tokenModule(report, { selected: 'today', visualScale });
  assert.match(html, /ACTIVITY INTENSITY · FRESH \+ OUTPUT/);
  assert.match(html, /Recent heavy range 80K \/ day/);
  assert.match(html, /New activity high/);
  assert.match(html, /width:40%/);
  assert.match(html, /width:100%/);
});

test('synthetic quiet, normal, heavy, and near-ceiling states retain distinct rendered widths', () => {
  const report = { label: 'Today', observedActivity: 1, freshPlusOutput: 1, tokens: tokens(1), byAgent: [] };
  for (const [ratio, width] of [[0.1, '10%'], [0.4, '40%'], [0.8, '80%'], [0.95, '95%']]) {
    const html = tokenModule(report, { selected: 'today', visualScale: { bucket: { label: '1 local calendar day' }, current: { value: ratio * 100_000, ratio, evidence: 'exact' }, recent: { p95: 80_000, visualCeiling: 100_000 }, lifetimeHigh: { value: 120_000, evidence: 'exact' } } });
    assert.match(html, new RegExp(`token-intensity-track[\\s\\S]*?width:${width}`));
  }
});
