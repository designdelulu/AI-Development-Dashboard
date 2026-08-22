import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sessionIdentity } from './identity.js';

export const ANTIGRAVITY_CAPTURE_SCRIPT = 'antigravity-statusline-capture.mjs';
const MARKER = 'antigravity-statusline-capture';
const STALE_AFTER_MS = 15 * 60 * 1000;
const repoScript = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', ANTIGRAVITY_CAPTURE_SCRIPT);

export const antigravityRoot = (homeDir = os.homedir()) => path.join(homeDir, '.gemini', 'antigravity');
export const antigravityCliRoot = (homeDir = os.homedir()) => path.join(homeDir, '.gemini', 'antigravity-cli');
export const antigravitySettingsPath = (homeDir = os.homedir()) => path.join(antigravityCliRoot(homeDir), 'settings.json');
export const antigravityStatePath = (homeDir = os.homedir()) => path.join(antigravityCliRoot(homeDir), 'ai-dashboard', 'status_state.json');
export const antigravityCapturePath = (homeDir = os.homedir()) => path.join(antigravityCliRoot(homeDir), 'ai-dashboard', ANTIGRAVITY_CAPTURE_SCRIPT);

const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const iso = (value) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date.toISOString(); };

export function readAntigravitySettings(homeDir = os.homedir()) { try { return JSON.parse(fs.readFileSync(antigravitySettingsPath(homeDir), 'utf8')); } catch { return null; } }
export function readAntigravityState(homeDir = os.homedir()) { try { const value = JSON.parse(fs.readFileSync(antigravityStatePath(homeDir), 'utf8')); return value?.schemaVersion === 1 ? value : null; } catch { return null; } }
export function antigravityStatuslineCommand(settings) { const line = settings?.statusLine || settings?.statusline; return typeof line === 'string' ? line : typeof line?.command === 'string' ? line.command : null; }
export function antigravityCaptureConfigured(settings, homeDir = os.homedir()) { const command = antigravityStatuslineCommand(settings); return Boolean(command && (command.includes(MARKER) || command.includes(antigravityCapturePath(homeDir)))); }

function statuslineValue(settings) { const value = settings?.statusLine || settings?.statusline; return value && typeof value === 'object' ? value : {}; }
function backupPath(homeDir) { return `${antigravitySettingsPath(homeDir)}.bak-ai-dashboard-antigravity`; }

export function previewAntigravityCapture(homeDir = os.homedir(), { cliPresent = true } = {}) {
  const settings = readAntigravitySettings(homeDir) || {};
  const existing = antigravityStatuslineCommand(settings);
  const configured = antigravityCaptureConfigured(settings, homeDir);
  return {
    available: cliPresent,
    configured,
    settingsPath: antigravitySettingsPath(homeDir),
    helperPath: antigravityCapturePath(homeDir),
    backupPath: backupPath(homeDir),
    preservesExistingStatusline: Boolean(existing),
    hasExistingStatusline: Boolean(existing),
    capturedFields: ['cwd/workspace for project attribution', 'model ID/display name', 'current context token categories', 'quota bucket remaining fraction/reset time', 'plan tier', 'CLI version'],
    excludedFields: ['email', 'transcript_path and transcript content', 'VCS details', 'sandbox configuration', 'pending input and terminal state'],
    undo: 'Disable restores the pre-dashboard settings backup and removes only dashboard-owned capture files.',
    reason: cliPresent ? (configured ? 'Dashboard capture is already configured.' : 'Enabling changes only the documented statusLine command.') : 'Antigravity CLI is not detected; no settings can be changed.'
  };
}

export function ensureAntigravityCapture(homeDir = os.homedir(), { scriptSource = repoScript } = {}) {
  const file = antigravitySettingsPath(homeDir);
  const settings = readAntigravitySettings(homeDir) || {};
  const existing = antigravityStatuslineCommand(settings);
  if (antigravityCaptureConfigured(settings, homeDir)) return { changed: false, preserved: true, backup: null, settingsPath: file };
  const install = antigravityCapturePath(homeDir);
  fs.mkdirSync(path.dirname(install), { recursive: true });
  if (!fs.existsSync(scriptSource)) throw new Error('Antigravity capture helper is unavailable.');
  fs.copyFileSync(scriptSource, install);
  const backup = backupPath(homeDir);
  if (fs.existsSync(file) && !fs.existsSync(backup)) fs.copyFileSync(file, backup);
  const capture = `node "${install}"`;
  const command = existing ? `${capture} --forward -- ${existing}` : capture;
  const current = statuslineValue(settings);
  // Keep Antigravity's default status line unless the user explicitly disabled
  // stacking. A custom command is forwarded through the helper as well.
  const next = { ...settings, statusLine: { ...current, type: 'command', command, enabled: current.enabled !== false, stack_with_default: current.stack_with_default !== false } };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`);
  fs.renameSync(temp, file);
  return { changed: true, preserved: Boolean(existing), backup: fs.existsSync(backup) ? backup : null, settingsPath: file };
}

export class AntigravityIntegrationError extends Error { constructor(code, message) { super(message); this.code = code; } }
export function enableAntigravityCapture(homeDir = os.homedir(), { permission = false, confirmation = false, cliPresent = false, scriptSource = repoScript } = {}) {
  if (!permission) throw new AntigravityIntegrationError('permission-denied', 'Local integration write permission is required.');
  if (!confirmation) throw new AntigravityIntegrationError('confirmation-required', 'Review and confirm the Antigravity settings preview first.');
  if (!cliPresent) throw new AntigravityIntegrationError('cli-unavailable', 'Antigravity CLI is not detected.');
  return ensureAntigravityCapture(homeDir, { scriptSource });
}

export function disableAntigravityCapture(homeDir = os.homedir(), { permission = false, confirmation = false } = {}) {
  if (!permission) throw new AntigravityIntegrationError('permission-denied', 'Local integration write permission is required.');
  if (!confirmation) throw new AntigravityIntegrationError('confirmation-required', 'Confirm restore before changing Antigravity settings.');
  return restoreAntigravityCapture(homeDir);
}

export function restoreAntigravityCapture(homeDir = os.homedir()) {
  const file = antigravitySettingsPath(homeDir), backup = backupPath(homeDir), install = antigravityCapturePath(homeDir), state = antigravityStatePath(homeDir);
  if (fs.existsSync(backup)) { fs.copyFileSync(backup, file); fs.rmSync(backup, { force: true }); }
  else {
    const settings = readAntigravitySettings(homeDir) || {};
    const { statusLine, statusline, ...rest } = settings;
    const next = statusLine && antigravityCaptureConfigured(settings, homeDir) ? rest : settings;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  }
  fs.rmSync(install, { force: true });
  fs.rmSync(state, { force: true });
  return { restored: fs.existsSync(backup) === false, settingsPath: file };
}

export function normalizeAntigravityStatus(raw = {}, { capturedAt = raw.capturedAt || null } = {}) {
  if (!raw || raw.schemaVersion !== 1) return null;
  const model = typeof raw.model?.id === 'string' ? raw.model.id : null;
  const identity = sessionIdentity({ agent: null, host: 'Antigravity', model, inferAgent: false });
  const context = raw.contextWindow || {};
  const usage = context.currentUsage || {};
  const quotas = Object.entries(raw.quota || {}).map(([bucket, value]) => {
    const remainingFraction = finite(value?.remainingFraction);
    const resetAt = iso(value?.resetTime);
    return remainingFraction == null ? null : { id: bucket, label: bucket, remainingPercent: Math.max(0, Math.min(100, remainingFraction * 100)), resetAt };
  }).filter(Boolean);
  return {
    capturedAt: iso(capturedAt),
    host: 'Antigravity', agent: null, harness: 'standalone', provider: identity.provider === 'Unknown' ? null : identity.provider,
    providerConfidence: identity.providerConfidence, model: identity.model, modelRaw: identity.modelRaw, modelId: identity.modelId, modelLabel: raw.model?.displayName || identity.modelLabel,
    projectPath: typeof raw.workspace?.projectDir === 'string' ? raw.workspace.projectDir : typeof raw.cwd === 'string' ? raw.cwd : null,
    context: { totalInputTokens: finite(context.totalInputTokens), totalOutputTokens: finite(context.totalOutputTokens), contextWindowSize: finite(context.contextWindowSize), usedPercent: finite(context.usedPercentage), remainingPercent: finite(context.remainingPercentage), freshInput: finite(usage.inputTokens), output: finite(usage.outputTokens), cacheRead: finite(usage.cacheReadInputTokens), cacheCreation: finite(usage.cacheCreationInputTokens), evidence: 'Exact' },
    quotaBuckets: quotas,
    planTier: typeof raw.planTier === 'string' ? raw.planTier : null,
    version: typeof raw.version === 'string' ? raw.version : null,
    // Status changes are a snapshot, never evidence that an agent is working.
    live: { state: 'unsupported', reason: 'Status-line snapshots do not prove current work.' }
  };
}

export function antigravityCapacity(homeDir = os.homedir(), { cliPresent = true, now = Date.now() } = {}) {
  const settings = readAntigravitySettings(homeDir), state = readAntigravityState(homeDir), normalized = normalizeAntigravityStatus(state || {});
  const configured = antigravityCaptureConfigured(settings, homeDir);
  const base = { provider: 'Antigravity quota', capacitySource: 'Antigravity quota', host: 'Antigravity', source: 'Antigravity CLI statusLine JSON', observedAt: normalized?.capturedAt || null, planTier: normalized?.planTier || null, model: normalized?.model || null, windows: normalized?.quotaBuckets || [] };
  if (!cliPresent) return { ...base, status: 'Unavailable', health: 'unsupported', message: 'Antigravity app is installed, but the documented CLI status-line bridge is not available.' };
  if (!configured) return { ...base, status: 'Setup required', health: 'setup-required', message: 'Enable the optional local status-line capture to receive quota buckets.' };
  if (!normalized) return { ...base, status: 'Waiting', health: 'waiting', message: 'Waiting for the first Antigravity CLI status-line event.' };
  if (!normalized.quotaBuckets.length) return { ...base, status: 'Unavailable', health: 'unavailable', message: 'The status-line event did not expose a quota bucket.' };
  const stale = !normalized.capturedAt || now - new Date(normalized.capturedAt).getTime() > STALE_AFTER_MS;
  return { ...base, status: stale ? 'Stale' : 'Available', health: stale ? 'stale' : 'active', message: stale ? 'Last Antigravity quota snapshot is stale.' : null };
}
