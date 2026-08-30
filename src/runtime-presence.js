import { execFileSync } from 'node:child_process';

// Process presence is intentionally a separate, low-frequency local signal.
// It only answers whether a declared runtime appears to be running; it never
// creates a live-work event or contributes to a waveform.
export const PRESENCE_STATES = Object.freeze({ present: 'present', closed: 'closed', unknown: 'unknown' });
export const PRESENCE_POLL_MS = 5_000;
// A single `ps` failure is not enough evidence to erase a known runtime state.
// Keep the last reliable snapshot for a short bounded window, then surface
// Presence Unknown rather than pretending the stale answer is current.
export const PRESENCE_STALE_GOOD_MS = 15_000;

export function processSnapshotCommand(platform = process.platform) {
  // LaunchServices/dashboard processes can have a minimal PATH. Use the
  // system executable on macOS instead of relying on shell lookup, while
  // keeping other supported platforms portable.
  return platform === 'darwin' ? '/bin/ps' : 'ps';
}

const basename = (value = '') => String(value).split('/').at(-1).toLowerCase();

export function processSnapshotFromOutput(output, { platform = process.platform, now = Date.now } = {}) {
  const checkedAt = new Date(now()).toISOString();
  if (platform === 'win32') return { reliable: false, commands: [], checkedAt, reason: 'Process presence is not implemented for this platform.' };
  return { reliable: true, commands: String(output || '').split(/\r?\n/).map((value) => value.trim()).filter(Boolean), checkedAt, reason: null };
}

export function processSnapshot({ run = execFileSync, platform = process.platform, now = Date.now } = {}) {
  const checkedAt = new Date(now()).toISOString();
  if (platform === 'win32') return { reliable: false, commands: [], checkedAt, reason: 'Process presence is not implemented for this platform.' };
  try {
    // `comm` is the executable path, not the full command line: project paths,
    // prompts, arguments, and terminal content are never inspected.
    const output = run(processSnapshotCommand(platform), ['-axo', 'comm='], { encoding: 'utf8', timeout: 750, maxBuffer: 512 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    return processSnapshotFromOutput(output, { platform, now: () => new Date(checkedAt).getTime() });
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

export function createPresenceSampler({ runtimes = [], pollMs = PRESENCE_POLL_MS, staleGoodMs = PRESENCE_STALE_GOOD_MS, now = Date.now, snapshot = () => processSnapshot({ now }) } = {}) {
  let sampledAt = null;
  let cached = {};
  let reliableAt = null;
  return () => {
    const current = Number(now());
    if (sampledAt == null || current - sampledAt >= pollMs) {
      const sampled = snapshot();
      const states = runtimePresenceStates(runtimes, sampled);
      if (sampled?.reliable) {
        cached = states;
        reliableAt = current;
      } else if (reliableAt != null && current - reliableAt <= staleGoodMs && Object.keys(cached).length) {
        cached = Object.fromEntries(Object.entries(cached).map(([agent, state]) => [agent, {
          ...state,
          stale: true,
          reason: `The last reliable process snapshot is ${Math.max(0, Math.round((current - reliableAt) / 1000))}s old; polling will retry.`
        }]));
      } else {
        cached = states;
      }
      sampledAt = current;
    }
    return cached;
  };
}
