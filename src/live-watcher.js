import fs from 'node:fs';

// The watcher owns only known adapter roots. It never reads file contents; it
// forwards the relative path and event kind to the dashboard parent, where the
// existing allowlists and structural parsers decide whether it is AI work.
const entries = (() => {
  try {
    const value = JSON.parse(process.argv[2] || '[]');
    return Array.isArray(value) ? value : [];
  } catch { return []; }
})();

const ignored = /(?:^|[\\/])(?:canvases|mcps|node_modules|\.git|\.dashboard-data|ai-dashboard)(?:[\\/]|$)/i;
const liveFile = (agent, file) => {
  if (!agent || ignored.test(file)) return false;
  if (agent === 'Cursor') return /\/agent-transcripts\/.*\.jsonl$/i.test(file) || /\/agent-tools\/[^/]+$/i.test(file);
  return /\.jsonl$/i.test(file);
};

function walk(root, agent, depth = 0) {
  if (depth > 8) return;
  let items;
  try { items = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const item of items) {
    const file = `${root}/${item.name}`;
    if (ignored.test(file)) continue;
    if (item.isDirectory()) walk(file, agent, depth + 1);
    else if (liveFile(agent, file)) {
      try {
        const stat = fs.statSync(file);
        process.send?.({ kind: 'baseline', agent, source: root, filename: file.slice(root.length + 1), size: stat.size, mtimeMs: stat.mtimeMs });
      } catch {}
    }
  }
}

for (const entry of entries) {
  const [, source, agent] = Array.isArray(entry) ? entry : [];
  if (!source) continue;
  if (typeof source !== 'string') continue;
  walk(source, agent);
  try {
    const watcher = fs.watch(source, { recursive: true }, (event, filename) => {
      try { process.send?.({ kind: 'event', agent: agent || null, source, filename: filename == null ? null : String(filename), event }); } catch {}
    });
    watcher.on('error', () => { try { watcher.close(); } catch {} });
  } catch {}
}

process.on('disconnect', () => process.exit(0));
