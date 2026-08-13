const IGNORED = /(?:^|[\\/])(?:canvases|mcps|node_modules|\.git|\.dashboard-data)(?:[\\/]|$)/i;

export function normalizeLivePath(file) {
  return String(file || '').replace(/\\/g, '/');
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
  return /\.jsonl$/i.test(normal) && !IGNORED.test(normal);
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

export function cursorStorageRoot(homeDir, platform = process.platform) {
  if (platform === 'darwin') return `${homeDir}/Library/Application Support/Cursor/User/globalStorage`;
  if (platform === 'win32') return `${homeDir}/AppData/Roaming/Cursor/User/globalStorage`;
  return `${homeDir}/.config/Cursor/User/globalStorage`;
}
