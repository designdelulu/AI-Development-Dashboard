const IGNORED = /(?:^|[\\/])(?:canvases|mcps|node_modules|\.git|\.dashboard-data|ai-dashboard)(?:[\\/]|$)/i;
const CLAUDE_EXCLUDED = /(?:^|[\\/])(?:ai-dashboard|cache|caches|indexes?|plugins?|debug|statsig|file-history|todos|shell-snapshots|telemetry)(?:[\\/]|$)/i;

export function normalizeLivePath(file) {
  return String(file || '').replace(/\\/g, '/');
}

export function isDashboardGeneratedClaudePath(file) {
  const normal = normalizeLivePath(file);
  if (!normal) return false;
  return /\/\.claude\/ai-dashboard(?:\/|$)/i.test(normal)
    || /\/\.claude\/usage_state\.json$/i.test(normal)
    || /settings\.json(?:\.[^/]+)?$/i.test(normal) && /\/\.claude\//i.test(normal)
    || /bak-ai-dashboard/i.test(normal)
    || /\/\.dashboard-data(?:\/|$)/i.test(normal)
    || /\.claude\/.*\.(?:bak|tmp)$/i.test(normal);
}

export function isCursorLivePath(file) {
  const normal = normalizeLivePath(file);
  if (!normal || IGNORED.test(normal)) return false;
  if (/\/state\.vscdb(?:-wal)?$/i.test(normal)) return true;
  if (/\/agent-transcripts\//i.test(normal) && /\.(jsonl|json)$/i.test(normal)) return true;
  if (/\/agent-tools\//i.test(normal) && !normal.endsWith('/')) return true;
  return false;
}

export function isClaudeLivePath(file) {
  const normal = normalizeLivePath(file);
  if (!normal || !/\.jsonl$/i.test(normal) || IGNORED.test(normal) || CLAUDE_EXCLUDED.test(normal)) return false;
  if (isDashboardGeneratedClaudePath(normal)) return false;
  return /\/\.claude\/projects\//i.test(normal);
}

export function isCodexLivePath(file) {
  const normal = normalizeLivePath(file);
  return /\.jsonl$/i.test(normal) && !IGNORED.test(normal);
}

export function isLiveActivityPath(agent, file) {
  if (agent === 'Cursor') return isCursorLivePath(file);
  if (agent === 'Claude') return isClaudeLivePath(file);
  if (agent === 'Codex') return isCodexLivePath(file);
  return false;
}

export function claudeLiveDecision(file, previous, next) {
  if (!file || !isClaudeLivePath(file)) return { emit: false, keep: Boolean(next), reason: 'excluded-path' };
  if (!next) return { emit: false, keep: false, reason: 'missing-file' };
  if (!previous) return { emit: next.size > 0, keep: true, reason: next.size > 0 ? 'new-session-file' : 'empty-new-file' };
  if (next.size > previous.size) return { emit: true, keep: true, reason: 'session-growth' };
  return { emit: false, keep: true, reason: 'no-growth' };
}

export function cursorStorageRoot(homeDir, platform = process.platform) {
  if (platform === 'darwin') return `${homeDir}/Library/Application Support/Cursor/User/globalStorage`;
  if (platform === 'win32') return `${homeDir}/AppData/Roaming/Cursor/User/globalStorage`;
  return `${homeDir}/.config/Cursor/User/globalStorage`;
}
