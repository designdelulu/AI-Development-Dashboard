import { execFileSync } from 'node:child_process';

// Process presence is intentionally a separate, low-frequency local signal.
// It only answers whether a declared runtime appears to be running; it never
// creates a live-work event or contributes to a waveform.
export const PRESENCE_STATES = Object.freeze({ present: 'present', closed: 'closed', unknown: 'unknown' });
export const PRESENCE_POLL_MS = 5_000;

const basename = (value = '') => String(value).split('/').at(-1).toLowerCase();

export function processSnapshot({ run = execFileSync, platform = process.platform, now = Date.now } = {}) {
  const checkedAt = new Date(now()).toISOString();
  if (platform === 'win32') return { reliable: false, commands: [], checkedAt, reason: 'Process presence is not implemented for this platform.' };
  try {
    // `comm` is the executable path, not the full command line: project paths,
    // prompts, arguments, and terminal content are never inspected.
    const output = run('ps', ['-axo', 'comm='], { encoding: 'utf8', timeout: 750, maxBuffer: 512 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    return { reliable: true, commands: String(output || '').split(/\r?\n/).map((value) => value.trim()).filter(Boolean), checkedAt, reason: null };
  } catch {
    return { reliable: false, commands: [], checkedAt, reason: 'The local process snapshot was unavailable.' };
  }
}

function runtimePresence(runtime = {}, snapshot = {}) {
  const hint = runtime.presence;
  if (!hint) return { state: PRESENCE_STATES.unknown, checkedAt: snapshot.checkedAt || null, reason: 'This adapter does not declare a reliable runtime-presence signal.' };
  if (!snapshot.reliable) return { state: PRESENCE_STATES.unknown, checkedAt: snapshot.checkedAt || null, reason: snapshot.reason || 'The local process snapshot was unavailable.' };
  const names = new Set((hint.processNames || []).map((value) => String(value).toLowerCase()));
  const suffixes = (hint.processPathSuffixes || []).map((value) => String(value).toLowerCase());
  const includes = (hint.processPathIncludes || []).map((value) => String(value).toLowerCase());
  const command = snapshot.commands.find((value) => names.has(basename(value)) || suffixes.some((suffix) => String(value).toLowerCase().endsWith(suffix)) || includes.some((fragment) => String(value).toLowerCase().includes(fragment)));
  return command
    ? { state: PRESENCE_STATES.present, checkedAt: snapshot.checkedAt, evidence: 'local-process-executable', reason: 'A declared local runtime executable is present.' }
    : { state: PRESENCE_STATES.closed, checkedAt: snapshot.checkedAt, evidence: 'local-process-executable', reason: 'No declared local runtime executable is present.' };
}

export function runtimePresenceStates(runtimes = [], snapshot = processSnapshot()) {
  return Object.fromEntries((runtimes || []).filter((runtime) => runtime?.liveCapable).map((runtime) => [runtime.agent, runtimePresence(runtime, snapshot)]));
}

export function createPresenceSampler({ runtimes = [], pollMs = PRESENCE_POLL_MS, now = Date.now, snapshot = () => processSnapshot({ now }) } = {}) {
  let sampledAt = null;
  let cached = {};
  return () => {
    const current = Number(now());
    if (sampledAt == null || current - sampledAt >= pollMs) {
      cached = runtimePresenceStates(runtimes, snapshot());
      sampledAt = current;
    }
    return cached;
  };
}
