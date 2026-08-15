import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CLAUDE_STATUSLINE_MIN_VERSION = '2.1.80';
export const CAPTURE_SCRIPT_NAME = 'claude-capacity-capture.mjs';
const CAPTURE_MARKER = 'claude-capacity-capture';

const repoScript = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', CAPTURE_SCRIPT_NAME);

export function remainingFromUsed(used) {
  const value = Number(used);
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, 100 - value));
}

export function compareVersions(left, right) {
  const a = String(left || '').split('.').map((part) => Number(part) || 0);
  const b = String(right || '').split('.').map((part) => Number(part) || 0);
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0);
  }
  return 0;
}

export function installedClaudeVersion(homeDir = os.homedir()) {
  const candidates = [
    path.join(homeDir, '.nvm', 'versions', 'node', process.versions.node, 'lib', 'node_modules', '@anthropic-ai', 'claude-code', 'package.json'),
    path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', '@anthropic-ai', 'claude-code', 'package.json')
  ];
  for (const file of candidates) {
    try {
      const value = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (value?.name === '@anthropic-ai/claude-code' && value.version) return value.version;
    } catch {}
  }
  return null;
}

export function usageStatePath(homeDir = os.homedir()) {
  return path.join(homeDir, '.claude', 'usage_state.json');
}

export function captureInstallPath(homeDir = os.homedir()) {
  return path.join(homeDir, '.claude', 'ai-dashboard', CAPTURE_SCRIPT_NAME);
}

export function settingsPath(homeDir = os.homedir()) {
  return path.join(homeDir, '.claude', 'settings.json');
}

export function readUsageState(homeDir = os.homedir()) {
  try {
    return JSON.parse(fs.readFileSync(usageStatePath(homeDir), 'utf8'));
  } catch {
    return null;
  }
}

export function readClaudeSettings(homeDir = os.homedir()) {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(homeDir), 'utf8'));
  } catch {
    return null;
  }
}

export function statuslineCommand(settings) {
  const value = settings?.statusLine || settings?.statusline;
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value?.command === 'string') return value.command;
  return null;
}

export function captureConfigured(settings, homeDir = os.homedir()) {
  const command = statuslineCommand(settings);
  if (!command) return false;
  return command.includes(CAPTURE_MARKER) || command.includes(captureInstallPath(homeDir));
}

function backupSettings(file) {
  const backup = `${file}.bak-ai-dashboard-capacity`;
  if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
  return backup;
}

export function ensureClaudeCapacityCapture(homeDir = os.homedir(), { scriptSource = repoScript } = {}) {
  const file = settingsPath(homeDir);
  let settings = {};
  try {
    settings = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    settings = {};
  }
  const existing = statuslineCommand(settings);
  const install = captureInstallPath(homeDir);
  fs.mkdirSync(path.dirname(install), { recursive: true });
  if (fs.existsSync(scriptSource)) fs.copyFileSync(scriptSource, install);
  if (existing && captureConfigured(settings, homeDir)) {
    return { changed: false, preserved: true, command: existing, backup: null };
  }
  const capture = `node "${install}"`;
  const command = existing ? `${capture} --forward -- ${existing}` : capture;
  const next = {
    ...settings,
    statusLine: { type: 'command', command }
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const backup = fs.existsSync(file) ? backupSettings(file) : null;
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`);
  fs.renameSync(temp, file);
  return { changed: true, preserved: Boolean(existing), command, backup };
}

function windowStatus(raw, id, label) {
  if (!raw) return null;
  const used = Number(raw.usedPercentage);
  const remaining = raw.remainingPercentage != null ? Number(raw.remainingPercentage) : remainingFromUsed(used);
  if (!Number.isFinite(remaining)) return null;
  return {
    id,
    label,
    usedPercent: Number.isFinite(used) ? Math.max(0, Math.min(100, used)) : Math.max(0, Math.min(100, 100 - remaining)),
    remainingPercent: Math.max(0, Math.min(100, remaining)),
    resetAt: raw.resetsAt || null
  };
}

export function claudeCapacityFromState(state, { version = null } = {}) {
  if (version && compareVersions(version, CLAUDE_STATUSLINE_MIN_VERSION) < 0) {
    return {
      provider: 'Claude',
      status: 'Unsupported',
      health: 'unsupported',
      message: `Installed Claude Code ${version} does not expose statusline rate_limits (needs ${CLAUDE_STATUSLINE_MIN_VERSION}+).`,
      source: 'claude-code-statusline',
      observedAt: null,
      windows: []
    };
  }
  if (!state) {
    return {
      provider: 'Claude',
      status: 'Waiting',
      health: 'waiting',
      message: 'Waiting for first Claude response. Statusline rate limits appear after an API reply on Claude.ai Pro/Max.',
      source: 'claude-code-statusline',
      observedAt: null,
      windows: []
    };
  }
  if (state.availability === 'error') {
    return {
      provider: 'Claude',
      status: 'Error',
      health: 'error',
      message: state.error || 'Capacity capture error.',
      source: 'claude-code-statusline',
      observedAt: state.capturedAt || null,
      windows: []
    };
  }
  const windows = [
    windowStatus(state.fiveHour, 'five_hour', '5-hour'),
    windowStatus(state.sevenDay, 'seven_day', 'Weekly')
  ].filter(Boolean);
  if (windows.length) {
    return {
      provider: 'Claude',
      status: 'Available',
      health: 'active',
      message: null,
      source: 'Claude Code statusline rate_limits (used percentage converted to remaining).',
      observedAt: state.capturedAt || null,
      windows
    };
  }
  if (state.availability === 'waiting' || !state.fiveHour && !state.sevenDay) {
    return {
      provider: 'Claude',
      status: 'Waiting',
      health: 'waiting',
      message: 'Waiting for first Claude response, or this account does not expose statusline rate limits.',
      source: 'claude-code-statusline',
      observedAt: state.capturedAt || null,
      windows: []
    };
  }
  return {
    provider: 'Claude',
    status: 'Unavailable',
    health: 'unavailable',
    message: 'Not available on account through the supported statusline fields.',
    source: 'claude-code-statusline',
    observedAt: state.capturedAt || null,
    windows: []
  };
}

export function claudePlanCapacityCapability(homeDir = os.homedir()) {
  const settings = readClaudeSettings(homeDir);
  const stateFile = usageStatePath(homeDir);
  const install = captureInstallPath(homeDir);
  const active = captureConfigured(settings, homeDir) || fs.existsSync(stateFile);
  if (!active) return null;
  const state = readUsageState(homeDir);
  const health = state?.availability === 'active' ? 'Active' : state?.availability === 'error' ? 'Error' : 'Waiting';
  return {
    name: 'Claude Plan Capacity',
    type: 'Integration',
    origin: 'Claude Code statusline',
    location: fs.existsSync(install) ? install : settingsPath(homeDir),
    capabilityKey: 'claude-plan-capacity',
    description: 'Captures Claude.ai 5-hour and 7-day used percentages from the official Claude Code statusline payload.',
    summaryKind: 'native configuration',
    isPrivate: false,
    scope: 'User / Global',
    agent: 'Claude Code',
    trigger: 'Claude Code statusline update after a model response',
    behavior: 'Writes five-hour and seven-day used/remaining percentages and reset times to a local usage_state.json file.',
    implementation: 'Official Claude Code statusline JSON; dashboard capture helper',
    portability: 'Claude-specific',
    compatibleAgents: ['Claude'],
    health,
    active: health === 'Active' || captureConfigured(settings, homeDir),
    statusNote: health === 'Active' ? 'Receiving official statusline rate-limit fields.' : 'Installed; waiting for a Claude response that includes rate_limits.',
    setupRecipe: 'Preserve any existing statusLine command. The dashboard chains a capture helper that writes only rate-limit metadata.'
  };
}
