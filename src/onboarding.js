import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const ONBOARDING_VERSION = 1;

export function onboardingState(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    version: ONBOARDING_VERSION,
    step: ['welcome', 'projects', 'discovery', 'complete'].includes(source.step) ? source.step : 'welcome',
    completedAt: typeof source.completedAt === 'string' ? source.completedAt : null,
    skippedAt: typeof source.skippedAt === 'string' ? source.skippedAt : null
  };
}

export function validateProjectRoots(values, { homedir = os.homedir() } = {}) {
  const input = Array.isArray(values) ? values : [values];
  const seen = new Set(), roots = [], errors = [];
  let home = path.resolve(homedir);
  try { home = fs.realpathSync(home); } catch {}
  for (const value of input.filter(Boolean)) {
    const candidate = path.resolve(String(value));
    let resolved;
    try { resolved = fs.realpathSync(candidate); } catch { errors.push(`${candidate} is not an accessible directory.`); continue; }
    let directory = false;
    try { directory = fs.statSync(resolved).isDirectory(); } catch {}
    if (!directory) { errors.push(`${candidate} is not a directory.`); continue; }
    if (resolved === path.parse(resolved).root || resolved === home) { errors.push(`${candidate} is too broad; choose a projects folder instead.`); continue; }
    if (!seen.has(resolved)) { seen.add(resolved); roots.push(resolved); }
  }
  return { valid: errors.length === 0 && roots.length > 0, roots, errors };
}
