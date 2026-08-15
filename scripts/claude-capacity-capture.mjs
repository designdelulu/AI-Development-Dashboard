#!/usr/bin/env node
// Claude Code statusline helper. Reads the official statusline JSON on stdin,
// writes only rate-limit metadata, then prints a compact status line or
// forwards stdin to an existing statusline command.
// Does not persist prompts, transcripts, credentials, or unrelated fields.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const STATE_FILE = path.join(os.homedir(), '.claude', 'usage_state.json');
const CAPTURE_MARKER = 'claude-capacity-capture';

function remaining(used) {
  const value = Number(used);
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, 100 - value));
}

function windowFrom(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const used = Number(raw.used_percentage);
  if (!Number.isFinite(used)) return null;
  const reset = Number(raw.resets_at);
  return {
    usedPercentage: Math.max(0, Math.min(100, used)),
    remainingPercentage: remaining(used),
    resetsAt: Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000).toISOString() : null,
    resetsAtEpoch: Number.isFinite(reset) && reset > 0 ? reset : null
  };
}

function parsePayload(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function writeState(next) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const temp = `${STATE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`);
  fs.renameSync(temp, STATE_FILE);
}

function capture(payload) {
  const previous = readState();
  const capturedAt = new Date().toISOString();
  const model = typeof payload?.model?.display_name === 'string' ? payload.model.display_name : null;
  const fiveHour = windowFrom(payload?.rate_limits?.five_hour);
  const sevenDay = windowFrom(payload?.rate_limits?.seven_day);
  if (fiveHour || sevenDay) {
    writeState({
      schemaVersion: 1,
      source: 'claude-code-statusline',
      capturedAt,
      model,
      availability: 'active',
      fiveHour: fiveHour || previous?.fiveHour || null,
      sevenDay: sevenDay || previous?.sevenDay || null
    });
    return { fiveHour: fiveHour || previous?.fiveHour, sevenDay: sevenDay || previous?.sevenDay, model, availability: 'active' };
  }
  if (previous?.availability === 'active' && (previous.fiveHour || previous.sevenDay)) {
    writeState({ ...previous, lastSeenAt: capturedAt, model: model || previous.model });
    return { ...previous, model: model || previous.model, availability: 'active' };
  }
  writeState({
    schemaVersion: 1,
    source: 'claude-code-statusline',
    capturedAt,
    model,
    availability: 'waiting',
    fiveHour: null,
    sevenDay: null
  });
  return { fiveHour: null, sevenDay: null, model, availability: 'waiting' };
}

function formatLine(state) {
  const parts = [];
  if (state.model) parts.push(state.model);
  const five = state.fiveHour?.remainingPercentage;
  const week = state.sevenDay?.remainingPercentage;
  if (five != null) parts.push(`5h ${Math.round(five)}% left`);
  if (week != null) parts.push(`7d ${Math.round(week)}% left`);
  if (five == null && week == null) parts.push('plan waiting');
  return parts.join('  ');
}

const raw = fs.readFileSync(0, 'utf8');
const forwardAt = process.argv.indexOf('--forward');
const forwardCommand = forwardAt >= 0 ? process.argv.slice(forwardAt + 1).filter((part) => part !== '--').join(' ').trim() : '';
const payload = parsePayload(raw);
if (payload) {
  try {
    const state = capture(payload);
    if (!forwardCommand) process.stdout.write(`${formatLine(state)}\n`);
  } catch (error) {
    const previous = readState();
    writeState({
      schemaVersion: 1,
      source: 'claude-code-statusline',
      capturedAt: new Date().toISOString(),
      availability: 'error',
      error: error?.message || 'capture failed',
      fiveHour: previous?.fiveHour || null,
      sevenDay: previous?.sevenDay || null
    });
    if (!forwardCommand) process.stdout.write('\n');
  }
} else if (!forwardCommand) {
  process.stdout.write('\n');
}

if (forwardCommand && !forwardCommand.includes(CAPTURE_MARKER)) {
  const result = spawnSync(forwardCommand, { input: raw, encoding: 'utf8', shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
  process.stdout.write(result.stdout || '');
}
