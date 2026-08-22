import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { normalizePermissions } from './permissions.js';
import { onboardingState } from './onboarding.js';

export const SETTINGS_VERSION = 4;
export const DEFAULT_ACCENT = '#FF2D78';

export const CANDIDATE_PROJECT_ROOTS = ['Dropbox/Projects', 'Projects'];

export function detectProjectRoots(homedir = os.homedir()) {
  return CANDIDATE_PROJECT_ROOTS
    .map((relative) => path.join(homedir, ...relative.split('/')))
    .filter((candidate) => {
      try { return fs.statSync(candidate).isDirectory(); } catch { return false; }
    });
}

export const DEFAULT_PROJECTS_ROOT = detectProjectRoots()[0] || null;

export function settingsFile(dataDir) {
  return path.join(dataDir, 'settings.json');
}

// Connected-service settings deliberately carry configuration only. Credentials
// are resolved at use time from an approved external source and must never be
// copied into settings.json.
export function connectedServicesState(value = {}) {
  const openRouter = value?.openRouter || {};
  return {
    openRouter: {
      enabled: openRouter.enabled === true,
      credentialRef: openRouter.credentialRef === 'env:OPENROUTER_MANAGEMENT_KEY' ? 'env:OPENROUTER_MANAGEMENT_KEY' : null,
      connectedAt: typeof openRouter.connectedAt === 'string' ? openRouter.connectedAt : null,
      lastSyncAt: typeof openRouter.lastSyncAt === 'string' ? openRouter.lastSyncAt : null,
      lastError: typeof openRouter.lastError === 'string' ? openRouter.lastError : null
    }
  };
}

export function normalizeAccent(value) {
  const short = String(value || '').trim().match(/^#?([0-9a-f]{3})$/i);
  const long = String(value || '').trim().match(/^#?([0-9a-f]{6})$/i);
  const hex = short ? short[1].split('').map((part) => part + part).join('') : long?.[1];
  return hex ? `#${hex.toUpperCase()}` : DEFAULT_ACCENT;
}

export function appearanceState(value = {}) { return { accent: normalizeAccent(value?.accent) }; }

function withoutCredentialValues(value) {
  if (Array.isArray(value)) return value.map(withoutCredentialValues);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(^|[_-])(api[_-]?key|credential|secret|token|password)([_-]|$)/i.test(key) && !/openrouter.*key/i.test(key))
    .map(([key, item]) => [key, withoutCredentialValues(item)]));
}

function normalized(value) {
  const base = value && typeof value === 'object' ? withoutCredentialValues(value) : {};
  return {
    ...base,
    version: SETTINGS_VERSION,
    permissions: normalizePermissions(base.permissions),
    onboarding: onboardingState(base.onboarding),
    connectedServices: connectedServicesState(base.connectedServices),
    appearance: appearanceState(base.appearance)
  };
}

export function loadSettings(dataDir) {
  try {
    const value = JSON.parse(fs.readFileSync(settingsFile(dataDir), 'utf8'));
    return normalized(value);
  } catch {
    return normalized();
  }
}

export function saveSettings(dataDir, patch = {}) {
  const current = loadSettings(dataDir);
  const next = normalized({ ...current, ...patch, permissions: patch.permissions || current.permissions, onboarding: patch.onboarding || current.onboarding, connectedServices: patch.connectedServices || current.connectedServices, appearance: patch.appearance || current.appearance });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(settingsFile(dataDir), JSON.stringify(next, null, 2));
  return next;
}

export function expandHome(value, homedir = os.homedir()) {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text === '~') return homedir;
  if (text.startsWith('~/')) return path.join(homedir, text.slice(2));
  return path.resolve(text);
}

export function resolveProjectRoots({ env = process.env, dataDir = null, homedir = os.homedir(), settings = null } = {}) {
  const fromEnv = env.AI_DASHBOARD_PROJECTS_ROOTS || env.AI_DASHBOARD_PROJECTS_ROOT;
  if (fromEnv) {
    return [...new Set(String(fromEnv).split(/[:\n,]/).map((item) => expandHome(item, homedir)).filter(Boolean))];
  }
  const stored = settings || (dataDir ? loadSettings(dataDir) : {});
  const listed = Array.isArray(stored.projectsRoots)
    ? stored.projectsRoots
    : stored.projectsRoot
      ? [stored.projectsRoot]
      : [];
  const roots = [...new Set(listed.map((item) => expandHome(item, homedir)).filter(Boolean))];
  if (roots.length) return roots;
  return detectProjectRoots(homedir);
}

export function locationUnderRoots(location, roots = []) {
  const target = String(location || '').replace(/\\/g, '/');
  return (roots || []).some((root) => {
    const prefix = String(root || '').replace(/\\/g, '/').replace(/\/$/, '');
    return prefix && (target === prefix || target.startsWith(`${prefix}/`));
  });
}
