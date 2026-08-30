import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classifyAgentState } from '../public/agent-state.js';
import { ClaudeToolTracker, CursorTurnTracker, claudeToolLifecycleEvents, cursorTranscriptBootstrapEligible, cursorTranscriptHasAgentTurn, cursorTurnLifecycle } from '../src/live-work.js';
import { liveStatesFromEvents } from '../src/resume.js';

const tempJsonl = (rows = []) => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aidash-live-work-')), 'session.jsonl');
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''));
  return file;
};

test('Claude tool lifecycle retains only structural tool IDs and keeps a long-running tool Working', () => {
  const started = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'call-1', name: 'Bash', input: { command: 'private command body' } }], text: 'private assistant text' } };
  const completed = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'call-1', content: 'private output body' }] } };
  assert.deepEqual(claudeToolLifecycleEvents([started]), [{ type: 'started', id: 'call-1' }]);
  const file = tempJsonl([started]);
  const tracker = new ClaudeToolTracker({ maxAgeMs: 60_000 });
  tracker.observe(file, { previousSize: 0, at: 1_000 });
  const signal = tracker.signal(46_000);
  assert.equal(signal?.active, true);
  assert.equal(Object.hasOwn(signal, 'command'), false);
  assert.equal(classifyAgentState([], 'Claude', 46_000, { inProgress: signal }).state, 'Working');
  assert.equal(liveStatesFromEvents([], ['Claude'], 46_000, {}, { Claude: signal }).Claude.state, 'Working');
  const before = fs.statSync(file).size;
  fs.appendFileSync(file, `${JSON.stringify(completed)}\n`);
  tracker.observe(file, { previousSize: before, at: 47_000 });
  assert.equal(tracker.signal(47_001), null);
  assert.equal(classifyAgentState([], 'Claude', 47_001, { inProgress: tracker.signal(47_001) }).state, 'Idle');
});

test('Claude in-progress evidence expires conservatively instead of pinning an abandoned session Working', () => {
  const file = tempJsonl([{ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'call-1' }] } }]);
  const tracker = new ClaudeToolTracker({ maxAgeMs: 10_000 });
  tracker.observe(file, { previousSize: 0, at: 1_000 });
  assert.equal(tracker.signal(10_999)?.active, true);
  assert.equal(tracker.signal(11_001), null);
});

test('Cursor transcript startup markers are not agent work while real user/assistant turns are', () => {
  assert.equal(cursorTranscriptHasAgentTurn([{ type: 'turn_ended', status: 'success' }]), false);
  assert.equal(cursorTranscriptHasAgentTurn([{ type: 'user', text: 'private prompt' }]), true);
  assert.equal(cursorTranscriptHasAgentTurn([{ type: 'assistant', text: 'private response' }]), true);
  assert.equal(cursorTranscriptHasAgentTurn([{ type: 'message', message: { role: 'assistant', content: 'private' } }]), true);
  assert.deepEqual(cursorTurnLifecycle([{ type: 'turn_started' }, { type: 'turn_ended', status: 'success' }]), [{ type: 'started' }, { type: 'completed' }]);
});

test('Cursor structured turn stays Working through sparse planning and clears on completion', () => {
  const tracker = new CursorTurnTracker({ maxAgeMs: 60_000 });
  assert.equal(tracker.observe('/tmp/cursor.jsonl', [{ type: 'turn_started' }], 1_000).started, true);
  assert.equal(tracker.signal(30_000)?.active, true);
  assert.equal(tracker.observe('/tmp/cursor.jsonl', [{ type: 'turn_ended', status: 'success' }], 31_000).completed, true);
  assert.equal(tracker.signal(31_001), null);
});

test('Cursor current transcript bootstrap restores a running built-in AI turn but old history stays Idle', () => {
  const now = 1_000_000;
  assert.equal(cursorTranscriptBootstrapEligible(now - 5_000, now), true);
  assert.equal(cursorTranscriptBootstrapEligible(now - 300_001, now), false);
  const tracker = new CursorTurnTracker({ maxAgeMs: 60_000 });
  // These are structural roles only: no message body is retained by the tracker.
  tracker.observe('/tmp/current-cursor.jsonl', [{ message: { role: 'user', content: 'private prompt' } }], now);
  assert.equal(tracker.signal(now + 5_000)?.active, true);
  tracker.observe('/tmp/current-cursor.jsonl', [{ type: 'turn_ended', status: 'success' }], now + 8_000);
  assert.equal(tracker.signal(now + 8_001), null);
  const old = new CursorTurnTracker({ maxAgeMs: 60_000 });
  // The caller uses bootstrap eligibility before this observation; an old
  // transcript cannot be allowed to start a fresh Working lease on restart.
  assert.equal(cursorTranscriptBootstrapEligible(now - 60_001, now, 60_000), false);
  assert.equal(old.signal(now), null);
});
