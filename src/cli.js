import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync, spawn as spawnProcess } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defaultSources, derive, scan, applyProjectMetadata, PROJECT_STATUSES, achievementsFor, SCHEMA_VERSION } from './core.js';
import { createSystemSampler, liveStateSnapshot, sessionFileSignal } from './activity.js';
import { readPlanCapacity } from './capacity.js';
import { shareableStack, manifest, privateInventory, publicMetricOptions, createSnapshot, shareCardSvg, setupPrompt } from './sharing.js';
import { claudeLiveDecision, cursorLiveDecision, isCursorTranscriptPath, isLiveActivityPath } from './live-files.js';
import { structuredAttentionFromFile } from './live-attention.js';
import { ClaudeToolTracker, cursorTranscriptHasAgentTurn, readAppendedJsonlRows } from './live-work.js';
import { loadSettings, saveSettings } from './config.js';
import { releaseInfo } from './release.js';
import { tokenReportFromCalendar } from './tokens.js';
import { buildOperator, lastSessionForProject, liveStatesFromEvents, projectHandoff, recentCapabilitiesForProject } from './resume.js';
import { detectAgents, launchAgent, openAgentCommand } from './open-agent.js';
import { lifecyclePaths } from './lifecycle/paths.js';
import { doctor } from './lifecycle/doctor.js';
import { readRuntime, runtimeToken, removeRuntimeIfOwned, writeRuntime } from './lifecycle/runtime-record.js';
import { appendLifecycleEvent, readLifecycleEvents } from './lifecycle/log.js';
import { configuredReportEndpoint, createBugReport, diagnosticsFromLocalState, submitBugReport, writeBugReportBundle } from './bug-report.js';
import { autostartPlan } from './lifecycle/autostart.js';
import { serviceStatus, startService, stopService } from './lifecycle/service.js';
import { createRediscoveryScheduler } from './rediscovery.js';
import { installMode, updateGitCheckout } from './lifecycle/update.js';
import { mergeObservedIdentities } from './runtime-registry.js';
import { createPresenceSampler } from './runtime-presence.js';
import { validateProjectRoots } from './onboarding.js';
import { createOpenRouterService } from './openrouter/service.js';
import { disableAntigravityCapture, enableAntigravityCapture, previewAntigravityCapture } from './antigravity.js';
import { applyEfficiencyMetadata, beginComparisonTracking, createCycle, loadEfficiencyMetadata, recordOutcome, removeCycle, saveEfficiencyMetadata } from './efficiency-store.js';
import { efficiencySnapshot } from './efficiency.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const paths = lifecyclePaths({ root });
const dataDir = paths.dataDir;
const indexFile = path.join(dataDir, 'index.json');
const projectMetaFile = path.join(dataDir, 'project-metadata.json');
const handoffFile = path.join(dataDir, 'handoffs.jsonl');
const snapshotsDir = path.join(dataDir, 'snapshots');
const openRouter = createOpenRouterService({ dataDir });
let liveIndex = null, liveIndexMtime = 0, lastReason = 'starting', refreshing = false;
const sampleSystem = createSystemSampler();
let latestSystem = sampleSystem(), latestCapacity = readPlanCapacity();
const liveActivityEvents = [], liveFileSizes = new Map(), liveFiles = new Map(), attentionSignals = new Map(), cursorLiveCarries = new Map(), previewSnapshots = new Map();
const claudeToolTracker = new ClaudeToolTracker();

function projectMetadata() { try { return JSON.parse(fs.readFileSync(projectMetaFile, 'utf8')); } catch { return { version: 1, projects: {} }; } }
function saveProjectMetadata(metadata) { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(projectMetaFile, JSON.stringify(metadata, null, 2)); }
function loadHandoffs() {
  try { return fs.readFileSync(handoffFile, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)); }
  catch { return []; }
}
function recordHandoff(entry) { fs.mkdirSync(dataDir, { recursive: true }); fs.appendFileSync(handoffFile, `${JSON.stringify(entry)}\n`); }
function decorate(result) {
  const identities = mergeObservedIdentities(result.observedIdentities || [], openRouter.state().cached?.models || []);
  const withMeta = applyProjectMetadata({ ...result, observedIdentities: identities }, projectMetadata());
  const handoffs = loadHandoffs();
  const metadata = beginComparisonTracking(loadEfficiencyMetadata(dataDir));
  if (metadata.comparison.instrumentationStartedAt) saveEfficiencyMetadata(dataDir, metadata);
  const foundation = applyEfficiencyMetadata(withMeta.efficiency?.foundation || {}, metadata);
  const decorated = { ...withMeta, efficiency: { ...(withMeta.efficiency || {}), foundation } };
  return { ...decorated, handoffs, achievements: achievementsFor(decorated, { handoffs }) };
}
function currentSources() { return defaultSources({ dataDir, settings: loadSettings(dataDir) }); }
function antigravityCliPresent() { return Boolean(index().sourceStates?.Antigravity?.installed?.evidence?.includes('binary')); }
function readStoredIndex() {
  try { return JSON.parse(fs.readFileSync(indexFile, 'utf8')); }
  catch { return null; }
}
function writeIndex(value) {
  const temporary = `${indexFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
  fs.renameSync(temporary, indexFile);
  try { liveIndexMtime = fs.statSync(indexFile).mtimeMs; } catch {}
}
function refresh(reason = 'manual') {
  if (refreshing) return liveIndex;
  refreshing = true;
  fs.mkdirSync(dataDir, { recursive: true });
  const previous = liveIndex || readStoredIndex();
  const result = scan(currentSources(), previous);
  result.summary.refreshReason = reason;
  // Persist safe connected-service model identities alongside local identities.
  // The cached aggregate is already local; this makes first/last-seen model
  // history survive service restarts without correlating it to a local agent.
  result.observedIdentities = mergeObservedIdentities(result.observedIdentities || [], openRouter.state().cached?.models || []);
  writeIndex(result);
  liveIndex = decorate(result);
  refreshing = false;
  return liveIndex;
}
function startupLoadingIndex() {
  const sources = currentSources();
  return derive({
    schemaVersion: SCHEMA_VERSION,
    metricVersion: 1,
    sources,
    repositories: [],
    sessions: [],
    rawCapabilities: [],
    capabilityUsageEvents: [],
    harnessRuns: [],
    editorHosts: [],
    sourceStates: {},
    adapterHealth: [],
    adapterManifests: [],
    observedIdentities: [],
    tokenVisualScale: null,
    permissions: sources.permissions,
    errors: [],
    diagnostics: { initialScan: 'pending' }
  });
}
function index() {
  if (liveIndex) {
    try {
      const mtime = fs.statSync(indexFile).mtimeMs;
      if (mtime > liveIndexMtime) {
        const stored = readStoredIndex();
        if (stored) { liveIndex = decorate(stored); liveIndexMtime = mtime; }
      }
    } catch {}
    return liveIndex;
  }
  if (!fs.existsSync(indexFile)) return refresh('startup');
  const stored = readStoredIndex();
  if (!stored) return refresh('index-recovery');
  const needsRescan = (stored.schemaVersion || 0) < SCHEMA_VERSION || (stored.sessions || []).some((session) => !session.provider || !session.host || (session.tokens && Object.values(session.tokens).some(Boolean) && !session.tokenDays));
  if (needsRescan) return refresh('schema-identity');
  try { liveIndexMtime = fs.statSync(indexFile).mtimeMs; } catch {}
  return (liveIndex = decorate(stored));
}
function body(req, { maxBytes = 8 * 1024 * 1024 } = {}) { return new Promise((resolve) => { let text = ''; let size = 0; let tooLarge = false; req.on('data', (d) => { size += Buffer.byteLength(d); if (size <= maxBytes) text += d; else tooLarge = true; }); req.on('end', () => { if (tooLarge) return resolve({ __error: 'request-too-large' }); try { resolve(JSON.parse(text || '{}')); } catch { resolve({}); } }); }); }

function dashboardVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version || null; } catch { return null; }
}
function dashboardCommit() {
  try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; } catch { return null; }
}
async function localBugDiagnostics() {
  const stored = readStoredIndex();
  // Avoid a loopback self-request while the diagnostics endpoint is being
  // served. The request can be useful from the stopped CLI, but from the
  // owned server process its runtime record is already authoritative.
  const runtime = readRuntime(paths.runtimeFile);
  const status = runtime?.pid === process.pid
    ? { state: 'running', runtime }
    : await serviceStatus(paths, path.resolve(process.argv[1]));
  const settings = loadSettings(dataDir);
  const recent = readLifecycleEvents(paths.lifecycleFile, 1).at(-1);
  const sourceStates = stored?.sourceStates || {};
  const adapters = Object.entries(sourceStates).map(([id, state]) => ({
    id,
    state: state?.connection?.state || state?.active?.state || state?.installed?.state || 'unknown',
    installed: state?.installed?.state === 'detected',
    historical: ['observed', 'historical'].includes(state?.history?.state),
    active: ['active', 'working'].includes(state?.active?.state),
    connected: state?.connection?.state === 'connected',
    capabilities: []
  }));
  return diagnosticsFromLocalState({
    dataDir,
    version: dashboardVersion(),
    commit: dashboardCommit(),
    dataSchemaVersion: stored?.schemaVersion || null,
    lifecycle: { state: status.state, port: status.runtime?.port || 4177, startupStage: recent?.stage || null, startupDurationMs: recent?.durationMs || null },
    permissions: settings.permissions,
    adapters,
    counts: { projects: stored?.projects?.length || stored?.repositories?.length || 0, sessions: stored?.sessions?.length || 0, capabilities: stored?.capabilities?.length || 0, usageObservations: stored?.efficiency?.foundation?.usageObservations?.length || 0 }
  });
}
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
      if (['.git', 'node_modules', '.dashboard-data', 'canvases', 'mcps', 'ai-dashboard'].includes(entry.name)) continue;
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
function emitLiveSignal(agent, candidate, previous, next) {
  const observedAt = Date.now();
  if (agent === 'Claude' && candidate && next) claudeToolTracker.observe(candidate, { previousSize: previous?.size ?? 0, at: observedAt });
  const attention = candidate ? structuredAttentionFromFile(agent, candidate, observedAt) : null;
  const previousSize = agent === 'Claude' ? (previous?.size ?? 0) : (previous?.size ?? next?.size ?? 0);
  const signal = sessionFileSignal({
    agent,
    timestamp: observedAt,
    previousSize,
    size: next?.size ?? previous?.size ?? 0,
    kind: candidate ? 'session-file-update' : 'source-directory-update'
  });
  if (candidate && next != null) {
    liveFiles.set(candidate, agent);
    liveFileSizes.set(candidate, next);
  }
  // Only an explicit unresolved attention request is sticky while the same
  // session is quiet. Normal completion is deliberately not an attention
  // marker; later local activity/resolution clears any request.
  if (attention) attentionSignals.set(agent, attention);
  else if (signal) attentionSignals.delete(agent);
  if (!signal) return;
  const mostRecent = liveActivityEvents.at(-1);
  if (mostRecent?.agent === signal.agent && mostRecent.kind === signal.kind && Date.now() - new Date(mostRecent.timestamp).getTime() < 350) liveActivityEvents[liveActivityEvents.length - 1] = signal;
  else liveActivityEvents.push(signal);
  const cutoff = Date.now() - 60_000;
  while (liveActivityEvents[0] && new Date(liveActivityEvents[0].timestamp).getTime() < cutoff) liveActivityEvents.shift();
}

function observeLivePath(agent, candidate) {
  if (agent && candidate && !isLiveActivityPath(agent, candidate)) return;
  const previous = liveFileSizes.get(candidate);
  const next = candidate ? (() => { try { const stat = fs.statSync(candidate); return { size: stat.size, mtimeMs: stat.mtimeMs }; } catch { return null; } })() : null;
  if (agent === 'Claude') {
    const decision = claudeLiveDecision(candidate, previous, next);
    if (!decision.keep) {
      if (candidate) {
        liveFiles.delete(candidate);
        liveFileSizes.delete(candidate);
      }
      claudeToolTracker.remove(candidate);
      return;
    }
    if (candidate && next != null) {
      liveFiles.set(candidate, agent);
      liveFileSizes.set(candidate, next);
    }
    if (!decision.emit) return;
    emitLiveSignal(agent, candidate, previous, next);
    return;
  }
  if (agent === 'Cursor') {
    if (!next) {
      liveFiles.delete(candidate);
      liveFileSizes.delete(candidate);
      cursorLiveCarries.delete(candidate);
      return;
    }
    let transcriptHasAgentTurn = false;
    const grew = !previous ? next.size > 0 : next.size > previous.size;
    if (grew && isCursorTranscriptPath(candidate)) {
      const parsed = readAppendedJsonlRows(candidate, previous?.size ?? 0, cursorLiveCarries.get(candidate) || '');
      cursorLiveCarries.set(candidate, parsed.carry);
      transcriptHasAgentTurn = cursorTranscriptHasAgentTurn(parsed.rows);
    }
    const decision = cursorLiveDecision(candidate, previous, next, { transcriptHasAgentTurn });
    liveFiles.set(candidate, agent);
    liveFileSizes.set(candidate, next);
    if (!decision.emit) return;
    emitLiveSignal(agent, candidate, previous, next);
    return;
  }
  if (candidate && next && previous && next.size === previous.size && next.mtimeMs === previous.mtimeMs) return;
  if (candidate && !next) {
    liveFiles.delete(candidate);
    liveFileSizes.delete(candidate);
    return;
  }
  emitLiveSignal(agent, candidate, previous, next);
}

function recordLiveActivity(agent, source, filename) {
  const candidate = filename ? path.resolve(source, String(filename)) : null;
  if (!candidate) return;
  observeLivePath(agent, candidate);
}
function pollLiveFiles() { for (const [file, agent] of liveFiles) observeLivePath(agent, file); }
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
function watchSources(rediscovery) {
  const sources = currentSources();
  let timer;
  const ignored = /(^|[\\/])(\.dashboard-data|\.git|node_modules|canvases|mcps|ai-dashboard)([\\/]|$)/;
  const changed = (agent, source, filename) => {
    const candidate = filename ? path.resolve(source, String(filename)) : '';
    if ((candidate && (candidate === dataDir || candidate.startsWith(`${dataDir}${path.sep}`))) || ignored.test(candidate)) return;
    if (agent) recordLiveActivity(agent, source, filename);
    clearTimeout(timer);
    timer = setTimeout(() => rediscovery.trigger(agent ? 'adapter source change' : 'project source change'), 25);
  };
  for (const [, source, agent] of sourceWatchList(sources)) {
    const attach = (options) => {
      const watcher = fs.watch(source, options, (_event, filename) => changed(agent, source, filename));
      // A system watch limit must not take down the local dashboard; scanning
      // and the periodic fallback remain available when a watch is unavailable.
      watcher.on('error', () => watcher.close());
      return watcher;
    };
    try { attach({ recursive: true }); }
    catch { try { attach({}); } catch {} }
  }
}
function availableAgentNames() {
  const detected = detectAgents();
  const installed = Object.entries(detected).filter(([, info]) => info?.available).map(([agent]) => agent);
  const live = index().runtimeCatalog?.liveRuntimes?.map((runtime) => runtime.agent).filter(Boolean) || [];
  return [...new Set([...installed, ...live])];
}
function capacitySnapshot() {
  return readPlanCapacity(undefined, { sourceStates: index().sourceStates || {} });
}
function presenceSampler() {
  return createPresenceSampler({ runtimes: index().runtimeCatalog?.liveRuntimes || [] });
}
let samplePresence = null;
function liveState() {
  const snapshot = liveStateSnapshot({ system: latestSystem, events: liveActivityEvents, capacity: latestCapacity });
  const claudeInProgress = claudeToolTracker.signal();
  const current = index();
  const runtimes = current.runtimeCatalog?.liveRuntimes || [];
  if (!samplePresence || samplePresence.runtimes !== runtimes) {
    samplePresence = presenceSampler();
    samplePresence.runtimes = runtimes;
  }
  const presenceStates = samplePresence();
  // Attention is an in-memory current condition, not durable history. A
  // confirmed runtime exit resolves it before the next process launch; a
  // reopened runtime must emit a fresh explicit request to become Needs You.
  for (const [agent, presence] of Object.entries(presenceStates)) {
    if (presence?.state === 'closed') attentionSignals.delete(agent);
  }
  snapshot.operator = buildOperator(current, liveActivityEvents, latestCapacity, { availableAgents: availableAgentNames(), attentionSignals: Object.fromEntries(attentionSignals), inProgressSignals: claudeInProgress ? { Claude: claudeInProgress } : {}, presenceStates });
  snapshot.presence = presenceStates;
  snapshot.agents = detectAgents();
  return snapshot;
}
function json(res, value, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(value));
}
function hasSession(req, token) { return String(req.headers.cookie || '').split(';').some((value) => value.trim() === `ai_dashboard_session=${token}`); }
export function serve({ port = 4177 } = {}) {
  const lifecycle = (event) => appendLifecycleEvent(paths.lifecycleFile, event);
  const startedAt = Date.now();
  lifecycle({ stage: 'serve-start', message: `Starting local dashboard on port ${port}.` });
  const sources = currentSources();
  const rediscovery = createRediscoveryScheduler({ run: refresh });
  let backgroundScan = null;
  const startBackgroundDiscovery = () => {
    if (backgroundScan && backgroundScan.exitCode == null) return;
    const scanStarted = Date.now();
    lifecycle({ stage: 'discovery-start', message: 'Initial local discovery started in a worker process.' });
    try {
      backgroundScan = spawnProcess(process.execPath, [path.resolve(process.argv[1]), 'scan'], { detached: true, stdio: 'ignore', env: { ...process.env, AI_DASHBOARD_DATA_DIR: dataDir } });
      backgroundScan.once('error', (error) => lifecycle({ stage: 'discovery-error', code: error?.code || 'DISCOVERY_ERROR', message: error?.message || 'Initial local discovery could not start.', durationMs: Date.now() - scanStarted }));
      backgroundScan.once('exit', (code, signal) => {
        backgroundScan = null;
        // Only invalidate the cached/loading view after a scan actually
        // produced a normalized index. A failed worker must not make the next
        // browser request synchronously retry the same expensive scan.
        if (code === 0 && fs.existsSync(indexFile)) liveIndex = null;
        lifecycle({ stage: code === 0 ? 'discovery-complete' : 'discovery-error', code: code === 0 ? null : 'DISCOVERY_EXIT', message: code === 0 ? 'Initial local discovery completed.' : `Initial local discovery exited (${signal || code}).`, durationMs: Date.now() - scanStarted });
      });
      backgroundScan.unref();
    } catch (error) {
      backgroundScan = null;
      lifecycle({ stage: 'discovery-error', code: error?.code || 'DISCOVERY_ERROR', message: error?.message || 'Initial local discovery could not start.', durationMs: Date.now() - scanStarted });
    }
  };
  // Seed the server from the cached index (or a cheap empty shape) before
  // binding. A first scan must never be required before loopback liveness.
  const stored = readStoredIndex();
  liveIndex = decorate(stored || startupLoadingIndex());
  if (stored) { try { liveIndexMtime = fs.statSync(indexFile).mtimeMs; } catch {} }
  latestCapacity = capacitySnapshot();
  rememberLiveFiles('Claude', sources.claudeRoot);
  rememberLiveFiles('Codex', sources.codexRoot);
  rememberLiveFiles('Cursor', sources.cursorRoot);
  if (sources.cursorStorageRoot) rememberLiveFiles('Cursor', sources.cursorStorageRoot);
  watchSources(rediscovery);
  rediscovery.start();
  setInterval(() => { latestSystem = sampleSystem(); }, 2_000).unref();
  setInterval(pollLiveFiles, 1_500).unref();
  setInterval(() => { latestCapacity = capacitySnapshot(); }, 60_000).unref();
  const publicDir = path.join(root, 'public');
  const controlToken = runtimeToken();
  const instanceId = runtimeToken();
  const sessionToken = runtimeToken();
  let localOrigin = `http://127.0.0.1:${port}`;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/health') return json(res, { state: 'ok', localOnly: true, instanceId: req.headers['x-ai-dashboard-control'] === controlToken ? instanceId : null });
    if (url.pathname === '/api/bug-report/diagnostics' && req.method === 'GET') {
      const diagnostics = await localBugDiagnostics();
      return json(res, { diagnostics, endpointConfigured: Boolean(configuredReportEndpoint()) });
    }
    if (url.pathname === '/api/control/stop' && req.method === 'POST') {
      const origin = req.headers.origin || '';
      if (req.headers['x-ai-dashboard-control'] !== controlToken || origin !== localOrigin) return json(res, { error: 'Unauthorized local control request.' }, 403);
      json(res, { state: 'stopping' });
      setTimeout(() => {
        server.close();
        // Browser keep-alive sockets must not make an owned stop appear to
        // fail indefinitely. This only closes connections on this server.
        server.closeAllConnections?.();
      }, 10).unref();
      return;
    }
    const writes = req.method === 'POST';
    if (writes && (req.headers.origin !== localOrigin || !hasSession(req, sessionToken))) return json(res, { error: 'Unauthorized local browser request.' }, 403);
    if (url.pathname === '/api/data') return json(res, index());
    if (url.pathname === '/api/efficiency' && req.method === 'GET') return json(res, efficiencySnapshot(index().efficiency?.foundation || {}, { period: url.searchParams.get('period') || '7d', remoteAnalytics: openRouter.state().cached }));
    if (url.pathname === '/api/openrouter' && req.method === 'GET') return json(res, openRouter.state());
    if (url.pathname === '/api/openrouter/connect' && req.method === 'POST') {
      try { const state = await openRouter.connect({ period: (await body(req)).period || 'today' }); refresh('openrouter sync'); return json(res, state); }
      catch (error) { return json(res, { ...openRouter.state(), error: error?.code || 'connector-error' }, 400); }
    }
    if (url.pathname === '/api/openrouter/sync' && req.method === 'POST') {
      try { const state = await openRouter.sync({ period: (await body(req)).period || 'today' }); refresh('openrouter sync'); return json(res, state); }
      catch (error) { return json(res, { ...openRouter.state(), error: error?.code || 'connector-error' }, 400); }
    }
    if (url.pathname === '/api/openrouter/disconnect' && req.method === 'POST') return json(res, openRouter.disconnect());
    if (url.pathname === '/api/antigravity/capture/preview' && req.method === 'GET') return json(res, previewAntigravityCapture(undefined, { cliPresent: antigravityCliPresent() }));
    if (url.pathname === '/api/antigravity/capture/enable' && req.method === 'POST') {
      const b = await body(req), settings = loadSettings(dataDir);
      try {
        // Confirming this endpoint is the explicit user authorization. It turns
        // on only the local-integration-write permission before touching the
        // documented Antigravity statusLine configuration.
        if (b.confirm !== true) return json(res, { error: 'confirmation-required', preview: previewAntigravityCapture(undefined, { cliPresent: antigravityCliPresent() }) }, 400);
        if (!antigravityCliPresent()) return json(res, { error: 'cli-unavailable', preview: previewAntigravityCapture(undefined, { cliPresent: false }) }, 400);
        const saved = saveSettings(dataDir, { permissions: { ...settings.permissions, localIntegrationWrite: true } });
        const result = enableAntigravityCapture(undefined, { permission: saved.permissions.localIntegrationWrite, confirmation: b.confirm === true, cliPresent: antigravityCliPresent() });
        refresh('antigravity capture enabled');
        return json(res, { ...result, preview: previewAntigravityCapture(undefined, { cliPresent: true }) });
      } catch (error) { return json(res, { error: error?.code || 'integration-error', preview: previewAntigravityCapture(undefined, { cliPresent: antigravityCliPresent() }) }, 400); }
    }
    if (url.pathname === '/api/antigravity/capture/disable' && req.method === 'POST') {
      const b = await body(req), settings = loadSettings(dataDir);
      try { const result = disableAntigravityCapture(undefined, { permission: settings.permissions.localIntegrationWrite, confirmation: b.confirm === true }); refresh('antigravity capture disabled'); return json(res, result); }
      catch (error) { return json(res, { error: error?.code || 'integration-error' }, 400); }
    }
    if (url.pathname === '/api/scan' && req.method === 'POST') return json(res, refresh('manual refresh'));
    const outcomeMatch = url.pathname.match(/^\/api\/efficiency\/work-blocks\/([^/]+)\/outcome$/);
    if (outcomeMatch && req.method === 'POST') {
      const workBlockId = decodeURIComponent(outcomeMatch[1]), b = await body(req), current = loadEfficiencyMetadata(dataDir);
      const known = (index().efficiency?.foundation?.workBlocks || []).some((item) => item.id === workBlockId);
      if (!known) return json(res, { error: 'Work block not found.' }, 404);
      saveEfficiencyMetadata(dataDir, recordOutcome(current, workBlockId, b.state));
      liveIndex = decorate(index());
      return json(res, efficiencySnapshot(liveIndex.efficiency.foundation, { period: b.period || '7d', remoteAnalytics: openRouter.state().cached }));
    }
    if (url.pathname === '/api/efficiency/cycles' && req.method === 'POST') {
      try {
        const b = await body(req), known = new Set((index().efficiency?.foundation?.workBlocks || []).map((item) => item.id));
        if (!Array.isArray(b.workBlockIds) || b.workBlockIds.some((id) => !known.has(id))) return json(res, { error: 'A selected work block was not found.' }, 400);
        const current = loadEfficiencyMetadata(dataDir), created = createCycle(current, b.workBlockIds, { privateLabel: b.privateLabel, taskKey: b.taskKey, taskCategory: b.taskCategory, validationContract: b.validationContract, capabilityConfiguration: b.capabilityConfiguration, capabilityConfigurationKnown: b.capabilityConfigurationKnown === true });
        saveEfficiencyMetadata(dataDir, created.metadata); liveIndex = decorate(index());
        return json(res, { cycle: created.cycle, foundation: liveIndex.efficiency.foundation });
      } catch (error) { return json(res, { error: error.message }, 400); }
    }
    const cycleMatch = url.pathname.match(/^\/api\/efficiency\/cycles\/([^/]+)$/);
    if (cycleMatch && req.method === 'DELETE') {
      const current = loadEfficiencyMetadata(dataDir); saveEfficiencyMetadata(dataDir, removeCycle(current, decodeURIComponent(cycleMatch[1]))); liveIndex = decorate(index());
      return json(res, { foundation: liveIndex.efficiency.foundation });
    }
    if (url.pathname === '/api/status') { const x = index(); return json(res, { state: 'Live', lastUpdated: x.summary.lastScanAt, reason: x.summary.refreshReason || lastReason, diagnostics: x.summary.diagnostics }); }
    if (url.pathname === '/api/bug-report' && req.method === 'POST') {
      const b = await body(req);
      if (b.__error === 'request-too-large') return json(res, { error: 'Bug report is too large. Use one PNG, JPEG, or WebP screenshot under 5 MB.' }, 413);
      try {
        const includeDiagnostics = b.includeDiagnostics !== false;
        const diagnostics = includeDiagnostics ? (b.diagnostics || await localBugDiagnostics()) : {};
        const report = createBugReport({ description: b.description, context: b.context, includeDiagnostics, diagnostics, screenshot: b.includeScreenshot === false ? null : b.screenshot });
        const saved = writeBugReportBundle(dataDir, report, { screenshot: b.includeScreenshot === false ? null : b.screenshot });
        let submission = { state: 'not-configured', reportId: report.reportId };
        if (b.send === true) submission = await submitBugReport(report, { screenshot: b.includeScreenshot === false ? null : b.screenshot });
        return json(res, { state: submission.state === 'sent' ? 'sent' : 'saved', reportId: report.reportId, relativeDirectory: saved.relativeDirectory, endpointConfigured: Boolean(configuredReportEndpoint()), submission });
      } catch (error) { return json(res, { error: error?.message || 'Could not save the bug report.' }, 400); }
    }
    if (url.pathname === '/api/live-state') { res.setHeader('Cache-Control', 'no-store, max-age=0'); return json(res, liveState()); }
    if (url.pathname === '/api/live') { res.setHeader('Cache-Control', 'no-store, max-age=0'); return json(res, liveState().activity); }
    if (url.pathname === '/api/system') { res.setHeader('Cache-Control', 'no-store, max-age=0'); return json(res, latestSystem); }
    if (url.pathname === '/api/operator') return json(res, liveState().operator);
    if (url.pathname === '/api/release') return json(res, releaseInfo(loadSettings(dataDir)));
    if (url.pathname === '/api/tokens') {
      const period = url.searchParams.get('period') || 'today';
      const current = index();
      return json(res, current.tokenReports?.[period] || tokenReportFromCalendar(current.tokenCalendar || { days: {} }, period, new Date(), { knownAgents: current.summary?.agents || [], unavailableAgents: {} }));
    }
    if (url.pathname === '/api/settings' && req.method === 'GET') return json(res, { ...loadSettings(dataDir), projectsRoots: currentSources().projectsRoots, needsProjectRoot: !(currentSources().projectsRoots || []).length });
    if (url.pathname === '/api/settings' && req.method === 'POST') {
      const b = await body(req);
      const roots = Array.isArray(b.projectsRoots) ? b.projectsRoots : b.projectsRoot ? [b.projectsRoot] : null;
      if (roots) {
        const checked = validateProjectRoots(roots);
        if (!checked.valid) return json(res, { error: checked.errors.join(' ') }, 400);
        b.projectsRoots = checked.roots;
      }
      const saved = saveSettings(dataDir, roots ? { projectsRoots: b.projectsRoots, onboarding: b.onboarding } : b);
      // Appearance is a local browser preference; saving it must not trigger a
      // scan, telemetry parse, or connected-service request.
      if (roots || b.permissions || b.connectedServices) refresh('settings change');
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
      const id = decodeURIComponent(metaMatch[1]), b = await body(req), known = (index().repositories || index().projects).find((p) => p.id === id);
      if (!known) return json(res, { error: 'Project not found' }, 404);
      const metadata = projectMetadata(), current = metadata.projects[id] || {};
      const next = { ...current, pinned: typeof b.pinned === 'boolean' ? b.pinned : Boolean(current.pinned), status: PROJECT_STATUSES.includes(b.status) ? b.status : (b.status === null ? null : current.status || null), note: typeof b.note === 'string' ? b.note.slice(0, 500) : current.note || '', repositoryClass: ['Project','Tool','Reference','Unknown','Hidden'].includes(b.repositoryClass) ? b.repositoryClass : current.repositoryClass || null, canonicalPath: known.canonicalPath };
      if (!next.pinned && !next.status && !next.note && !next.repositoryClass) delete metadata.projects[id];
      else metadata.projects[id] = next;
      saveProjectMetadata(metadata);
      liveIndex = decorate({ ...index(), summary: { ...index().summary, lastScanAt: index().summary.lastScanAt } });
      return json(res, (liveIndex.repositories || liveIndex.projects).find((p) => p.id === id));
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
    if (path.relative(publicDir, full).startsWith('..') || path.isAbsolute(path.relative(publicDir, full)) || !fs.existsSync(full)) { res.statusCode = 404; return res.end('Not found'); }
    if (asset === 'index.html') res.setHeader('Set-Cookie', `ai_dashboard_session=${sessionToken}; HttpOnly; SameSite=Strict; Path=/`);
    res.setHeader('Content-Type', contentType(full));
    res.end(fs.readFileSync(full));
  });
  server.once('close', () => {
    if (backgroundScan && backgroundScan.exitCode == null) { try { backgroundScan.kill('SIGTERM'); } catch {} }
    if (removeRuntimeIfOwned(paths.runtimeFile, { pid: process.pid, instanceId })) lifecycle({ stage: 'server-close', message: 'Owned dashboard server stopped.' });
  });
  server.once('error', (error) => {
    const message = `Dashboard server failed: ${error.message}`;
    console.error(message);
    lifecycle({ stage: 'server-error', code: error.code || 'SERVER_ERROR', message, durationMs: Date.now() - startedAt });
    // A failed second process must never erase a healthy process's ownership
    // record. Only the instance that wrote runtime.json may remove it.
    removeRuntimeIfOwned(paths.runtimeFile, { pid: process.pid, instanceId });
  });
  server.listen(port, '127.0.0.1', () => {
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    const url = `http://127.0.0.1:${actualPort}`;
    localOrigin = url;
    writeRuntime(paths.runtimeFile, { version: 1, pid: process.pid, script: path.resolve(process.argv[1]), startedAt: new Date().toISOString(), url, port: actualPort, instanceId, controlToken, dataDir });
    lifecycle({ stage: 'listening', message: `Loopback server listening on port ${actualPort}.`, durationMs: Date.now() - startedAt });
    console.log(`AI Development Dashboard → ${url}`);
    // A prior index is only a cache. Bind first so `open` remains responsive,
    // then perform discovery in a child process so a slow local scan cannot
    // block health, stop, or the first browser request.
    // Keep a short liveness window after bind. Discovery is synchronous local
    // work today; delaying it lets `open` complete its health handshake before
    // a slow project scan can occupy the event loop. The UI/API can then load
    // the same cached data while discovery continues.
    const startupDiscoveryDelayMs = 50;
    lifecycle({ stage: 'discovery-scheduled', message: `Initial local discovery scheduled in ${startupDiscoveryDelayMs}ms.` });
    setTimeout(() => {
      startBackgroundDiscovery();
    }, startupDiscoveryDelayMs).unref();
  });
  return server;
}

function argValue(args, name, fallback = null) { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; }
async function openBrowser(url) {
  if (process.platform === 'darwin') { (await import('node:child_process')).spawn('open', [url], { detached: true, stdio: 'ignore' }).unref(); return true; }
  if (process.platform === 'win32') { (await import('node:child_process')).spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref(); return true; }
  return false;
}
export async function main(args = process.argv.slice(2)) {
  const command = args[0] || 'serve';
  const script = path.resolve(process.argv[1]);
  const requestedPort = argValue(args, '--port', '4177');
  const port = Number.isInteger(Number(requestedPort)) && Number(requestedPort) >= 0 ? Number(requestedPort) : 4177;
  if (['help', '--help', '-h'].includes(command)) {
    console.log('AI Development Dashboard\n\nUsage: ai-dashboard <command>\n\nCommands:\n  open [--port N]  Start the owned local service and open the dashboard\n  status           Show owned service status\n  stop             Stop only the owned dashboard service\n  update           Safely update dashboard software (not AI tools/models)\n  report-bug       Save a privacy-safe local bug report bundle\n  doctor           Check local lifecycle health\n  scan             Run one local index scan\n  serve            Run the local server in the foreground');
    return 0;
  }
  if (command === 'report-bug') {
    let description = argValue(args, '--description', null);
    if (!description && process.stdin.isTTY) {
      const readline = await import('node:readline/promises');
      const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
      try { description = await prompt.question('What happened? '); } finally { prompt.close(); }
    }
    description ||= 'Dashboard startup or runtime issue. Add details before sharing this bundle.';
    const includeDiagnostics = !args.includes('--no-diagnostics');
    const diagnostics = includeDiagnostics ? await localBugDiagnostics() : {};
    const report = createBugReport({ description, includeDiagnostics, diagnostics });
    const saved = writeBugReportBundle(dataDir, report);
    let submission = null;
    if (args.includes('--send')) submission = await submitBugReport(report);
    console.log(`Report bundle created: ${saved.relativeDirectory}\nReport ID: ${report.reportId}`);
    if (submission?.state === 'sent') console.log(`Report sent. Reference: ${submission.reference}`);
    else if (submission?.state === 'error') console.log(`Report submission failed; the local bundle was preserved. ${submission.error}`);
    else if (configuredReportEndpoint()) console.log('A report endpoint is configured, but nothing was sent. Re-run with --send to submit explicitly.');
    else console.log('No report endpoint is configured. Attach this local bundle to your support request manually.');
    return 0;
  }
  if (command === 'scan') { const data = refresh(); console.log(`Indexed ${data.projects.length} projects, ${data.sessions.length} sessions, ${data.capabilities.length} capabilities.`); return 0; }
  if (command === 'serve') { serve({ port }); return 0; }
  if (command === 'start' || command === 'open') {
    const status = await startService({ paths, script, port, lifecycleLog: (event) => appendLifecycleEvent(paths.lifecycleFile, event) });
    if (status.state !== 'running') {
      console.error(`AI Dashboard could not start.\n\nReason: ${status.error || 'Unable to start dashboard.'}\n\nTry:\n  ai-dashboard doctor\n  ai-dashboard report-bug`);
      return 1;
    }
    if (command === 'open' && !args.includes('--no-open')) await openBrowser(status.runtime.url);
    console.log(status.runtime.url); return 0;
  }
  if (command === 'status') { const status = await serviceStatus(paths, script); console.log(args.includes('--json') ? JSON.stringify(status, null, 2) : `${status.state}${status.runtime?.url ? ` ${status.runtime.url}` : ''}`); return status.state === 'error' ? 1 : 0; }
  if (command === 'stop') { const status = await stopService({ paths, script }); console.log(status.state); return status.state === 'error' ? 1 : 0; }
  if (command === 'doctor') { const result = doctor(paths, script); console.log(args.includes('--json') ? JSON.stringify(result, null, 2) : result.ok ? 'ok' : 'needs attention'); return result.ok ? 0 : 1; }
  if (command === 'setup') {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const status = await startService({ paths, script, port, lifecycleLog: (event) => appendLifecycleEvent(paths.lifecycleFile, event) });
    if (status.state !== 'running') { console.error(`AI Dashboard could not start.\n\nReason: ${status.error || 'Unable to start dashboard setup.'}\n\nTry:\n  ai-dashboard doctor\n  ai-dashboard report-bug`); return 1; }
    if (!args.includes('--no-open')) await openBrowser(status.runtime.url);
    console.log(`Dashboard setup is ready at ${status.runtime.url}`); return 0;
  }
  if (command === 'autostart') { const plan = autostartPlan({ command: 'ai-dashboard', dataDir }); console.log(JSON.stringify({ ...plan, state: 'disabled', note: 'Autostart is opt-in. This Phase 1 command previews the per-user plan only.' }, null, 2)); return 0; }
  if (command === 'update') {
    // This is an explicit dashboard-software update command. It is never used
    // during startup/discovery and it never updates agents, models, skills, or
    // connected services.
    const before = await serviceStatus(paths, script);
    const result = updateGitCheckout(installMode({ script }));
    if (!['current', 'updated'].includes(result.state)) { console.error(result.message || 'Dashboard update was not performed.'); return 1; }
    if (result.state === 'current') { console.log(`Already up to date. ${result.head || ''}`.trim()); return 0; }
    if (result.dependencyManifestChanged) {
      const lock = ['package-lock.json', 'npm-shrinkwrap.json'].find((name) => fs.existsSync(path.join(result.root, name)));
      if (lock) {
        try { (await import('node:child_process')).execFileSync('npm', ['ci'], { cwd: result.root, stdio: 'inherit' }); }
        catch { console.error('Dashboard code updated, but deterministic dependency installation failed. The owned service was left unchanged.'); return 1; }
      }
    }
    if (before.state === 'running') {
      const stopped = await stopService({ paths, script });
      if (stopped.state !== 'stopped') { console.error('Dashboard updated, but the owned service could not be stopped cleanly.'); return 1; }
      const restarted = await startService({ paths, script, port });
      if (restarted.state !== 'running') { console.error('Dashboard updated, but the owned service did not restart cleanly.'); return 1; }
      console.log(`Updated successfully. Dashboard restarted. ${restarted.runtime.url}`); return 0;
    }
    console.log(`Updated successfully. ${result.previousHead?.slice(0, 8) || 'previous'} → ${result.head?.slice(0, 8) || 'current'}`); return 0;
  }
  if (command === 'uninstall') { console.log(JSON.stringify({ state: 'preview', package: 'Use your npm package manager to remove the package.', retainedData: dataDir, autostart: 'No job is installed by this Phase 1 foundation.' }, null, 2)); return 0; }
  console.error('Usage: ai-dashboard [serve|scan|setup|start|open|status|stop|doctor|report-bug|autostart|update|uninstall]'); return 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().then((code) => { if (code) process.exitCode = code; });
