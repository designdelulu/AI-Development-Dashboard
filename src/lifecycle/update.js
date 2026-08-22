import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const git = (root, args, execFile = execFileSync) => {
  try { return execFile('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch (error) { return { error: String(error?.stderr || error?.message || 'Git command failed.').trim() }; }
};
const exists = (value) => { try { return fs.existsSync(value); } catch { return false; } };

export function installMode({ script, realpath = fs.realpathSync } = {}) {
  const resolved = script ? realpath(script) : null;
  const root = resolved ? path.resolve(path.dirname(resolved), '..') : null;
  if (root && exists(path.join(root, '.git')) && exists(path.join(root, 'package.json'))) return { kind: 'git-checkout', root, script: resolved };
  return { kind: 'unsupported', root: null, script: resolved, message: 'This installation is not a linked Git checkout. Update it with the package or installer that installed AI Development Dashboard.' };
}

export function inspectGitUpdate(mode, { execFile = execFileSync } = {}) {
  if (mode?.kind !== 'git-checkout') return { state: 'unsupported', ...mode };
  const root = mode.root;
  const status = git(root, ['status', '--porcelain=v1'], execFile);
  if (typeof status === 'object') return { state: 'error', root, message: status.error };
  if (status) return { state: 'dirty', root, message: 'Update available but local changes must be committed/stashed first.' };
  const branch = git(root, ['branch', '--show-current'], execFile);
  if (typeof branch === 'object' || !branch) return { state: 'unsupported', root, message: 'The checkout is detached or has no current branch; update it manually.' };
  const remote = git(root, ['remote', 'get-url', 'origin'], execFile);
  if (typeof remote === 'object' || !remote) return { state: 'unsupported', root, branch, message: 'No origin remote is configured; update this checkout manually.' };
  const upstream = `origin/${branch}`;
  return { state: 'ready', root, branch, upstream, remote, head: git(root, ['rev-parse', 'HEAD'], execFile) };
}

export function updateGitCheckout(mode, { execFile = execFileSync } = {}) {
  const inspected = inspectGitUpdate(mode, { execFile });
  if (inspected.state !== 'ready') return inspected;
  const fetched = git(inspected.root, ['fetch', '--quiet', 'origin'], execFile);
  if (typeof fetched === 'object') return { ...inspected, state: 'error', message: `Could not fetch dashboard updates: ${fetched.error}` };
  const counts = git(inspected.root, ['rev-list', '--left-right', '--count', `HEAD...${inspected.upstream}`], execFile);
  if (typeof counts === 'object') return { ...inspected, state: 'error', message: `Could not compare dashboard updates: ${counts.error}` };
  const [ahead = 0, behind = 0] = counts.split(/\s+/).map(Number);
  if (ahead > 0) return { ...inspected, state: 'diverged', ahead, behind, message: 'Local dashboard history has commits not on its upstream; update stopped without changing anything.' };
  if (!behind) return { ...inspected, state: 'current', ahead: 0, behind: 0, head: inspected.head, message: 'Already up to date.' };
  const changed = git(inspected.root, ['diff', '--name-only', `${inspected.head}..${inspected.upstream}`], execFile);
  if (typeof changed === 'object') return { ...inspected, state: 'error', message: `Could not inspect dashboard changes: ${changed.error}` };
  const merged = git(inspected.root, ['merge', '--ff-only', inspected.upstream], execFile);
  if (typeof merged === 'object') return { ...inspected, state: 'error', message: `Fast-forward update stopped: ${merged.error}` };
  const head = git(inspected.root, ['rev-parse', 'HEAD'], execFile);
  return { ...inspected, state: 'updated', ahead: 0, behind, previousHead: inspected.head, head: typeof head === 'string' ? head : null, dependencyManifestChanged: changed.split('\n').some((file) => /(^|\/)(package\.json|package-lock\.json|npm-shrinkwrap\.json)$/.test(file)), message: 'Updated with a fast-forward only.' };
}
