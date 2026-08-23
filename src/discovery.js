import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lookupBinary } from './open-agent.js';
import { cursorStorageRoot } from './live-files.js';
import { clineInstallation } from './cline.js';

const exists = (value) => { try { return Boolean(value) && fs.statSync(value).isDirectory(); } catch { return false; } };
const fileExists = (value) => { try { return Boolean(value) && fs.statSync(value).isFile(); } catch { return false; } };
const sourceState = ({ installed, historyPaths = [], binary = null, appPath = null, version = null, historySupported = true, needsSession = false }) => {
  const historyCount = historyPaths.filter((item) => exists(item) || fileExists(item)).length;
  return {
    installed: { state: installed ? 'detected' : 'not-detected', evidence: [binary && 'binary', appPath && 'application', ...historyPaths.filter((item) => exists(item) || fileExists(item)).map(() => 'local-root')].filter(Boolean), version, observedAt: new Date().toISOString() },
    history: historySupported ? { state: historyCount ? 'none-yet' : (installed && needsSession ? 'none-yet' : 'unsupported'), recordCount: 0, reason: historyCount ? 'Root found; retained records are evaluated by the adapter.' : (needsSession ? 'Use the tool once to create supported local history.' : 'No supported retained history root was found.') } : { state: 'unsupported', reason: 'No safe local history format is supported.' },
    live: { state: 'unknown', evidence: [], freshness: 'unavailable' },
    connection: { state: 'not-applicable' },
    health: { level: installed ? 'ok' : 'unknown', code: installed ? 'detected' : 'not-detected', checkedAt: new Date().toISOString() }
  };
};

export function discoverClosedTools({ homedir = os.homedir(), env = process.env, platform = process.platform } = {}) {
  const app = (name) => platform === 'darwin' ? path.join('/Applications', `${name}.app`) : null;
  const cli = (name, extra = []) => lookupBinary(name, extra, env);
  const claudeRoot = path.join(homedir, '.claude', 'projects');
  const codexRoot = path.join(homedir, '.codex', 'sessions');
  const cursorRoot = path.join(homedir, '.cursor', 'projects');
  const result = {
    Claude: sourceState({ installed: Boolean(cli('claude', [path.join(homedir, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'])) || exists(path.join(homedir, '.claude')), binary: cli('claude', [path.join(homedir, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin']), historyPaths: [claudeRoot] }),
    Codex: sourceState({ installed: Boolean(cli('codex', ['/opt/homebrew/bin', '/usr/local/bin'])) || exists(path.join(homedir, '.codex')), binary: cli('codex', ['/opt/homebrew/bin', '/usr/local/bin']), historyPaths: [codexRoot] }),
    Cursor: sourceState({ installed: Boolean(cli('cursor', ['/opt/homebrew/bin', '/usr/local/bin'])) || Boolean(app('Cursor') && exists(app('Cursor'))) || exists(path.join(homedir, '.cursor')), binary: cli('cursor', ['/opt/homebrew/bin', '/usr/local/bin']), appPath: app('Cursor'), historyPaths: [cursorRoot, cursorStorageRoot(homedir, platform)] }),
    Cline: (() => {
      const installation = clineInstallation({ homeDir: homedir, env, platform });
      return {
        ...sourceState({ installed: Boolean(installation.binary || installation.root && exists(installation.root) || installation.extensions.length), binary: installation.binary, historyPaths: [installation.sessionsRoot, installation.dbFile], needsSession: true }),
        installation: { sessionRoot: installation.sessionsRoot, sessionIndex: installation.dbFile, extensions: installation.extensions.length, cli: Boolean(installation.binary) }
      };
    })(),
    Antigravity: sourceState({ installed: Boolean(app('Antigravity') && exists(app('Antigravity'))) || exists(path.join(homedir, '.gemini', 'antigravity')) || Boolean(cli('agy', [path.join(homedir, '.gemini', 'antigravity-cli', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'])), appPath: app('Antigravity'), binary: cli('agy', [path.join(homedir, '.gemini', 'antigravity-cli', 'bin'), '/opt/homebrew/bin', '/usr/local/bin']), historyPaths: [path.join(homedir, '.gemini', 'antigravity')], historySupported: false, needsSession: true }),
    'DeepSeek Harness': sourceState({ installed: Boolean(cli('dsh', ['/opt/homebrew/bin', '/usr/local/bin'])) || exists(path.join(homedir, '.dsh')), binary: cli('dsh', ['/opt/homebrew/bin', '/usr/local/bin']), historyPaths: [path.join(homedir, '.dsh')], historySupported: false, needsSession: true }),
    OpenCode: sourceState({ installed: Boolean(cli('opencode', ['/opt/homebrew/bin', '/usr/local/bin'])) || exists(path.join(homedir, '.local', 'share', 'opencode')), binary: cli('opencode', ['/opt/homebrew/bin', '/usr/local/bin']), historyPaths: [path.join(homedir, '.local', 'share', 'opencode')], historySupported: false, needsSession: true }),
    'Gemini CLI': sourceState({ installed: Boolean(cli('gemini', ['/opt/homebrew/bin', '/usr/local/bin'])) || exists(path.join(homedir, '.gemini')), binary: cli('gemini', ['/opt/homebrew/bin', '/usr/local/bin']), historyPaths: [path.join(homedir, '.gemini', 'tmp')], historySupported: false, needsSession: true }),
    'Kimi Code': sourceState({ installed: Boolean(cli('kimi', ['/opt/homebrew/bin', '/usr/local/bin'])) || exists(path.join(homedir, '.kimi-code')), binary: cli('kimi', ['/opt/homebrew/bin', '/usr/local/bin']), historyPaths: [path.join(homedir, '.kimi-code', 'sessions')], historySupported: false, needsSession: true }),
    'VS Code': sourceState({ installed: Boolean(cli('code', ['/opt/homebrew/bin', '/usr/local/bin'])) || Boolean(app('Visual Studio Code') && exists(app('Visual Studio Code'))) || exists(path.join(homedir, '.vscode')), binary: cli('code', ['/opt/homebrew/bin', '/usr/local/bin']), appPath: app('Visual Studio Code'), historyPaths: [path.join(homedir, '.vscode', 'extensions')], historySupported: false }),
    Inventory: { installed: { state: 'detected', evidence: ['dashboard local inventory'], observedAt: new Date().toISOString() }, history: { state: 'not-applicable' }, live: { state: 'unsupported' }, connection: { state: 'not-applicable' }, health: { level: 'ok', code: 'local-inventory', checkedAt: new Date().toISOString() } }
  };
  return result;
}

export function applyHistoricalObservation(state, sessionCount = 0, newestAt = null) {
  const next = structuredClone(state || {});
  next.history = sessionCount > 0
    ? { state: 'observed', recordCount: sessionCount, newestAt, reason: null }
    : (next.history || { state: 'unknown' });
  return next;
}
