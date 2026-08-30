import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFile, execFileSync, spawn as spawnProcess } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defaultAdapterRegistry, defaultSources, derive, scan, applyProjectMetadata, PROJECT_STATUSES, achievementsFor, SCHEMA_VERSION } from './core.js';
import { createSystemSampler, liveStateSnapshot, sessionFileSignal } from './activity.js';
import { readPlanCapacity } from './capacity.js';
import { shareableStack, manifest, privateInventory, publicMetricOptions, createSnapshot, shareCardSvg, setupPrompt } from './sharing.js';
import { claudeLiveDecision, cursorLiveDecision, isCursorTranscriptPath, isLiveActivityPath } from './live-files.js';
import { structuredAttentionFromFile } from './live-attention.js';
import { clineSnapshotBootstrapEligible, ClaudeToolTracker, ClineSessionTracker, CursorTurnTracker, cursorTranscriptBootstrapEligible, cursorTranscriptHasAgentTurn, readAppendedJsonlRows } from './live-work.js';
import { CLINE_DB_LIVE_MAX_AGE_MS, clineDbActiveEligible, clineHostForInstallation, clineHostForPath, clineInstallation, clineLiveDecision, readClineSessionDbMetadata, readClineSessionMetadata } from './cline.js';
import { hermesInstallation, readHermesLiveSnapshotAsync, reconcileHermesLiveTurns } from './hermes.js';
import { loadSettings, saveSettings } from './config.js';
import { releaseInfo } from './release.js';
import { tokenReportFromCalendar } from './tokens.js';
import { buildOperator, lastSessionForProject, liveStatesFromEvents, projectHandoff, recentCapabilitiesForProject } from './resume.js';
import { detectAgents, launchAgent, openAgentCommand } from './open-agent.js';
import { lifecyclePaths } from './lifecycle/paths.js';
import { doctor, doctorAsync } from './lifecycle/doctor.js';
import { readRuntime, runtimeToken, removeRuntimeIfOwned, writeRuntime } from './lifecycle/runtime-record.js';
import { appendLifecycleEvent, readLifecycleEvents } from './lifecycle/log.js';
import { configuredReportEndpoint, createBugReport, diagnosticsFromLocalState, submitBugReport, writeBugReportBundle } from './bug-report.js';
import { autostartPlan } from './lifecycle/autostart.js';
import { serviceStatus, startService, stopService } from './lifecycle/service.js';
import { createRediscoveryScheduler } from './rediscovery.js';
import { installMode, updateGitCheckout } from './lifecycle/update.js';
import { mergeObservedIdentities, runtimeCatalogForLiveEvidence } from './runtime-registry.js';
import { localInferenceServices } from './local-inference.js';
import { createPresenceSampler, presenceSamplerKey, PRESENCE_POLL_MS, processNameProbeCommand, processNameSnapshot, processSnapshotCommand, processSnapshotFromOutput } from './runtime-presence.js';
import { validateProjectRoots } from './onboarding.js';
import { createOpenRouterService } from './openrouter/service.js';
import { disableAntigravityCapture, enableAntigravityCapture, previewAntigravityCapture } from './antigravity.js';
import { writeChunkedText } from './response-stream.js';
import { applyEfficiencyMetadata, beginComparisonTracking, createCycle, loadEfficiencyMetadata, recordOutcome, removeCycle, saveEfficiencyMetadata } from './efficiency-store.js';
import { efficiencySnapshot } from './efficiency.js';
import { buildDashboardService, buildRuntimeServices, createRuntimeResourceSampler, normalizeDiagnostics, runtimeStatusSnapshot } from './runtime-resources.js';
import { DASHBOARD_SERVICE_ID, publicPortOwner } from './lifecycle/port-owner.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const paths = lifecyclePaths({ root });
const dataDir = paths.dataDir;
const indexFile = path.join(dataDir, 'index.json');
const viewFile = path.join(dataDir, 'index-view.json');
const viewMetaFile = path.join(dataDir, 'index-view-meta.json');
const projectMetaFile = path.join(dataDir, 'project-metadata.json');
const handoffFile = path.join(dataDir, 'handoffs.jsonl');
const snapshotsDir = path.join(dataDir, 'snapshots');
const openRouter = createOpenRouterService({ dataDir });
let liveIndex = null, liveIndexMtime = 0, liveViewJson = null, liveViewMtime = 0, lastReason = 'starting', refreshing = false;
// Keep lifecycle-only CLI commands cheap. System sampling and capacity scans
// touch local process/filesystem state and are initialized only by the server,
// never while importing `cli.js` for status/stop/doctor.
let sampleSystem = null, runtimeResourceSampler = null, latestSystem = null, latestCapacity = null;
const liveActivityEvents = [], liveFileSizes = new Map(), liveFiles = new Map(), attentionSignals = new Map(), cursorLiveCarries = new Map(), previewSnapshots = new Map();
const claudeToolTracker = new ClaudeToolTracker();
const cursorTurnTracker = new CursorTurnTracker();
const clineSessionTracker = new ClineSessionTracker();
let liveClineInstallation = null, liveClineInstallationAt = 0, clineDbPollInFlight = false, clineDbPollTimer = null;
let liveHermesInstallation = null, liveHermesInstallationAt = 0, hermesLivePollInFlight = false, hermesLivePollTimer = null, hermesLiveTurns = [];
const liveDecisionTrace = [], liveDecisionKeys = new Map();
const LIVE_DECISION_TRACE_LIMIT = 120;
const presenceProbeTrace = [];
const PRESENCE_PROBE_TRACE_LIMIT = 120;
const liveLoopTrace = [];
const LIVE_LOOP_TRACE_LIMIT = 120;

function traceSessionHash(value) { return value ? crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16) : null; }
function recordLiveDecision({ adapter, sessionHash = null, host = null, rawLifecycle = null, lastStructuralActivityAt = null, normalizedState = null, reason = null } = {}) {
  const entry = { timestamp: new Date().toISOString(), adapter, sessionHash, host, rawLifecycle, lastStructuralActivityAt, normalizedState, reason };
  const key = [adapter, sessionHash || '-', rawLifecycle || '-', normalizedState || '-', reason || '-'].join('|');
  const traceScope = sessionHash || rawLifecycle || 'state';
  if (liveDecisionKeys.get(`${adapter}|${traceScope}`) === key) return;
  liveDecisionKeys.set(`${adapter}|${traceScope}`, key);
  liveDecisionTrace.push(entry);
  while (liveDecisionTrace.length > LIVE_DECISION_TRACE_LIMIT) liveDecisionTrace.shift();
}
function recordPresenceProbe(entry) {
  presenceProbeTrace.push(entry);
  while (presenceProbeTrace.length > PRESENCE_PROBE_TRACE_LIMIT) presenceProbeTrace.shift();
}
function recordLiveLoop(kind, startedAt, details = {}) {
  liveLoopTrace.push({ timestamp: new Date().toISOString(), kind, durationMs: Date.now() - startedAt, ...details });
  while (liveLoopTrace.length > LIVE_LOOP_TRACE_LIMIT) liveLoopTrace.shift();
}

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
function clineInstallationForLive() {
  if (!liveClineInstallation || Date.now() - liveClineInstallationAt > 60_000) {
    liveClineInstallation = clineInstallation({ homeDir: process.env.HOME, env: process.env, platform: process.platform });
    liveClineInstallationAt = Date.now();
  }
  return liveClineInstallation;
}
function hermesInstallationForLive() {
  if (!liveHermesInstallation || Date.now() - liveHermesInstallationAt > 60_000) {
    liveHermesInstallation = hermesInstallation({ homeDir: process.env.HOME, env: process.env });
    liveHermesInstallationAt = Date.now();
  }
  return liveHermesInstallation;
}
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
function writeView(value) {
  const temporary = `${viewFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(temporary, viewFile);
  try {
    liveViewMtime = fs.statSync(viewFile).mtimeMs;
    liveViewJson = fs.readFileSync(viewFile, 'utf8');
  } catch {}
  try {
    const metaTemporary = `${viewMetaFile}.${process.pid}.tmp`;
    fs.writeFileSync(metaTemporary, JSON.stringify({
      summary: value.summary || {},
      runtimeCatalog: value.runtimeCatalog || { liveRuntimes: [], runtimes: [] },
      sourceStates: value.sourceStates || {},
      adapterManifests: value.adapterManifests || [],
      observedIdentities: value.observedIdentities || []
    }), { mode: 0o600 });
    fs.renameSync(metaTemporary, viewMetaFile);
  } catch {}
}
function applyCachedViewMeta() {
  try {
    const value = JSON.parse(fs.readFileSync(viewMetaFile, 'utf8'));
    if (value && typeof value === 'object') liveIndex = { ...(liveIndex || startupLoadingIndex()), ...value };
  } catch {}
  return liveIndex;
}
function cachedViewJson() {
  try {
    const mtime = fs.statSync(viewFile).mtimeMs;
    if (!liveViewJson || mtime > liveViewMtime) {
      liveViewJson = fs.readFileSync(viewFile, 'utf8');
      liveViewMtime = mtime;
    }
  } catch {}
  return liveViewJson || JSON.stringify(liveIndex || startupLoadingIndex());
}
function cachedViewTag() {
  try {
    const stat = fs.statSync(viewFile);
    return `W/\"${Math.round(stat.mtimeMs)}-${stat.size}\"`;
  } catch { return null; }
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
  writeView(liveIndex);
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
  if (liveIndex?.diagnostics?.initialScan === 'pending' && fs.existsSync(viewFile)) {
    try {
      liveIndex = JSON.parse(fs.readFileSync(viewFile, 'utf8'));
      liveViewJson = fs.readFileSync(viewFile, 'utf8');
      liveViewMtime = fs.statSync(viewFile).mtimeMs;
      return liveIndex;
    } catch {}
  }
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
function dashboardIdentity() { return { service: DASHBOARD_SERVICE_ID, version: dashboardVersion(), commit: dashboardCommit() }; }
async function localBugDiagnostics() {
  const stored = readStoredIndex();
  // Avoid a loopback self-request while the diagnostics endpoint is being
  // served. The request can be useful from the stopped CLI, but from the
  // owned server process its runtime record is already authoritative.
  const runtime = readRuntime(paths.runtimeFile);
  const status = runtime?.pid === process.pid
    ? { state: 'running', runtime, port: runtime.port, portOwner: { classification: 'dashboard', verified: true, occupied: true, health: { state: 'healthy' } } }
    : await serviceStatus(paths, path.resolve(process.argv[1]), { expectedBuild: dashboardIdentity() });
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
    lifecycle: {
      state: status.state,
      port: status.runtime?.port || status.port || 4177,
      portOccupied: status.portOwner?.occupied === true,
      portOwner: publicPortOwner(status.portOwner)?.state || null,
      healthState: status.health || status.portOwner?.health?.state || null,
      startupStage: recent?.stage || null,
      startupDurationMs: recent?.durationMs || null
    },
    permissions: settings.permissions,
    adapters,
    counts: { projects: stored?.projects?.length || stored?.repositories?.length || 0, sessions: stored?.sessions?.length || 0, capabilities: stored?.capabilities?.length || 0, usageObservations: stored?.efficiency?.foundation?.usageObservations?.length || 0 },
    liveDecisions: liveDecisionTrace.slice(-40)
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

function observeLivePath(agent, candidate, { bootstrap = false } = {}) {
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
      cursorTurnTracker.remove(candidate);
      return;
    }
    let transcriptHasAgentTurn = false;
    let cursorLifecycle = { started: false, completed: false, active: false };
    const grew = !previous ? next.size > 0 : next.size > previous.size;
    // New files and watcher baselines can be a currently-running Cursor turn.
    // Parse only their bounded structural tail while it is fresh; an old
    // transcript never becomes work merely because Cursor is open.
    const bootstrapTranscript = isCursorTranscriptPath(candidate)
      && (!previous || bootstrap)
      && cursorTranscriptBootstrapEligible(next.mtimeMs);
    if (isCursorTranscriptPath(candidate) && ((grew && previous) || bootstrapTranscript)) {
      const parsed = readAppendedJsonlRows(candidate, bootstrapTranscript ? 0 : previous?.size ?? 0, cursorLiveCarries.get(candidate) || '');
      cursorLiveCarries.set(candidate, parsed.carry);
      transcriptHasAgentTurn = cursorTranscriptHasAgentTurn(parsed.rows);
      cursorLifecycle = cursorTurnTracker.observe(candidate, parsed.rows, Date.now());
    }
    const decision = cursorLiveDecision(candidate, previous, next, { transcriptHasAgentTurn });
    liveFiles.set(candidate, agent);
    liveFileSizes.set(candidate, next);
    if (isCursorTranscriptPath(candidate) && (cursorLifecycle.started || cursorLifecycle.completed || bootstrapTranscript)) {
      recordLiveDecision({
        adapter: 'cursor', sessionHash: traceSessionHash(candidate), host: 'Cursor',
        rawLifecycle: cursorLifecycle.completed ? 'turn-ended' : (cursorLifecycle.active ? 'turn-active' : 'no-active-turn'),
        lastStructuralActivityAt: new Date(next.mtimeMs).toISOString(),
        normalizedState: cursorLifecycle.active ? 'Working' : (cursorLifecycle.completed ? 'Recently Active' : 'Idle'),
        reason: cursorLifecycle.completed ? 'completion' : (cursorLifecycle.active ? (bootstrapTranscript ? 'restart-bootstrap' : 'turn-running') : 'no-active-turn')
      });
    }
    if (!decision.emit && !cursorLifecycle.started && !cursorLifecycle.completed) return;
    emitLiveSignal(agent, candidate, previous, next);
    return;
  }
  if (agent === 'Cline') {
    if (!next) {
      liveFiles.delete(candidate);
      liveFileSizes.delete(candidate);
      clineSessionTracker.remove(candidate);
      return;
    }
    const metadata = readClineSessionMetadata(candidate, { hostHint: clineHostForPath(candidate, clineInstallationForLive()) });
    // A baseline is not itself work evidence.  It may bootstrap a currently
    // running Cline turn only when the structured active snapshot was updated
    // recently.  Older active snapshots remain watchable but cannot become
    // Working until a fresh lifecycle/fingerprint change arrives.
    if (bootstrap && !clineSnapshotBootstrapEligible(metadata, next?.mtimeMs)) {
      liveFiles.set(candidate, agent);
      liveFileSizes.set(candidate, next);
      return;
    }
    const lifecycle = clineSessionTracker.observe(candidate, metadata, Date.now());
    const decision = clineLiveDecision(candidate, previous, next, metadata);
    liveFiles.set(candidate, agent);
    liveFileSizes.set(candidate, next);
    // A completed snapshot may be touched repeatedly by the host. Only the
    // first tracker transition (or genuine growth) is a live signal; unchanged
    // status writes must not create zero-byte pulses that pin Working forever.
    if (!(lifecycle.started || lifecycle.completed || (decision.emit && decision.reason === 'session-growth'))) return;
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

function seedLivePath(agent, source, filename, size, mtimeMs) {
  const candidate = filename ? path.resolve(source, String(filename)) : null;
  if (!candidate || !isLiveActivityPath(agent, candidate)) return;
  if (agent === 'Cursor') return observeLivePath(agent, candidate, { bootstrap: true });
  liveFiles.set(candidate, agent);
  liveFileSizes.set(candidate, { size: Number(size) || 0, mtimeMs: Number(mtimeMs) || 0 });
}
function recordLiveActivity(agent, source, filename, kind = 'event', size = null, mtimeMs = null) {
  const candidate = filename ? path.resolve(source, String(filename)) : null;
  if (!candidate) return;
  if (kind === 'baseline') {
    if (agent === 'Cline') return observeLivePath(agent, candidate, { bootstrap: true });
    return seedLivePath(agent, source, filename, size, mtimeMs);
  }
  observeLivePath(agent, candidate);
}
function pollLiveFiles() {
  const startedAt = Date.now(), trackedFiles = liveFiles.size;
  for (const [file, agent] of liveFiles) observeLivePath(agent, file);
  recordLiveLoop('live-file-poll', startedAt, { trackedFiles });
}

function appendClineLifecycleEvent(metadata, kind = 'cline-structured-lifecycle') {
  const now = Date.now();
  const recent = liveActivityEvents.at(-1);
  if (recent?.agent === 'Cline' && now - new Date(recent.timestamp).getTime() < 1_000) return;
  liveActivityEvents.push(sessionFileSignal({
    agent: 'Cline',
    host: metadata?.host || 'Cursor',
    model: metadata?.route?.model || null,
    timestamp: now,
    kind,
    previousSize: 0,
    size: 0
  }));
  const cutoff = now - 60_000;
  while (liveActivityEvents[0] && new Date(liveActivityEvents[0].timestamp).getTime() < cutoff) liveActivityEvents.shift();
}

// The session JSON is intentionally retained for history and file-local
// lifecycle events. Cline 4.1.14's SDK, however, updates the allowlisted
// sessions.db row while a task is waiting on a remote model or running a
// tool. Poll that small metadata source off the HTTP path and merge by
// session id in ClineSessionTracker. No database reads are performed by
// /api/live-state itself.
async function pollClineSessionDatabase() {
  if (clineDbPollInFlight) return;
  const installation = clineInstallationForLive();
  if (!installation?.dbFile) return;
  clineDbPollInFlight = true;
  try {
    const rows = await readClineSessionDbMetadata(installation.dbFile, { hostHint: clineHostForInstallation(installation) || 'Cursor', timeoutMs: 900 });
    const now = Date.now();
    for (const metadata of rows) {
      // A historical row can remain marked running after a crash. Only a
      // freshly updated active row may bootstrap/refresh Working. Terminal
      // rows are still applied so a known task clears immediately.
      if (metadata.status === 'active' && !clineDbActiveEligible(metadata, now, CLINE_DB_LIVE_MAX_AGE_MS)) continue;
      const lifecycle = clineSessionTracker.observe(`db:${metadata.id}`, metadata, now);
      if (lifecycle.completed && metadata.sourceType === 'cline-session-db') appendClineLifecycleEvent(metadata);
    }
  } finally {
    clineDbPollInFlight = false;
  }
}

// Hermes's durable per-turn lease is current lifecycle evidence. It is
// deliberately stronger than an open Desktop/CLI session or a recent file mtime.
async function pollHermesLiveState() {
  if (hermesLivePollInFlight) return;
  hermesLivePollInFlight = true;
  try {
    const now = Date.now(), result = await readHermesLiveSnapshotAsync({ installation: hermesInstallationForLive(), now, timeoutMs: 900 });
    const previous = hermesLiveTurns.filter((turn) => new Date(turn.leaseUntil).getTime() > now);
    if (['ok', 'partial'].includes(result.probe.state)) {
      const reconciliation = reconcileHermesLiveTurns(previous, result, now);
      const completed = reconciliation.completed;
      hermesLiveTurns = reconciliation.turns;
      for (const turn of result.turns) recordLiveDecision({ adapter: 'hermes', sessionHash: turn.sessionHash, host: turn.host, rawLifecycle: 'lease-active', lastStructuralActivityAt: turn.since, normalizedState: 'Working', reason: 'turn-running' });
      for (const event of completed) recordLiveDecision({ adapter: 'hermes', sessionHash: event.sessionHash, host: event.host, rawLifecycle: 'lease-released', normalizedState: 'Recently Active', reason: 'completion' });
      for (const event of completed) {
        const signal = sessionFileSignal({ ...event, previousSize: 0, size: 0 });
        if (signal) liveActivityEvents.push(signal);
      }
    } else {
      // The source did not answer; preserve only the lease timestamp Hermes
      // itself persisted. This is not a fabricated extension of Working.
      hermesLiveTurns = previous;
      recordLiveDecision({ adapter: 'hermes', rawLifecycle: result.probe.state, normalizedState: previous.length ? 'Working' : 'Idle', reason: previous.length ? 'probe-unavailable-lease-retained' : 'unsupported-state' });
    }
    const cutoff = now - 60_000;
    while (liveActivityEvents[0] && new Date(liveActivityEvents[0].timestamp).getTime() < cutoff) liveActivityEvents.shift();
  }
  finally { hermesLivePollInFlight = false; }
}

function sourceWatchList(sources) {
  const list = [];
  const watchKeys = new Set(['claudeRoot', 'codexRoot', 'cursorRoot', 'cursorStorageRoot', 'clineSessionsRoot', 'antigravityRoot', 'antigravityCliRoot']);
  for (const [key, value] of Object.entries(sources)) {
    // Project roots and the home directory are intentionally not watched:
    // they can contain millions of Dropbox/application files. Adapter roots
    // below are bounded and the rediscovery timer remains the fallback.
    if (!watchKeys.has(key) || typeof value !== 'string' || !value) continue;
    const agent = { claudeRoot: 'Claude', codexRoot: 'Codex', cursorRoot: 'Cursor', cursorStorageRoot: 'Cursor', clineSessionsRoot: 'Cline' }[key] || null;
    list.push([key, value, agent]);
  }
  return list;
}
function startLiveWatcherWorker(sources, rediscovery, lifecycle) {
  const entries = sourceWatchList(sources);
  if (!entries.length) return null;
  try {
    const worker = spawnProcess(process.execPath, [path.join(root, 'src', 'live-watcher.js'), JSON.stringify(entries)], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    worker.on('message', (event) => {
      if (event?.agent && event?.source && event?.filename) recordLiveActivity(event.agent, event.source, event.filename, event.kind, event.size, event.mtimeMs);
      if (event?.kind !== 'baseline') rediscovery.trigger(event?.agent ? 'adapter source change' : 'source change');
    });
    worker.on('error', (error) => lifecycle({ stage: 'watcher-error', code: error?.code || 'WATCHER_ERROR', message: error?.message || 'Local source watcher unavailable.' }));
    worker.on('exit', (code, signal) => { if (code !== 0 && signal !== 'SIGTERM') lifecycle({ stage: 'watcher-exit', code: 'WATCHER_EXIT', message: `Local source watcher exited (${signal || code}).` }); });
    return worker;
  } catch (error) {
    lifecycle({ stage: 'watcher-error', code: error?.code || 'WATCHER_ERROR', message: error?.message || 'Local source watcher unavailable.' });
    return null;
  }
}
function availableAgentNames(current = index(), runtimeCatalog = current.runtimeCatalog) {
  const detected = detectAgents();
  const installed = Object.entries(detected).filter(([, info]) => info?.available).map(([agent]) => agent);
  const live = runtimeCatalog?.liveRuntimes?.map((runtime) => runtime.agent).filter(Boolean) || [];
  return [...new Set([...installed, ...live])];
}
function capacitySnapshot() {
  // Capacity is a low-frequency panel. It must not force the full normalized
  // index (which can be tens of megabytes) onto the HTTP event loop while the
  // health/live-state endpoints are serving. The scan worker publishes the
  // small metadata view; use that when available and fall back to the loading
  // shape rather than synchronously hydrating historical records here.
  const current = applyCachedViewMeta() || startupLoadingIndex();
  return readPlanCapacity(undefined, { sourceStates: current.sourceStates || {} });
}
function presenceSampler(runtimes = null) {
  return createPresenceSampler({
    runtimes: runtimes || index().runtimeCatalog?.liveRuntimes || [],
    snapshot: () => {
      // Process enumeration is asynchronous. If the last callback is outside
      // the bounded freshness window, let createPresenceSampler preserve a
      // short stale-good state and then surface Presence Unknown.
      if (!latestPresenceAt || Date.now() - latestPresenceAt > PRESENCE_POLL_MS * 2) return { ...latestPresenceSnapshot, reliable: false };
      return latestPresenceSnapshot;
    }
  });
}
let samplePresence = null, samplePresenceKey = null, sampleCursorPresence = null, sampleCursorPresenceKey = null;
let latestPresenceSnapshot = { reliable: false, commands: [], checkedAt: null, reason: 'The local process snapshot has not completed yet.' };
let latestPresenceAt = 0, latestCursorPresenceSnapshot = { reliable: false, commands: [], checkedAt: null, reason: 'The Cursor process probe has not completed yet.' }, latestCursorPresenceAt = 0;
let presencePollTimer = null, presencePollSequence = 0, cursorPresencePollSequence = 0;
let presencePollInFlight = false, cursorPresencePollInFlight = false;
function pollPresenceSnapshot() {
  if (presencePollInFlight) return;
  presencePollInFlight = true;
  const sequence = ++presencePollSequence, startedAt = Date.now();
  execFile(processSnapshotCommand(), ['-axo', 'comm='], { encoding: 'utf8', timeout: 3_000, maxBuffer: 512 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }, (error, stdout) => {
    presencePollInFlight = false;
    const durationMs = Date.now() - startedAt;
    if (error) {
      const code = String(error.code || 'PROCESS_SNAPSHOT_ERROR').replace(/[^A-Z0-9_-]/gi, '').slice(0, 48);
      latestPresenceSnapshot = { reliable: false, commands: [], checkedAt: new Date().toISOString(), reason: `The local process snapshot was unavailable (${code}).` };
      recordPresenceProbe({ timestamp: new Date().toISOString(), sequence, target: 'declared-runtime-executables', durationMs, probe: error.killed ? 'timeout' : 'failed', errorCode: code, cursorMainMatched: null });
      return;
    }
    latestPresenceSnapshot = processSnapshotFromOutput(stdout);
    latestPresenceAt = Date.now();
    recordPresenceProbe({ timestamp: new Date().toISOString(), sequence, target: 'declared-runtime-executables', durationMs, probe: 'success', errorCode: null, cursorMainMatched: String(stdout || '').split(/\r?\n/).some((value) => value.trim().endsWith('/Cursor.app/Contents/MacOS/Cursor')) });
  });
}
function pollCursorPresenceSnapshot() {
  if (cursorPresencePollInFlight) return;
  cursorPresencePollInFlight = true;
  const sequence = ++cursorPresencePollSequence, startedAt = Date.now(), probe = processNameProbeCommand('Cursor');
  execFile(probe.command, probe.args, { encoding: 'utf8', timeout: 750, maxBuffer: 1024, stdio: ['ignore', 'pipe', 'ignore'] }, (error) => {
    cursorPresencePollInFlight = false;
    latestCursorPresenceSnapshot = processNameSnapshot('cursor', { error });
    if (latestCursorPresenceSnapshot.reliable) latestCursorPresenceAt = Date.now();
    const absent = Number(error?.code) === 1;
    const code = error && !absent ? String(error.code || 'PROCESS_PROBE_ERROR').replace(/[^A-Z0-9_-]/gi, '').slice(0, 48) : null;
    recordPresenceProbe({ timestamp: new Date().toISOString(), sequence, target: 'cursor-main-executable', durationMs: Date.now() - startedAt, probe: !error ? 'success' : absent ? 'absent' : error.killed ? 'timeout' : 'failed', errorCode: code, cursorMainMatched: !error });
  });
}
function startPresencePolling() {
  pollPresenceSnapshot();
  pollCursorPresenceSnapshot();
  if (presencePollTimer) clearInterval(presencePollTimer);
  presencePollTimer = setInterval(() => { pollPresenceSnapshot(); pollCursorPresenceSnapshot(); }, PRESENCE_POLL_MS);
  presencePollTimer.unref?.();
}
function sampleRuntimeResources() {
  const startedAt = Date.now();
  latestSystem = runtimeResourceSampler ? runtimeResourceSampler() : sampleSystem?.() || null;
  recordLiveLoop('resource-sample', startedAt);
}
function liveState() {
  const current = applyCachedViewMeta() || index();
  const claudeInProgress = claudeToolTracker.signal();
  const cursorInProgress = cursorTurnTracker.signal();
  const clineInProgress = clineSessionTracker.signal();
  const activeHermesTurns = hermesLiveTurns.filter((turn) => new Date(turn.leaseUntil).getTime() > Date.now());
  const hermesInProgress = activeHermesTurns.length ? { active: true, since: activeHermesTurns.map((turn) => turn.since).filter(Boolean).sort()[0] || new Date().toISOString(), source: 'hermes-durable-turn-lease', confidence: 'Structured', reason: 'Hermes holds a current durable turn lease.', model: activeHermesTurns[0].model || null, provider: activeHermesTurns[0].provider || null, gateway: activeHermesTurns[0].gateway || null, host: activeHermesTurns[0].host || 'Hermes Agent' } : null;
  const liveAgents = [...new Set([
    ...liveActivityEvents.map((event) => event.agent).filter(Boolean),
    ...(claudeInProgress ? ['Claude'] : []),
    ...(cursorInProgress ? ['Cursor'] : []),
    ...(clineInProgress ? ['Cline'] : []),
    ...(hermesInProgress ? ['Hermes Agent'] : [])
  ])];
  const manifests = current.adapterManifests?.length ? current.adapterManifests : defaultAdapterRegistry().manifests();
  const provisionalCatalog = runtimeCatalogForLiveEvidence(current.runtimeCatalog || {}, manifests, liveAgents, { Cline: clineHostForInstallation(clineInstallationForLive()) || 'Cursor', 'Hermes Agent': hermesInProgress?.host || 'Hermes Agent' }, { Cline: clineInProgress || {}, 'Hermes Agent': hermesInProgress || {} });
  // Presence starts from discovered runtimes, rather than the current live
  // catalog. Otherwise an open Cursor with no AI history cannot ever earn its
  // required Idle lane. Cline remains gated by its own discovery state.
  const knownRuntimes = new Set((current.runtimeCatalog?.liveRuntimes || []).map((runtime) => runtime.id));
  const runtimes = provisionalCatalog.runtimes.filter((runtime) => runtime.liveCapable && (knownRuntimes.has(runtime.id) || current.sourceStates?.[runtime.sourceKey]?.installed?.state === 'detected' || liveAgents.includes(runtime.agent)));
  const nextPresenceSamplerKey = presenceSamplerKey(runtimes);
  if (!samplePresence || samplePresenceKey !== nextPresenceSamplerKey) {
    samplePresence = presenceSampler(runtimes);
    samplePresenceKey = nextPresenceSamplerKey;
  }
  const genericPresenceStates = samplePresence();
  const cursorRuntime = runtimes.find((runtime) => runtime.agent === 'Cursor');
  if (cursorRuntime) {
    const nextCursorPresenceSamplerKey = presenceSamplerKey([cursorRuntime]);
    if (!sampleCursorPresence || sampleCursorPresenceKey !== nextCursorPresenceSamplerKey) {
      sampleCursorPresence = createPresenceSampler({
        runtimes: [cursorRuntime],
        snapshot: () => {
          if (!latestCursorPresenceAt || Date.now() - latestCursorPresenceAt > PRESENCE_POLL_MS * 2) return { ...latestCursorPresenceSnapshot, reliable: false };
          return latestCursorPresenceSnapshot;
        }
      });
      sampleCursorPresenceKey = nextCursorPresenceSamplerKey;
    }
  }
  const cursorPresence = sampleCursorPresence?.() || {};
  const presenceStates = { ...genericPresenceStates, ...cursorPresence };
  const liveCatalog = runtimeCatalogForLiveEvidence(current.runtimeCatalog || {}, manifests, liveAgents, { Cline: clineHostForInstallation(clineInstallationForLive()) || 'Cursor', 'Hermes Agent': hermesInProgress?.host || 'Hermes Agent' }, { Cline: clineInProgress || {}, 'Hermes Agent': hermesInProgress || {} }, { presentAgents: Object.entries(presenceStates).filter(([, presence]) => presence?.state === 'present').map(([agent]) => agent) });
  const snapshot = liveStateSnapshot({ system: latestSystem, events: liveActivityEvents, capacity: latestCapacity, runtimeCatalog: liveCatalog });
  // Attention is an in-memory current condition, not durable history. A
  // confirmed runtime exit resolves it before the next process launch; a
  // reopened runtime must emit a fresh explicit request to become Needs You.
  for (const [agent, presence] of Object.entries(presenceStates)) {
    if (presence?.state === 'closed') {
      attentionSignals.delete(agent);
      if (agent === 'Claude') claudeToolTracker.clear();
      if (agent === 'Cursor') cursorTurnTracker.clear();
      if (agent === 'Cline') clineSessionTracker.clear();
      if (agent === 'Hermes Agent') hermesLiveTurns = [];
    }
  }
  snapshot.operator = buildOperator(current, liveActivityEvents, latestCapacity, { availableAgents: availableAgentNames(current, liveCatalog), attentionSignals: Object.fromEntries(attentionSignals), inProgressSignals: { ...(claudeInProgress ? { Claude: claudeInProgress } : {}), ...(cursorInProgress ? { Cursor: cursorInProgress } : {}), ...(clineInProgress ? { Cline: clineInProgress } : {}), ...(hermesInProgress ? { 'Hermes Agent': hermesInProgress } : {}) }, presenceStates });
  for (const agent of ['Cursor', 'Hermes Agent']) {
    const state = snapshot.operator.liveStates?.[agent];
    if (!state) continue;
    const presence = presenceStates[agent]?.state;
    recordLiveDecision({ adapter: agent === 'Cursor' ? 'cursor' : 'hermes', host: agent === 'Cursor' ? 'Cursor' : hermesInProgress?.host || null, rawLifecycle: state.state === 'Working' ? 'turn-active' : 'no-active-turn', normalizedState: state.state, reason: state.state === 'Working' ? (agent === 'Cursor' ? 'turn-running' : 'lease-active') : (presence === 'present' ? 'runtime-present' : (presence === 'closed' ? 'host-closed' : 'presence-unknown')) });
  }
  snapshot.presence = presenceStates;
  snapshot.agents = detectAgents();
  snapshot.liveDiagnostics = { bounded: true, privacy: 'Structural lifecycle metadata only; no prompts, responses, code, paths, tool payloads, or credentials.', decisions: liveDecisionTrace.slice(-80), presenceProbes: presenceProbeTrace.slice(-80), loopTimings: liveLoopTrace.slice(-80) };
  return snapshot;
}
function json(res, value, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(value));
}
function jsonText(res, text, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(text);
}
function hasSession(req, token) { return String(req.headers.cookie || '').split(';').some((value) => value.trim() === `ai_dashboard_session=${token}`); }
export function serve({ port = 4177 } = {}) {
  const lifecycle = (event) => appendLifecycleEvent(paths.lifecycleFile, event);
  const startedAt = Date.now();
  const identity = dashboardIdentity();
  lifecycle({ stage: 'serve-start', message: `Starting local dashboard on port ${port}.` });
  const sources = currentSources();
  let backgroundScan = null;
  let pendingScanReason = null;
  const rediscovery = createRediscoveryScheduler({ run: (reason) => startBackgroundDiscovery(reason) });
  let watcherProcess = null;
  let capacityProcess = null;
  let serverBound = false;
  let serverFailed = false;
  let restartRequested = false;
  let restartTimer = null;
  let postBindTimer = null;
  let startupDiscoveryTimer = null;
  const startBackgroundDiscovery = (reason = 'startup discovery') => {
    if (serverFailed || !serverBound) return { state: 'unavailable', reason };
    if (backgroundScan && backgroundScan.exitCode == null) {
      pendingScanReason ||= reason;
      return { state: 'coalesced', reason };
    }
    const scanStarted = Date.now();
    lifecycle({ stage: 'discovery-start', message: 'Initial local discovery started in a worker process.' });
    try {
      backgroundScan = spawnProcess(process.execPath, [path.resolve(process.argv[1]), 'scan'], { detached: true, stdio: 'ignore', env: { ...process.env, AI_DASHBOARD_DATA_DIR: dataDir } });
      backgroundScan.once('error', (error) => lifecycle({ stage: 'discovery-error', code: error?.code || 'DISCOVERY_ERROR', message: error?.message || 'Initial local discovery could not start.', durationMs: Date.now() - scanStarted }));
      backgroundScan.once('exit', (code, signal) => {
        backgroundScan = null;
        // The worker writes an atomically replaced decorated view. Keep the
        // lightweight in-memory state for live polling; `/api/data` picks up
        // the view text without reparsing/deriving on the server.
        if (code === 0 && fs.existsSync(viewFile)) {
          liveViewJson = null;
          liveViewMtime = 0;
        }
        lifecycle({ stage: code === 0 ? 'discovery-complete' : 'discovery-error', code: code === 0 ? null : 'DISCOVERY_EXIT', message: code === 0 ? 'Initial local discovery completed.' : `Initial local discovery exited (${signal || code}).`, durationMs: Date.now() - scanStarted });
        if (pendingScanReason) {
          const next = pendingScanReason;
          pendingScanReason = null;
          setTimeout(() => startBackgroundDiscovery(next), 0).unref();
        }
      });
      backgroundScan.unref();
      return { state: 'scheduled', reason };
    } catch (error) {
      backgroundScan = null;
      lifecycle({ stage: 'discovery-error', code: error?.code || 'DISCOVERY_ERROR', message: error?.message || 'Initial local discovery could not start.', durationMs: Date.now() - scanStarted });
      return { state: 'error', reason };
    }
  };
  const refreshCapacity = () => {
    if (capacityProcess && capacityProcess.exitCode == null) return;
    const current = applyCachedViewMeta() || startupLoadingIndex();
    try {
      const child = spawnProcess(process.execPath, [path.join(root, 'src', 'capacity-worker.js'), JSON.stringify(current.sourceStates || {})], { stdio: ['ignore', 'pipe', 'ignore'] });
      capacityProcess = child;
      let output = '';
      child.stdout?.on('data', (chunk) => {
        if (output.length < 2 * 1024 * 1024) output += String(chunk);
      });
      child.once('error', (error) => lifecycle({ stage: 'capacity-error', code: error?.code || 'CAPACITY_ERROR', message: error?.message || 'Capacity refresh failed.' }));
      child.once('exit', (code) => {
        if (capacityProcess === child) capacityProcess = null;
        if (code !== 0) {
          lifecycle({ stage: 'capacity-error', code: 'CAPACITY_EXIT', message: 'Capacity refresh exited before producing a result.' });
          return;
        }
        try { latestCapacity = JSON.parse(output); }
        catch { lifecycle({ stage: 'capacity-error', code: 'CAPACITY_RESPONSE', message: 'Capacity refresh returned malformed metadata.' }); }
      });
      child.unref();
    } catch (error) {
      capacityProcess = null;
      lifecycle({ stage: 'capacity-error', code: error?.code || 'CAPACITY_ERROR', message: error?.message || 'Capacity refresh failed.' });
    }
  };
  // Do not parse/decorate the full cached index before binding. The local
  // index can be tens of megabytes; liveness must win over hydration.
  liveIndex = startupLoadingIndex();
  const publicDir = path.join(root, 'public');
  const controlToken = runtimeToken();
  const instanceId = runtimeToken();
  const sessionToken = runtimeToken();
  let localOrigin = `http://127.0.0.1:${port}`;
  const localControlAuthorized = (req) => {
    const origin = req.headers.origin || '';
    if (origin !== localOrigin) return false;
    return req.headers['x-ai-dashboard-control'] === controlToken || hasSession(req, sessionToken);
  };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/health') return json(res, { state: 'ok', service: identity.service, localOnly: true, build: { version: identity.version, commit: identity.commit }, instanceId: req.headers['x-ai-dashboard-control'] === controlToken ? instanceId : null });
    if (url.pathname === '/api/runtime-status' && req.method === 'GET') {
      const current = applyCachedViewMeta() || startupLoadingIndex();
      // Keep the compact operating view independent from a cold historical
      // index load. If no cached view exists yet, liveState() may reuse this
      // empty-but-normalized catalog while discovery continues in its worker.
      if (!liveIndex) liveIndex = current;
      const live = liveState();
      const runtime = readRuntime(paths.runtimeFile);
      const scanRunning = Boolean(backgroundScan && backgroundScan.exitCode == null);
      const dashboard = buildDashboardService({
        runtime,
        version: dashboardVersion(),
        head: dashboardCommit(),
        serverState: {
          bound: serverBound,
          status: serverFailed ? 'Unhealthy' : serverBound ? (latestSystem ? 'Healthy' : 'Starting') : 'Starting',
          health: serverFailed ? 'Unhealthy' : serverBound ? 'Healthy' : 'Starting',
          indexReady: Boolean(fs.existsSync(viewFile)),
          discovery: scanRunning ? 'running' : 'idle',
          cpuPercent: latestSystem?.dashboard?.cpuPercent ?? null,
          memoryBytes: latestSystem?.dashboard?.rss ?? null,
          checks: {
            health: serverFailed ? 'unhealthy' : serverBound ? 'healthy' : 'starting',
            liveState: serverFailed ? 'unavailable' : 'available',
            index: fs.existsSync(viewFile) ? 'ready' : 'loading',
            discovery: scanRunning ? 'running' : 'idle'
          },
          error: serverFailed ? 'The local dashboard server reported an error; run ai-dashboard doctor.' : null
        }
      });
      const services = [...buildRuntimeServices({ runtimes: live.runtimeCatalog?.liveRuntimes || current.runtimeCatalog?.liveRuntimes || [], presence: live.presence || {}, liveStates: live.operator?.liveStates || {} }), ...localInferenceServices(current.sourceStates || {})];
      const diagnostics = { discovery: rediscovery.state(), scan: scanRunning ? 'running' : 'idle' };
      return json(res, runtimeStatusSnapshot({ dashboard, services, resources: latestSystem, discovery: diagnostics }));
    }
    if (url.pathname === '/api/system-resources' && req.method === 'GET') {
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      return json(res, latestSystem);
    }
    if (url.pathname === '/api/diagnostics' && req.method === 'GET') {
      const category = url.searchParams.get('category') || 'All';
      const limit = Math.min(160, Math.max(1, Number(url.searchParams.get('limit')) || 80));
      return json(res, { schemaVersion: 1, category, events: normalizeDiagnostics(readLifecycleEvents(paths.lifecycleFile, 160), { category, limit }), filters: ['All', 'Lifecycle', 'Discovery', 'Live telemetry', 'Services', 'Warnings', 'Errors'], bounded: true, privacy: 'Sanitized lifecycle metadata only.' });
    }
    if (url.pathname === '/api/bug-report/diagnostics' && req.method === 'GET') {
      const diagnostics = await localBugDiagnostics();
      return json(res, { diagnostics, endpointConfigured: Boolean(configuredReportEndpoint()) });
    }
    if (url.pathname === '/api/control/restart' && req.method === 'POST') {
      if (!localControlAuthorized(req)) return json(res, { error: 'Unauthorized local control request.' }, 403);
      if (!serverBound || serverFailed) return json(res, { error: 'The dashboard server is not healthy enough to restart.' }, 409);
      restartRequested = true;
      lifecycle({ stage: 'restart-requested', message: 'Dashboard restart requested by the local Maintenance console.' });
      json(res, { state: 'restarting', message: 'Dashboard restart scheduled.' });
      setTimeout(() => { try { server.close(); server.closeAllConnections?.(); } catch {} }, 25).unref();
      return;
    }
    if (url.pathname === '/api/control/stop' && req.method === 'POST') {
      if (!localControlAuthorized(req)) return json(res, { error: 'Unauthorized local control request.' }, 403);
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
    if (url.pathname === '/api/data') {
      const etag = cachedViewTag();
      if (etag) {
        res.setHeader('ETag', etag);
        res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
        if (req.headers['if-none-match'] === etag) { res.statusCode = 304; return res.end(); }
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      return writeChunkedText(res, cachedViewJson());
    }
    if (url.pathname === '/api/efficiency' && req.method === 'GET') return json(res, efficiencySnapshot(index().efficiency?.foundation || {}, { period: url.searchParams.get('period') || '7d', remoteAnalytics: openRouter.state().cached }));
    if (url.pathname === '/api/openrouter' && req.method === 'GET') return json(res, openRouter.state());
    if (url.pathname === '/api/openrouter/connect' && req.method === 'POST') {
      try { const state = await openRouter.connect({ period: (await body(req)).period || 'today' }); startBackgroundDiscovery('openrouter sync'); return json(res, state); }
      catch (error) { return json(res, { ...openRouter.state(), error: error?.code || 'connector-error' }, 400); }
    }
    if (url.pathname === '/api/openrouter/sync' && req.method === 'POST') {
      try { const state = await openRouter.sync({ period: (await body(req)).period || 'today' }); startBackgroundDiscovery('openrouter sync'); return json(res, state); }
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
        startBackgroundDiscovery('antigravity capture enabled');
        return json(res, { ...result, preview: previewAntigravityCapture(undefined, { cliPresent: true }) });
      } catch (error) { return json(res, { error: error?.code || 'integration-error', preview: previewAntigravityCapture(undefined, { cliPresent: antigravityCliPresent() }) }, 400); }
    }
    if (url.pathname === '/api/antigravity/capture/disable' && req.method === 'POST') {
      const b = await body(req), settings = loadSettings(dataDir);
      try { const result = disableAntigravityCapture(undefined, { permission: settings.permissions.localIntegrationWrite, confirmation: b.confirm === true }); startBackgroundDiscovery('antigravity capture disabled'); return json(res, result); }
      catch (error) { return json(res, { error: error?.code || 'integration-error' }, 400); }
    }
    if (url.pathname === '/api/scan' && req.method === 'POST') return json(res, startBackgroundDiscovery('manual refresh'));
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
    if (url.pathname === '/api/status') {
      // Status is a liveness/readiness summary, not a request to hydrate the
      // full historical index. Keep it on the compact metadata view so a
      // browser refresh cannot block health or live-state behind JSON parsing.
      const x = applyCachedViewMeta() || startupLoadingIndex();
      return json(res, { state: 'Live', lastUpdated: x.summary?.lastScanAt || null, reason: x.summary?.refreshReason || lastReason, diagnostics: x.summary?.diagnostics || {} });
    }
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
      if (roots || b.permissions || b.connectedServices) startBackgroundDiscovery('settings change');
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
  const stopOwnedWorkers = () => {
    if (postBindTimer) { clearTimeout(postBindTimer); postBindTimer = null; }
    if (startupDiscoveryTimer) { clearTimeout(startupDiscoveryTimer); startupDiscoveryTimer = null; }
    rediscovery.stop();
    if (watcherProcess) { try { watcherProcess.kill('SIGTERM'); } catch {} watcherProcess = null; }
    if (capacityProcess && capacityProcess.exitCode == null) { try { capacityProcess.kill('SIGTERM'); } catch {} capacityProcess = null; }
    if (presencePollTimer) { clearInterval(presencePollTimer); presencePollTimer = null; }
    if (clineDbPollTimer) { clearInterval(clineDbPollTimer); clineDbPollTimer = null; }
    if (hermesLivePollTimer) { clearInterval(hermesLivePollTimer); hermesLivePollTimer = null; }
    if (backgroundScan && backgroundScan.exitCode == null) { try { backgroundScan.kill('SIGTERM'); } catch {} }
    backgroundScan = null;
  };
  const spawnOwnedRestart = () => {
    if (!restartRequested || serverFailed) return;
    restartRequested = false;
    try {
      const output = fs.openSync(paths.logFile, 'a', 0o600);
      const child = spawnProcess(process.execPath, [path.resolve(process.argv[1]), 'serve', '--port', String(port)], { detached: true, stdio: ['ignore', output, output], env: { ...process.env, AI_DASHBOARD_DATA_DIR: dataDir } });
      child.once?.('error', (error) => lifecycle({ stage: 'restart-error', code: error?.code || 'RESTART_ERROR', message: error?.message || 'Dashboard restart could not start.' }));
      child.unref();
      try { fs.closeSync(output); } catch {}
      lifecycle({ stage: 'restart-spawned', message: 'Owned dashboard restart process spawned.' });
    } catch (error) {
      lifecycle({ stage: 'restart-error', code: error?.code || 'RESTART_ERROR', message: error?.message || 'Dashboard restart could not start.' });
    }
  };
  server.once('close', () => {
    stopOwnedWorkers();
    if (removeRuntimeIfOwned(paths.runtimeFile, { pid: process.pid, instanceId })) lifecycle({ stage: 'server-close', message: restartRequested ? 'Owned dashboard server closed for restart.' : 'Owned dashboard server stopped.' });
    if (restartRequested) {
      restartTimer = setTimeout(() => { restartTimer = null; spawnOwnedRestart(); }, 120);
      // Keep the short hand-off timer referenced. Once the HTTP server closes,
      // it may be the only remaining event-loop handle; unref'ing it lets the
      // parent exit before the replacement process is spawned.
    }
  });
  server.once('error', (error) => {
    serverFailed = true;
    const message = `Dashboard server failed: ${error.message}`;
    console.error(message);
    lifecycle({ stage: 'server-error', code: error.code || 'SERVER_ERROR', message, durationMs: Date.now() - startedAt });
    stopOwnedWorkers();
    try { server.close(); } catch {}
    // A failed second process must never erase a healthy process's ownership
    // record. Only the instance that wrote runtime.json may remove it.
    removeRuntimeIfOwned(paths.runtimeFile, { pid: process.pid, instanceId });
  });
  server.listen(port, '127.0.0.1', () => {
    serverBound = true;
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    const url = `http://127.0.0.1:${actualPort}`;
    localOrigin = url;
    writeRuntime(paths.runtimeFile, { version: 2, service: identity.service, build: { version: identity.version, commit: identity.commit }, pid: process.pid, script: path.resolve(process.argv[1]), startedAt: new Date().toISOString(), url, port: actualPort, instanceId, controlToken, dataDir });
    lifecycle({ stage: 'listening', message: `Loopback server listening on port ${actualPort}.`, durationMs: Date.now() - startedAt });
    console.log(`AI Development Dashboard → ${url}`);
    // All local scans, process sampling, watcher setup, and capacity reads are
    // post-bind work. A slow source must never delay health or stop.
    postBindTimer = setTimeout(() => {
      postBindTimer = null;
      if (serverFailed) return;
      // Do not recursively enumerate historical roots on the server event
      // loop. fs.watch events register newly changed live files; historical
      // discovery remains the scan worker's responsibility.
      // Avoid invoking `vm_stat` during the post-bind critical window. The
      // sampler's normalized total/free-memory fallback is sufficient until
      // the UI is established; no health check should wait on a host command.
      if (!sampleSystem) sampleSystem = createSystemSampler({ workingMemory: () => null });
      if (!runtimeResourceSampler) runtimeResourceSampler = createRuntimeResourceSampler({ baseSampler: sampleSystem, root: path.parse(root).root });
      if (!latestSystem) sampleRuntimeResources();
      watcherProcess = startLiveWatcherWorker(sources, rediscovery, lifecycle);
      startPresencePolling();
      rediscovery.start();
      setInterval(sampleRuntimeResources, 2_000).unref();
      setInterval(pollLiveFiles, 1_500).unref();
      // Cline's SDK session database carries the current task heartbeat even
      // when its JSON manifest is quiet. Keep this narrow poll independent of
      // discovery/index refreshes and off the request path.
      pollClineSessionDatabase().catch(() => {});
      clineDbPollTimer = setInterval(() => { pollClineSessionDatabase().catch(() => {}); }, 2_000);
      clineDbPollTimer.unref?.();
      pollHermesLiveState().catch(() => {});
      hermesLivePollTimer = setInterval(() => { pollHermesLiveState().catch(() => {}); }, 2_000);
      hermesLivePollTimer.unref?.();
      // Capacity is deliberately delayed; it is a lower-frequency panel and
      // some sources walk large local histories. Never make startup health
      // wait for it.
      setTimeout(refreshCapacity, 5_000).unref();
      setInterval(refreshCapacity, 60_000).unref();
    }, 0);
    postBindTimer.unref();
    // A prior index is only a cache. Bind first so `open` remains responsive,
    // then perform discovery in a child process so a slow local scan cannot
    // block health, stop, or the first browser request.
    // Keep a short liveness window after bind. Discovery is synchronous local
    // work today; delaying it lets `open` complete its health handshake before
    // a slow project scan can occupy the event loop. The UI/API can then load
    // the same cached data while discovery continues.
    const startupDiscoveryDelayMs = 50;
    lifecycle({ stage: 'discovery-scheduled', message: `Initial local discovery scheduled in ${startupDiscoveryDelayMs}ms.` });
    startupDiscoveryTimer = setTimeout(() => {
      startupDiscoveryTimer = null;
      if (serverFailed) return;
      startBackgroundDiscovery('startup discovery');
    }, startupDiscoveryDelayMs);
    startupDiscoveryTimer.unref();
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
    const status = await startService({ paths, script, port, expectedBuild: dashboardIdentity(), lifecycleLog: (event) => appendLifecycleEvent(paths.lifecycleFile, event) });
    if (status.state !== 'running') {
      console.error(`AI Dashboard could not start.\n\nReason: ${status.error || 'Unable to start dashboard.'}\n\nTry:\n  ai-dashboard doctor\n  ai-dashboard report-bug`);
      return 1;
    }
    if (command === 'open' && !args.includes('--no-open')) await openBrowser(status.runtime.url);
    console.log(status.runtime.url); return 0;
  }
  if (command === 'status') {
    const status = await serviceStatus(paths, script, { probeLive: true, port, expectedBuild: dashboardIdentity() });
    if (args.includes('--json')) {
      const safeRuntime = status.runtime ? (({ controlToken, dataDir, script: runtimeScript, pid, instanceId, ...safe }) => safe)(status.runtime) : null;
      console.log(JSON.stringify({ ...status, runtime: safeRuntime, portOwner: publicPortOwner(status.portOwner) }, null, 2));
    }
    else {
      const label = status.state === 'stopped' ? 'Stopped' : status.state === 'stale' ? 'Stale lifecycle state' : status.state === 'stale-build' ? 'Stale dashboard build' : status.state === 'orphaned' ? 'Orphaned dashboard' : status.state === 'port-occupied' ? 'Port occupied' : status.state === 'port-unknown' ? 'Port ownership unknown' : status.state === 'unhealthy' ? 'Unhealthy' : status.liveState === 'degraded' ? 'Degraded' : 'Healthy';
      console.log(`${label}${status.runtime?.url ? ` ${status.runtime.url}` : status.port ? ` 127.0.0.1:${status.port}` : ''}${status.reason ? `\n${status.reason}` : ''}`);
    }
    return ['unhealthy', 'stale', 'error'].includes(status.state) ? 1 : 0;
  }
  if (command === 'stop') {
    const status = await stopService({ paths, script, port, expectedBuild: dashboardIdentity(), lifecycleLog: (event) => appendLifecycleEvent(paths.lifecycleFile, event) });
    console.log(status.message || (status.state === 'stopped' ? 'AI Dashboard stopped.' : status.error || 'AI Dashboard did not stop cleanly.'));
    return status.state === 'error' ? 1 : 0;
  }
  if (command === 'doctor') {
    const result = await doctorAsync(paths, script, { port, expectedBuild: dashboardIdentity() });
    if (args.includes('--json')) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`CLI: ${result.checks.find((check) => check.id === 'local-only')?.ok ? 'ok' : 'needs attention'}`);
      console.log(`Lifecycle state: ${result.runtime?.state || 'absent'}`);
      console.log(`Loopback: ${result.loopback?.state || 'stopped'}`);
      console.log(`Live state: ${result.liveState?.state || 'unavailable'}`);
      console.log(`Index: ${result.index?.state || 'unknown'}`);
      console.log(`Discovery: ${result.discovery?.state || 'unknown'}`);
      if (result.port) {
        const portLabel = result.port.state === 'free' ? 'free' : result.port.state === 'dashboard' ? 'owned dashboard' : result.port.state === 'orphaned-dashboard' ? 'orphaned dashboard' : result.port.state === 'occupied-by-other' ? 'occupied by another application' : result.port.state === 'occupied-unknown' ? 'occupied by an unrecognized process' : result.port.state === 'inspection-unavailable' ? 'ownership inspection unavailable' : 'unknown';
        console.log(`Port ${result.port.port}: ${portLabel}`);
      }
      if (result.recommendation) console.log(`Recommendation: ${result.recommendation}`);
    }
    return result.ok ? 0 : 1;
  }
  if (command === 'setup') {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const status = await startService({ paths, script, port, expectedBuild: dashboardIdentity(), lifecycleLog: (event) => appendLifecycleEvent(paths.lifecycleFile, event) });
    if (status.state !== 'running') { console.error(`AI Dashboard could not start.\n\nReason: ${status.error || 'Unable to start dashboard setup.'}\n\nTry:\n  ai-dashboard doctor\n  ai-dashboard report-bug`); return 1; }
    if (!args.includes('--no-open')) await openBrowser(status.runtime.url);
    console.log(`Dashboard setup is ready at ${status.runtime.url}`); return 0;
  }
  if (command === 'autostart') { const plan = autostartPlan({ command: 'ai-dashboard', dataDir }); console.log(JSON.stringify({ ...plan, state: 'disabled', note: 'Autostart is opt-in. This Phase 1 command previews the per-user plan only.' }, null, 2)); return 0; }
  if (command === 'update') {
    // This is an explicit dashboard-software update command. It is never used
    // during startup/discovery and it never updates agents, models, skills, or
    // connected services.
    const before = await serviceStatus(paths, script, { port, expectedBuild: dashboardIdentity() });
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
      const stopped = await stopService({ paths, script, port, expectedBuild: dashboardIdentity() });
      if (stopped.state !== 'stopped') { console.error('Dashboard updated, but the owned service could not be stopped cleanly.'); return 1; }
      const restarted = await startService({ paths, script, port, expectedBuild: dashboardIdentity() });
      if (restarted.state !== 'running') { console.error('Dashboard updated, but the owned service did not restart cleanly.'); return 1; }
      console.log(`Updated successfully. Dashboard restarted. ${restarted.runtime.url}`); return 0;
    }
    console.log(`Updated successfully. ${result.previousHead?.slice(0, 8) || 'previous'} → ${result.head?.slice(0, 8) || 'current'}`); return 0;
  }
  if (command === 'uninstall') { console.log(JSON.stringify({ state: 'preview', package: 'Use your npm package manager to remove the package.', retainedData: dataDir, autostart: 'No job is installed by this Phase 1 foundation.' }, null, 2)); return 0; }
  console.error('Usage: ai-dashboard [serve|scan|setup|start|open|status|stop|doctor|report-bug|autostart|update|uninstall]'); return 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().then((code) => { if (code) process.exitCode = code; });
