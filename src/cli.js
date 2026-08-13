import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { defaultSources, scan, applyProjectMetadata, PROJECT_STATUSES, achievementsFor } from './core.js';
import { createSystemSampler, liveStateSnapshot, sessionFileSignal } from './activity.js';
import { readPlanCapacity } from './capacity.js';
import { shareableStack, manifest, privateInventory, publicMetricOptions, createSnapshot, shareCardSvg, setupPrompt } from './sharing.js';
import { isLiveActivityPath } from './live-files.js';
import { loadSettings, saveSettings } from './config.js';
import { buildOperator, lastSessionForProject, liveStatesFromEvents, projectHandoff, recentCapabilitiesForProject } from './resume.js';
import { detectAgents, launchAgent, openAgentCommand } from './open-agent.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, '.dashboard-data');
const indexFile = path.join(dataDir, 'index.json');
const projectMetaFile = path.join(dataDir, 'project-metadata.json');
const handoffFile = path.join(dataDir, 'handoffs.jsonl');
const snapshotsDir = path.join(dataDir, 'snapshots');
let liveIndex = null, lastReason = 'starting', refreshing = false;
const sampleSystem = createSystemSampler();
let latestSystem = sampleSystem(), latestCapacity = readPlanCapacity();
const liveActivityEvents = [], liveFileSizes = new Map(), liveFiles = new Map(), previewSnapshots = new Map();

function projectMetadata() { try { return JSON.parse(fs.readFileSync(projectMetaFile, 'utf8')); } catch { return { version: 1, projects: {} }; } }
function saveProjectMetadata(metadata) { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(projectMetaFile, JSON.stringify(metadata, null, 2)); }
function loadHandoffs() {
  try { return fs.readFileSync(handoffFile, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)); }
  catch { return []; }
}
function recordHandoff(entry) { fs.mkdirSync(dataDir, { recursive: true }); fs.appendFileSync(handoffFile, `${JSON.stringify(entry)}\n`); }
function decorate(result) {
  const withMeta = applyProjectMetadata(result, projectMetadata());
  const handoffs = loadHandoffs();
  return { ...withMeta, handoffs, achievements: achievementsFor(withMeta, { handoffs }) };
}
function currentSources() { return defaultSources({ dataDir, settings: loadSettings(dataDir) }); }
function refresh(reason = 'manual') {
  if (refreshing) return liveIndex;
  refreshing = true;
  fs.mkdirSync(dataDir, { recursive: true });
  const previous = liveIndex || (fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : null);
  const result = scan(currentSources(), previous);
  result.summary.refreshReason = reason;
  fs.writeFileSync(indexFile, JSON.stringify(result, null, 2));
  liveIndex = decorate(result);
  refreshing = false;
  return liveIndex;
}
function index() { return liveIndex || (fs.existsSync(indexFile) ? (liveIndex = decorate(JSON.parse(fs.readFileSync(indexFile, 'utf8')))) : refresh('startup')); }
function body(req) { return new Promise((resolve) => { let text = ''; req.on('data', (d) => text += d); req.on('end', () => { try { resolve(JSON.parse(text || '{}')); } catch { resolve({}); } }); }); }
function contentType(file) {
  if (file.endsWith('.js')) return 'text/javascript';
  if (file.endsWith('.css')) return 'text/css';
  if (file.endsWith('.html')) return 'text/html';
  if (file.endsWith('.png')) return 'image/png';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  if (file.endsWith('.json')) return 'application/json';
  return 'application/octet-stream';
}
function rememberPreview(snapshot) {
  previewSnapshots.set(snapshot.id, snapshot);
  while (previewSnapshots.size > 12) previewSnapshots.delete(previewSnapshots.keys().next().value);
}
function snapshotById(id) {
  return previewSnapshots.get(id) || (id && fs.existsSync(path.join(snapshotsDir, `${id}.json`)) ? JSON.parse(fs.readFileSync(path.join(snapshotsDir, `${id}.json`), 'utf8')) : null);
}
function rememberLiveFiles(agent, dir, depth = 0) {
  if (depth > 6) return;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['.git', 'node_modules', '.dashboard-data', 'canvases', 'mcps'].includes(entry.name)) continue;
      rememberLiveFiles(agent, file, depth + 1);
      continue;
    }
    if (!isLiveActivityPath(agent, file)) continue;
    try {
      const stat = fs.statSync(file);
      liveFiles.set(file, agent);
      liveFileSizes.set(file, { size: stat.size, mtimeMs: stat.mtimeMs });
    } catch {}
  }
}
function recordLiveActivity(agent, source, filename) {
  const candidate = filename ? path.resolve(source, String(filename)) : null;
  if (agent && candidate && !isLiveActivityPath(agent, candidate)) return;
  const previous = liveFileSizes.get(candidate);
  const next = candidate ? (() => { try { const stat = fs.statSync(candidate); return { size: stat.size, mtimeMs: stat.mtimeMs }; } catch { return null; } })() : null;
  if (candidate && next && previous && next.size === previous.size && next.mtimeMs === previous.mtimeMs) return;
  const signal = sessionFileSignal({ agent, timestamp: Date.now(), previousSize: previous?.size ?? next?.size ?? 0, size: next?.size ?? previous?.size ?? 0, kind: candidate ? 'session-file-update' : 'source-directory-update' });
  if (candidate && next != null) { liveFiles.set(candidate, agent); liveFileSizes.set(candidate, next); }
  if (!signal) return;
  const mostRecent = liveActivityEvents.at(-1);
  if (mostRecent?.agent === signal.agent && mostRecent.kind === signal.kind && Date.now() - new Date(mostRecent.timestamp).getTime() < 350) liveActivityEvents[liveActivityEvents.length - 1] = signal;
  else liveActivityEvents.push(signal);
  const cutoff = Date.now() - 60_000;
  while (liveActivityEvents[0] && new Date(liveActivityEvents[0].timestamp).getTime() < cutoff) liveActivityEvents.shift();
}
function pollLiveFiles() { for (const [file, agent] of liveFiles) recordLiveActivity(agent, path.dirname(file), path.basename(file)); }
function sourceWatchList(sources) {
  const list = [];
  for (const [key, value] of Object.entries(sources)) {
    if (key === 'projectsRoots' && Array.isArray(value)) {
      value.forEach((dir, i) => list.push([`projectsRoot${i}`, dir, null]));
      continue;
    }
    if (typeof value !== 'string' || !value) continue;
    const agent = { claudeRoot: 'Claude', codexRoot: 'Codex', cursorRoot: 'Cursor', cursorStorageRoot: 'Cursor' }[key] || null;
    list.push([key, value, agent]);
  }
  return list;
}
function watchSources() {
  const sources = currentSources();
  let timer;
  const ignored = /(^|[\\/])(\.dashboard-data|\.git|node_modules|canvases|mcps)([\\/]|$)/;
  const changed = (agent, source, filename) => {
    const candidate = filename ? path.resolve(source, String(filename)) : '';
    if ((candidate && (candidate === dataDir || candidate.startsWith(`${dataDir}${path.sep}`))) || ignored.test(candidate)) return;
    if (agent) { recordLiveActivity(agent, source, filename); return; }
    clearTimeout(timer);
    timer = setTimeout(() => refresh('project source change'), 7_500);
  };
  for (const [, source, agent] of sourceWatchList(sources)) {
    try { fs.watch(source, { recursive: true }, (_event, filename) => changed(agent, source, filename)); }
    catch { try { fs.watch(source, (_event, filename) => changed(agent, source, filename)); } catch {} }
  }
  setInterval(() => refresh('periodic check'), 300000).unref();
}
function availableAgentNames() {
  const detected = detectAgents();
  return ['Claude', 'Codex', 'Cursor'].filter((agent) => detected[agent]?.available);
}
function liveState() {
  const snapshot = liveStateSnapshot({ system: latestSystem, events: liveActivityEvents, capacity: latestCapacity });
  snapshot.operator = buildOperator(index(), liveActivityEvents, latestCapacity, { availableAgents: availableAgentNames().length ? availableAgentNames() : ['Claude', 'Codex', 'Cursor'] });
  snapshot.agents = detectAgents();
  return snapshot;
}
function json(res, value, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(value));
}
function serve() {
  refresh('startup');
  const sources = currentSources();
  rememberLiveFiles('Claude', sources.claudeRoot);
  rememberLiveFiles('Codex', sources.codexRoot);
  rememberLiveFiles('Cursor', sources.cursorRoot);
  if (sources.cursorStorageRoot) rememberLiveFiles('Cursor', sources.cursorStorageRoot);
  watchSources();
  setInterval(() => { latestSystem = sampleSystem(); }, 2_000).unref();
  setInterval(pollLiveFiles, 1_500).unref();
  setInterval(() => { latestCapacity = readPlanCapacity(); }, 60_000).unref();
  const publicDir = path.join(root, 'public');
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/data') return json(res, index());
    if (url.pathname === '/api/scan' && req.method === 'POST') return json(res, refresh('manual refresh'));
    if (url.pathname === '/api/status') { const x = index(); return json(res, { state: 'Live', lastUpdated: x.summary.lastScanAt, reason: x.summary.refreshReason || lastReason, diagnostics: x.summary.diagnostics }); }
    if (url.pathname === '/api/live-state') { res.setHeader('Cache-Control', 'no-store, max-age=0'); return json(res, liveState()); }
    if (url.pathname === '/api/live') { res.setHeader('Cache-Control', 'no-store, max-age=0'); return json(res, liveState().activity); }
    if (url.pathname === '/api/system') { res.setHeader('Cache-Control', 'no-store, max-age=0'); return json(res, latestSystem); }
    if (url.pathname === '/api/operator') return json(res, liveState().operator);
    if (url.pathname === '/api/settings' && req.method === 'GET') return json(res, { ...loadSettings(dataDir), projectsRoots: currentSources().projectsRoots });
    if (url.pathname === '/api/settings' && req.method === 'POST') {
      const b = await body(req);
      const roots = Array.isArray(b.projectsRoots) ? b.projectsRoots : b.projectsRoot ? [b.projectsRoot] : null;
      const saved = saveSettings(dataDir, roots ? { projectsRoots: roots.filter(Boolean) } : b);
      refresh('settings change');
      return json(res, { ...saved, projectsRoots: currentSources().projectsRoots });
    }
    if (url.pathname === '/api/export/stack') return json(res, shareableStack(index()));
    if (url.pathname === '/api/export/manifest') return json(res, manifest(index()));
    if (url.pathname === '/api/export/private') return json(res, privateInventory(index()));
    if (url.pathname === '/api/export/setup-prompt') { res.setHeader('Content-Type', 'text/plain; charset=utf-8'); return res.end(setupPrompt(index())); }
    if (url.pathname === '/api/share/options') return json(res, publicMetricOptions(index(), url.searchParams.get('period') || 'month'));
    if (url.pathname === '/api/share/snapshot' && req.method === 'POST') {
      const b = await body(req);
      try {
        const persist = b.preview !== true;
        const snapshot = createSnapshot(index(), b.metrics, b.format, snapshotsDir, b.period || 'month', b.visual || {}, { persist });
        if (!persist) rememberPreview(snapshot);
        return json(res, snapshot);
      } catch (e) { return json(res, { error: e.message }, 400); }
    }
    if (url.pathname === '/api/share/card.svg') {
      const snapshot = snapshotById(url.searchParams.get('snapshot'));
      if (!snapshot) { res.statusCode = 404; return res.end('Snapshot not found'); }
      res.setHeader('Content-Type', 'image/svg+xml');
      return res.end(shareCardSvg(snapshot));
    }
    const metaMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/metadata$/);
    if (metaMatch && req.method === 'POST') {
      const id = decodeURIComponent(metaMatch[1]), b = await body(req), known = index().projects.find((p) => p.id === id);
      if (!known) return json(res, { error: 'Project not found' }, 404);
      const metadata = projectMetadata(), current = metadata.projects[id] || {};
      const next = { ...current, pinned: typeof b.pinned === 'boolean' ? b.pinned : Boolean(current.pinned), status: PROJECT_STATUSES.includes(b.status) ? b.status : (b.status === null ? null : current.status || null), note: typeof b.note === 'string' ? b.note.slice(0, 500) : current.note || '', canonicalPath: known.canonicalPath };
      if (!next.pinned && !next.status && !next.note) delete metadata.projects[id];
      else metadata.projects[id] = next;
      saveProjectMetadata(metadata);
      liveIndex = decorate({ ...index(), summary: { ...index().summary, lastScanAt: index().summary.lastScanAt } });
      return json(res, liveIndex.projects.find((p) => p.id === id));
    }
    const handoffMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/handoff$/);
    if (handoffMatch && req.method === 'POST') {
      const id = decodeURIComponent(handoffMatch[1]), b = await body(req), known = index().projects.find((p) => p.id === id);
      if (!known) return json(res, { error: 'Project not found' }, 404);
      const last = lastSessionForProject(index().sessions, id);
      const liveStates = liveStatesFromEvents(liveActivityEvents);
      const markdown = projectHandoff(known, { lastAgent: last?.agent || null, agentState: last?.agent ? liveStates[last.agent] : null, capabilities: recentCapabilitiesForProject(index(), id), includeNote: b.includeNote !== false });
      const entry = { projectId: id, fromAgent: last?.agent || null, toAgent: b.toAgent || null, at: new Date().toISOString() };
      recordHandoff(entry);
      liveIndex = decorate(index());
      return json(res, { markdown, handoff: entry });
    }
    const openMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/open$/);
    if (openMatch && req.method === 'POST') {
      const id = decodeURIComponent(openMatch[1]), b = await body(req), known = index().projects.find((p) => p.id === id);
      if (!known) return json(res, { error: 'Project not found' }, 404);
      const plan = openAgentCommand(b.agent, known.canonicalPath);
      if (!plan.ok) return json(res, plan, 400);
      return json(res, launchAgent(plan));
    }
    let asset = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//, '');
    asset = path.normalize(asset);
    const full = path.join(publicDir, asset);
    if (!full.startsWith(publicDir) || !fs.existsSync(full)) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('Content-Type', contentType(full));
    res.end(fs.readFileSync(full));
  });
  server.listen(4177, '127.0.0.1', () => console.log('AI Development Dashboard → http://127.0.0.1:4177'));
}
if (process.argv[2] === 'scan') { const data = refresh(); console.log(`Indexed ${data.projects.length} projects, ${data.sessions.length} sessions, ${data.capabilities.length} capabilities.`); } else serve();
