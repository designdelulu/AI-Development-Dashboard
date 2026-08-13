import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const DEFAULT_PROJECTS_ROOT = path.join(os.homedir(), 'Dropbox', 'Projects');

export function settingsFile(dataDir) {
  return path.join(dataDir, 'settings.json');
}

export function loadSettings(dataDir) {
  try {
    const value = JSON.parse(fs.readFileSync(settingsFile(dataDir), 'utf8'));
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

export function saveSettings(dataDir, patch = {}) {
  const current = loadSettings(dataDir);
  const next = { ...current, ...patch };
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
  return roots.length ? roots : [path.join(homedir, 'Dropbox', 'Projects')];
}

export function locationUnderRoots(location, roots = []) {
  const target = String(location || '').replace(/\\/g, '/');
  return (roots || []).some((root) => {
    const prefix = String(root || '').replace(/\\/g, '/').replace(/\/$/, '');
    return prefix && (target === prefix || target.startsWith(`${prefix}/`));
  });
}
