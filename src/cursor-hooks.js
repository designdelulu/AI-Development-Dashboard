import fs from 'node:fs';
import path from 'node:path';

export const CURSOR_HOOK_SCHEMA_VERSION = 1;
export const CURSOR_HOOK_EVENTS = Object.freeze([
  'sessionStart', 'sessionEnd', 'beforeSubmitPrompt', 'afterAgentThought',
  'preToolUse', 'postToolUse', 'postToolUseFailure', 'subagentStart',
  'subagentStop', 'beforeShellExecution', 'afterShellExecution',
  'beforeMCPExecution', 'afterMCPExecution', 'afterFileEdit',
  'afterAgentResponse', 'stop', 'preCompact'
]);
// A prompt hook is the preferred turn start. Some Cursor Agent surfaces begin
// tool/thought hooks without emitting beforeSubmitPrompt; those official agent
// loop callbacks are still direct validated work, unlike terminal activity.
export const CURSOR_HOOK_START_EVENTS = new Set(['beforeSubmitPrompt', 'afterAgentThought', 'preToolUse', 'afterAgentResponse']);
export const CURSOR_HOOK_COMPLETE_EVENTS = new Set(['stop']);
export const CURSOR_HOOK_PULSE_EVENTS = new Set(CURSOR_HOOK_EVENTS.filter((event) => !['sessionStart', 'sessionEnd', 'stop'].includes(event)));
export const CURSOR_HOOK_QUEUE_MAX_BYTES = 64 * 1024;
export const CURSOR_HOOK_ORPHAN_MAX_MS = 30 * 60_000;
const DASHBOARD_HOOK_MARKER = 'ai-dashboard-cursor-hook';

const quoteShell = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;
const clone = (value) => JSON.parse(JSON.stringify(value));
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const hookFile = (home) => path.join(home, '.cursor', 'hooks.json');
const bridgeFile = (home) => path.join(home, '.cursor', 'hooks', DASHBOARD_HOOK_MARKER);

export function cursorHookCommand(event, { bridgePath, queuePath } = {}) {
  if (!CURSOR_HOOK_EVENTS.includes(event) || !bridgePath || !queuePath) return null;
  return `AI_DASHBOARD_CURSOR_HOOK_FILE=${quoteShell(queuePath)} ${quoteShell(bridgePath)} ${event}`;
}

export function cursorHookBridgeScript() {
  const events = CURSOR_HOOK_EVENTS.join('|');
  return `#!/bin/sh
# Managed by AI Development Dashboard. Cursor provides JSON on stdin; this
# bridge drains it without parsing or storing any of its contents.
exec >/dev/null 2>&1
event="$1"
case "$event" in
  ${events}) ;;
  *) cat >/dev/null || :; exit 0 ;;
esac
cat >/dev/null || :
queue="\${AI_DASHBOARD_CURSOR_HOOK_FILE:-}"
[ -n "$queue" ] || exit 0
[ -d "\${queue%/*}" ] || exit 0
now="$(date +%s 2>/dev/null || echo 0)"
case "$now" in *[!0-9]*|'') exit 0 ;; esac
umask 077
if [ -f "$queue" ] && [ "$(wc -c < "$queue" 2>/dev/null || echo 0)" -gt ${CURSOR_HOOK_QUEUE_MAX_BYTES} ]; then : > "$queue"; fi
printf '{"source":"cursor-hooks","event":"%s","timestamp":%s000,"schema":${CURSOR_HOOK_SCHEMA_VERSION}}\\n' "$event" "$now" >> "$queue" || :
exit 0
`;
}

export function parseCursorHooksConfig(text) {
  let value;
  try { value = JSON.parse(text); } catch { return { ok: false, reason: 'invalid-json' }; }
  if (!object(value) || !object(value.hooks)) return { ok: false, reason: 'invalid-schema' };
  for (const entries of Object.values(value.hooks)) if (!Array.isArray(entries)) return { ok: false, reason: 'invalid-hook-list' };
  return { ok: true, value };
}

export function dashboardCursorHook(definition) {
  return object(definition) && typeof definition.command === 'string' && definition.command.includes(DASHBOARD_HOOK_MARKER);
}

export function cursorHookConfigPlan(config, { bridgePath, queuePath } = {}) {
  const base = clone(config || { version: 1, hooks: {} });
  base.version = Number(base.version) || 1;
  base.hooks ||= {};
  const before = Object.values(base.hooks).flat().filter(dashboardCursorHook).length;
  for (const event of CURSOR_HOOK_EVENTS) {
    const entries = Array.isArray(base.hooks[event]) ? base.hooks[event] : [];
    const retained = entries.filter((entry) => !dashboardCursorHook(entry));
    const command = cursorHookCommand(event, { bridgePath, queuePath });
    base.hooks[event] = [...retained, { command }];
  }
  return { config: base, dashboardEntriesBefore: before, dashboardEntriesAfter: CURSOR_HOOK_EVENTS.length };
}

export function removeDashboardCursorHooks(config) {
  const base = clone(config);
  let removed = 0;
  for (const [event, entries] of Object.entries(base.hooks || {})) {
    const retained = entries.filter((entry) => {
      if (!dashboardCursorHook(entry)) return true;
      removed += 1;
      return false;
    });
    if (retained.length) base.hooks[event] = retained;
    else delete base.hooks[event];
  }
  return { config: base, removed };
}

export function cursorHookInstallationStatus({ home, dataDir } = {}) {
  const configFile = hookFile(home), scriptFile = bridgeFile(home), queueFile = path.join(dataDir, 'cursor-hooks.jsonl');
  const bridgeReady = (() => {
    try { return Boolean(fs.statSync(scriptFile).mode & 0o111); } catch { return false; }
  })();
  if (!fs.existsSync(configFile)) return { state: 'available', configured: false, bridge: bridgeReady ? 'ready' : 'missing', configFile, scriptFile, queueFile, dashboardEntries: 0 };
  let parsed;
  try { parsed = parseCursorHooksConfig(fs.readFileSync(configFile, 'utf8')); } catch { parsed = { ok: false, reason: 'unreadable' }; }
  if (!parsed.ok) return { state: 'invalid-config', configured: false, bridge: bridgeReady ? 'ready' : 'missing', configFile, scriptFile, queueFile, dashboardEntries: 0, reason: parsed.reason };
  const dashboardEntries = Object.values(parsed.value.hooks).flat().filter(dashboardCursorHook).length;
  return { state: dashboardEntries === CURSOR_HOOK_EVENTS.length && bridgeReady ? 'configured' : 'available', configured: dashboardEntries > 0 && bridgeReady, bridge: bridgeReady ? 'ready' : 'missing', configFile, scriptFile, queueFile, dashboardEntries };
}

export function installCursorHooks({ home, dataDir, confirm = false, now = Date.now } = {}) {
  const status = cursorHookInstallationStatus({ home, dataDir });
  if (status.state === 'invalid-config') return { state: 'refused', reason: status.reason };
  const existing = fs.existsSync(status.configFile) ? parseCursorHooksConfig(fs.readFileSync(status.configFile, 'utf8')).value : { version: 1, hooks: {} };
  const plan = cursorHookConfigPlan(existing, { bridgePath: status.scriptFile, queuePath: status.queueFile });
  const preview = { state: confirm ? 'installing' : 'preview', existingDashboardEntries: plan.dashboardEntriesBefore, dashboardEntries: plan.dashboardEntriesAfter, createsConfig: !fs.existsSync(status.configFile), createsBridge: !fs.existsSync(status.scriptFile), backup: fs.existsSync(status.configFile) };
  if (!confirm) return preview;
  fs.mkdirSync(path.dirname(status.configFile), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.dirname(status.scriptFile), { recursive: true, mode: 0o700 });
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  let backupFile = null;
  if (fs.existsSync(status.configFile)) {
    backupFile = `${status.configFile}.ai-dashboard-backup-${now()}`;
    fs.copyFileSync(status.configFile, backupFile);
    fs.chmodSync(backupFile, 0o600);
  }
  fs.writeFileSync(status.scriptFile, cursorHookBridgeScript(), { mode: 0o700 });
  fs.writeFileSync(status.configFile, `${JSON.stringify(plan.config, null, 2)}\n`, { mode: 0o600 });
  return { ...preview, state: 'installed', backup: Boolean(backupFile), backupFile };
}

export function removeCursorHooks({ home, dataDir, confirm = false, now = Date.now } = {}) {
  const status = cursorHookInstallationStatus({ home, dataDir });
  if (status.state === 'invalid-config') return { state: 'refused', reason: status.reason };
  if (!fs.existsSync(status.configFile)) return { state: 'absent', removed: 0 };
  const parsed = parseCursorHooksConfig(fs.readFileSync(status.configFile, 'utf8'));
  const plan = removeDashboardCursorHooks(parsed.value);
  const preview = { state: confirm ? 'removing' : 'preview', removed: plan.removed, removesBridge: fs.existsSync(status.scriptFile), backup: true };
  if (!confirm) return preview;
  const backupFile = `${status.configFile}.ai-dashboard-backup-${now()}`;
  fs.copyFileSync(status.configFile, backupFile);
  fs.chmodSync(backupFile, 0o600);
  fs.writeFileSync(status.configFile, `${JSON.stringify(plan.config, null, 2)}\n`, { mode: 0o600 });
  if (fs.existsSync(status.scriptFile)) fs.unlinkSync(status.scriptFile);
  return { ...preview, state: 'removed', backupFile };
}

export function cursorHookRecord(value) {
  if (!object(value) || value.source !== 'cursor-hooks' || !CURSOR_HOOK_EVENTS.includes(value.event)) return null;
  if (!Number.isFinite(Number(value.timestamp)) || Number(value.timestamp) <= 0 || Number(value.schema) !== CURSOR_HOOK_SCHEMA_VERSION) return null;
  if (!Object.keys(value).every((key) => ['source', 'event', 'timestamp', 'schema'].includes(key))) return null;
  return { source: 'cursor-hooks', event: value.event, timestamp: Number(value.timestamp), schema: CURSOR_HOOK_SCHEMA_VERSION };
}

// The queue is written only by the bridge, but do not JSON-parse arbitrary
// file content here. Accept exactly the bridge's tiny allowlisted shape.
export function readCursorHookRecords(file, start = 0, carry = '') {
  try {
    const size = fs.statSync(file).size;
    const offset = Math.max(0, Math.min(size, Number(start) || 0));
    const bytes = Math.min(CURSOR_HOOK_QUEUE_MAX_BYTES, Math.max(0, size - offset));
    const actualStart = size - bytes;
    if (!bytes) return { records: [], carry, size, truncated: false };
    const buffer = Buffer.alloc(bytes);
    const fd = fs.openSync(file, 'r');
    fs.readSync(fd, buffer, 0, bytes, actualStart);
    fs.closeSync(fd);
    const lines = `${actualStart > offset ? '' : carry}${buffer.toString('utf8')}`.split('\n');
    const remainder = lines.pop() || '';
    const records = lines.flatMap((line) => {
      const match = line.match(/^\{"source":"cursor-hooks","event":"([A-Za-z]+)","timestamp":(\d+),"schema":1\}$/);
      return match ? [cursorHookRecord({ source: 'cursor-hooks', event: match[1], timestamp: Number(match[2]), schema: 1 })].filter(Boolean) : [];
    });
    return { records, carry: remainder.length <= 256 ? remainder : '', size, truncated: actualStart > offset };
  } catch {
    return { records: [], carry: '', size: 0, truncated: false };
  }
}

export function cursorHookQueueSummary(file, { now = Date.now, windowMs = 5 * 60_000 } = {}) {
  const records = readCursorHookRecords(file).records;
  const cutoff = now() - windowMs;
  const recent = records.filter((record) => record.timestamp >= cutoff && record.timestamp <= now());
  const counts = Object.fromEntries(recent.reduce((all, record) => {
    all.set(record.event, (all.get(record.event) || 0) + 1);
    return all;
  }, new Map()));
  const last = recent.at(-1) || records.at(-1) || null;
  return { records: records.length, recentRecords: recent.length, recentCounts: counts, lastEventAt: last ? new Date(last.timestamp).toISOString() : null };
}

export class CursorHookTracker {
  constructor({ orphanMaxMs = CURSOR_HOOK_ORPHAN_MAX_MS } = {}) { this.orphanMaxMs = orphanMaxMs; this.startedAt = null; this.lastEventAt = null; this.lastCompletionAt = null; }
  observe(record, now = Date.now()) {
    const event = cursorHookRecord(record);
    if (!event) return { accepted: false, started: false, completed: false, pulse: false, active: this.startedAt != null };
    const at = Math.min(now, Math.max(0, event.timestamp));
    this.lastEventAt = at;
    if (CURSOR_HOOK_START_EVENTS.has(event.event)) {
      const started = this.startedAt == null;
      this.startedAt = at;
      this.lastCompletionAt = null;
      return { accepted: true, event: event.event, at, started, completed: false, pulse: true, active: true };
    }
    if (CURSOR_HOOK_COMPLETE_EVENTS.has(event.event)) {
      const completed = this.startedAt != null;
      this.startedAt = null;
      this.lastCompletionAt = at;
      return { accepted: true, event: event.event, at, started: false, completed, pulse: true, active: false };
    }
    return { accepted: true, event: event.event, at, started: false, completed: false, pulse: CURSOR_HOOK_PULSE_EVENTS.has(event.event), active: this.startedAt != null };
  }
  signal(now = Date.now()) {
    if (this.startedAt == null) return null;
    if (now - this.startedAt > this.orphanMaxMs) { this.startedAt = null; return null; }
    return { active: true, since: new Date(this.startedAt).toISOString(), source: 'cursor-official-hooks', confidence: 'Official hooks', reason: 'Cursor’s official agent-loop hooks recorded an open agent turn.' };
  }
  completion(now = Date.now()) {
    if (this.lastCompletionAt == null || now - this.lastCompletionAt > 5 * 60_000) return null;
    return { at: new Date(this.lastCompletionAt).toISOString(), confidence: 'Official hooks', reason: 'Cursor’s official stop hook recorded normal agent-loop completion.' };
  }
  clear() { this.startedAt = null; this.lastEventAt = null; this.lastCompletionAt = null; }
}
