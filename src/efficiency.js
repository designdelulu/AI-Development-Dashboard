import crypto from 'node:crypto';
import { emptyTokens, addTokens, freshPlusOutput, inPeriod, periodBounds } from './tokens.js';
import { tokenActivity } from './core-tokens.js';

export const EFFICIENCY_METRIC_VERSION = '1.0';
export const EFFICIENCY_EVIDENCE = Object.freeze({ measured: 'Measured', inferred: 'Inferred', userConfirmed: 'User-confirmed', unknown: 'Unknown' });
export const OUTCOME_STATES = Object.freeze(['accepted', 'partially-accepted', 'rejected', 'reverted', 'abandoned', 'unknown']);
export const STRUCTURAL_EVENT_TYPES = Object.freeze(['tool_call', 'tool_error', 'command_nonzero_exit', 'validation_attempted', 'validation_passed', 'validation_failed', 'provider_error', 'rate_limit', 'timeout', 'process_failure', 'task_complete_structured', 'retry_measured', 'retry_inferred', 'reverted_change', 'possible_rework']);

const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 20);
const iso = (value) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date.toISOString(); };
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const commandText = (row = {}) => {
  const p = row.payload || {};
  const values = [row.command, row.input?.command, row.arguments?.command, row.tool_input?.command, row.message?.input?.command, p.command, p.input?.command, p.arguments?.command];
  return values.find((value) => typeof value === 'string' && value.trim()) || null;
};
const toolName = (row = {}) => {
  const value = row.name || row.tool_name || row.message?.name || row.message?.content?.name || row.payload?.name || row.payload?.tool_name;
  return typeof value === 'string' ? value.slice(0, 96) : null;
};
const event = ({ sessionId, timestamp, type, evidence = EFFICIENCY_EVIDENCE.measured, source, sequence = 0, metadata = {}, model = null }) => ({
  id: `eff:${hash(`${source}:${sessionId || 'unknown'}:${timestamp || 'unknown'}:${type}:${sequence}`)}`,
  timestamp: iso(timestamp), sessionId: sessionId || null, workBlockId: null, attemptId: null,
  type, outcome: null, evidence, source, model: model || null, metadata
});

// Commands are inspected only in memory to assign a bounded validator class.
// The command text itself is never returned, stored, or exported.
export function classifyValidationCommand(command) {
  if (typeof command !== 'string') return null;
  const value = command.trim().replace(/^\s*(?:env\s+[^\s=]+=\S+\s+)*/, '');
  if (/^(?:npm\s+(?:test|run\s+(?:test|test:[\w-]+))|pnpm\s+(?:test|run\s+(?:test|test:[\w-]+))|yarn\s+test)\b/i.test(value)) return 'javascript-test';
  if (/^(?:pytest|python(?:3)?\s+-m\s+pytest)\b/i.test(value)) return 'pytest';
  if (/^cargo\s+test\b/i.test(value)) return 'cargo-test';
  if (/^go\s+test\b/i.test(value)) return 'go-test';
  if (/^(?:npx\s+)?(?:vitest|jest)\b/i.test(value)) return 'javascript-test-runner';
  if (/^(?:npm\s+run\s+(?:lint|build|check)|cargo\s+check|go\s+vet)\b/i.test(value)) return 'known-validator';
  return null;
}

export function structuralEventsFromRecord(row = {}, { sessionId = null, source = 'local-jsonl', sequence = 0, model = null } = {}) {
  const timestamp = iso(row.timestamp);
  if (!timestamp) return [];
  const p = row.payload || {}, out = [], type = String(row.type || p.type || p.event_type || '').toLowerCase();
  const command = commandText(row), validator = classifyValidationCommand(command);
  const exitCode = number(row.exit_code ?? row.exitCode ?? row.result?.exit_code ?? row.result?.exitCode ?? p.exit_code ?? p.exitCode ?? p.result?.exit_code);
  const failed = row.is_error === true || row.isError === true || p.is_error === true || p.isError === true || (exitCode != null && exitCode !== 0);
  const tool = toolName(row);
  const content = Array.isArray(row.message?.content) ? row.message.content : [];
  const toolUses = content.filter((item) => item?.type === 'tool_use');
  const toolResults = content.filter((item) => item?.type === 'tool_result');
  if (type.includes('tool_use') || type.includes('function_call') || type.includes('command_execution') || p.type === 'function_call') out.push(event({ sessionId, timestamp, type: 'tool_call', source, sequence, model, metadata: { toolName: tool } }));
  for (const item of toolUses) out.push(event({ sessionId, timestamp, type: 'tool_call', source, sequence: `${sequence}:${item.id || item.name || 'tool'}`, model, metadata: { toolName: typeof item.name === 'string' ? item.name.slice(0, 96) : null } }));
  if (type.includes('tool_result') && failed) out.push(event({ sessionId, timestamp, type: 'tool_error', source, sequence, model, metadata: { toolName: tool, exitCode } }));
  for (const item of toolResults) if (item.is_error === true) out.push(event({ sessionId, timestamp, type: 'tool_error', source, sequence: `${sequence}:${item.tool_use_id || 'tool-result'}`, model, metadata: { toolName: null, exitCode: null } }));
  if (validator) {
    out.push(event({ sessionId, timestamp, type: 'validation_attempted', source, sequence, model, metadata: { validator } }));
    if (exitCode === 0) out.push(event({ sessionId, timestamp, type: 'validation_passed', source, sequence, model, metadata: { validator, exitCode } }));
    else if (failed) out.push(event({ sessionId, timestamp, type: 'validation_failed', source, sequence, model, metadata: { validator, exitCode } }));
  } else if (exitCode != null && exitCode !== 0) out.push(event({ sessionId, timestamp, type: 'command_nonzero_exit', source, sequence, model, metadata: { exitCode } }));
  if (/^git\s+(?:revert|restore)\b/i.test(command || '')) out.push(event({ sessionId, timestamp, type: 'reverted_change', source, sequence, model, metadata: { commandKind: 'git-revert-or-restore' } }));
  const errorCode = String(row.error_code || p.error_code || p.error?.code || '').toLowerCase();
  if (errorCode.includes('rate')) out.push(event({ sessionId, timestamp, type: 'rate_limit', source, sequence, model, metadata: {} }));
  else if (type === 'error' || errorCode) out.push(event({ sessionId, timestamp, type: 'provider_error', source, sequence, model, metadata: { errorCode: errorCode.slice(0, 80) || null } }));
  if (type.includes('timeout')) out.push(event({ sessionId, timestamp, type: 'timeout', source, sequence, model, metadata: {} }));
  if (type.includes('task_complete') || p.type === 'task_complete') out.push(event({ sessionId, timestamp, type: 'task_complete_structured', source, sequence, model, metadata: {} }));
  const retries = number(row.retry_count ?? row.retryCount ?? p.retry_count ?? p.retryCount);
  if (retries != null && retries > 0) out.push(event({ sessionId, timestamp, type: 'retry_measured', source, sequence, model, metadata: { retryCount: retries } }));
  return out;
}

function usageObservations(sessions = []) {
  const out = [];
  for (const session of sessions) for (const day of Object.values(session.tokenDays || {})) {
    const timestamp = day.firstAt || session.usageStartedAt || session.timestamp;
    if (!iso(timestamp)) continue;
    out.push({
      id: `usage:${hash(`${session.id}:${day.date || timestamp}:${day.eventCount || 0}`)}`,
      type: 'usage_observation', timestamp: iso(timestamp), observedAt: session.recordedAt || null,
      sessionId: session.id, workBlockId: null, attemptId: null, projectId: session.projectId || null,
      identity: { agent: session.agent || null, host: session.host || null, harness: session.harness || null, provider: session.provider || null, model: session.model || null, modelRaw: session.modelRaw || null, modelId: session.modelId || null },
      tokens: { ...day.tokens, evidence: day.evidence || session.tokenEvidence || 'unavailable', derivationCode: 'indexed-usage-event' },
      cost: { amount: null, currency: null, semantic: 'unavailable', coverage: 'No local subscription usage is converted to money.' },
      evidence: EFFICIENCY_EVIDENCE.measured, source: 'normalized-local-usage', privacyClass: 'structural-only'
    });
  }
  return out;
}

function workBlocks(sessions = []) {
  return sessions.filter((session) => iso(session.usageStartedAt || session.timestamp)).map((session) => ({
    id: `work:${hash(session.id)}`, projectId: session.projectId || null, sessionIds: [session.id], attemptIds: [],
    startedAt: iso(session.usageStartedAt || session.timestamp), endedAt: iso(session.usageEndedAt || session.timestamp),
    boundaryMethod: 'session-proxy', boundaryConfidence: 'descriptive', labels: [], outcomeId: null,
    identity: { agent: session.agent || null, host: session.host || null, harness: session.harness || null, provider: session.provider || null, model: session.model || null, modelRaw: session.modelRaw || null, modelId: session.modelId || null },
    attributionConfidence: session.attributionConfidence || 'Unknown'
  }));
}

function inferredRetries(events = []) {
  const out = [];
  const grouped = new Map();
  for (const item of events.filter((item) => item.type === 'validation_failed' || item.type === 'validation_attempted')) (grouped.get(item.workBlockId) || grouped.set(item.workBlockId, []).get(item.workBlockId)).push(item);
  for (const rows of grouped.values()) {
    rows.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
    for (let i = 0; i < rows.length - 1; i++) if (rows[i].type === 'validation_failed' && rows[i + 1].type === 'validation_attempted' && rows[i].metadata?.validator === rows[i + 1].metadata?.validator) {
      out.push({ ...event({ sessionId: rows[i + 1].sessionId, timestamp: rows[i + 1].timestamp, type: 'retry_inferred', evidence: EFFICIENCY_EVIDENCE.inferred, source: 'same-work-block-validation-sequence', sequence: i, model: rows[i + 1].model, metadata: { validator: rows[i + 1].metadata?.validator, afterEventId: rows[i].id } }), workBlockId: rows[i + 1].workBlockId });
    }
  }
  return out;
}

export function inferPossibleRework(fileEvents = []) {
  const ordered = [...fileEvents].filter((item) => item?.workBlockId && item?.pathHash && iso(item.timestamp)).sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  const result = [];
  for (let i = 1; i < ordered.length; i++) {
    const prior = ordered[i - 1], current = ordered[i];
    if (prior.workBlockId === current.workBlockId && prior.pathHash === current.pathHash && prior.changeKind === 'edit' && current.changeKind === 'revert') result.push({ id: `rework:${hash(`${prior.id}:${current.id}`)}`, type: 'possible_rework', evidence: EFFICIENCY_EVIDENCE.inferred, workBlockId: current.workBlockId, timestamp: current.timestamp, source: 'structural-file-change-sequence', metadata: { pathHash: current.pathHash } });
  }
  return result;
}

export function detectedModelSwitches(blocks = []) {
  const result = [];
  const groups = new Map();
  for (const block of blocks.filter((item) => item.continuationId)) (groups.get(block.continuationId) || groups.set(block.continuationId, []).get(block.continuationId)).push(block);
  for (const rows of groups.values()) {
    rows.sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
    for (let i = 1; i < rows.length; i++) if (rows[i - 1].identity?.modelId !== rows[i].identity?.modelId) result.push({ id: `switch:${hash(`${rows[i - 1].id}:${rows[i].id}`)}`, type: 'model_switch', evidence: EFFICIENCY_EVIDENCE.measured, source: 'explicit-continuation', timestamp: rows[i].startedAt, fromWorkBlockId: rows[i - 1].id, toWorkBlockId: rows[i].id, from: rows[i - 1].identity, to: rows[i].identity });
  }
  return result;
}

export function buildEfficiencyFoundation({ sessions = [], capabilityUsageEvents = [] } = {}) {
  const blocks = workBlocks(sessions), bySession = new Map(blocks.flatMap((block) => block.sessionIds.map((id) => [id, block])));
  const observations = usageObservations(sessions).map((item) => ({ ...item, workBlockId: bySession.get(item.sessionId)?.id || null }));
  const structural = sessions.flatMap((session) => (session.efficiencyEvents || []).map((item) => ({ ...item, workBlockId: bySession.get(session.id)?.id || null, projectId: session.projectId || null, identity: { agent: session.agent || null, host: session.host || null, harness: session.harness || null, provider: session.provider || null, model: session.model || null, modelId: session.modelId || null } })));
  const retries = inferredRetries(structural);
  const attempts = structural.filter((item) => item.type === 'validation_attempted').map((item) => ({ id: `attempt:${hash(item.id)}`, workBlockId: item.workBlockId, sessionId: item.sessionId, startedAt: item.timestamp, endedAt: item.timestamp, result: 'unknown', evidence: EFFICIENCY_EVIDENCE.measured, usageObservationIds: observations.filter((usage) => usage.sessionId === item.sessionId).map((usage) => usage.id), errorEventIds: structural.filter((candidate) => candidate.sessionId === item.sessionId && ['validation_failed', 'tool_error', 'command_nonzero_exit'].includes(candidate.type)).map((candidate) => candidate.id), capabilityEvidenceIds: [] }));
  for (const attempt of attempts) {
    const own = structural.find((item) => `attempt:${hash(item.id)}` === attempt.id);
    if (own?.type === 'validation_attempted') {
      const result = structural.find((item) => item.sessionId === own.sessionId && item.timestamp === own.timestamp && (item.type === 'validation_passed' || item.type === 'validation_failed'));
      attempt.result = result?.type === 'validation_passed' ? 'completed' : result?.type === 'validation_failed' ? 'failed' : 'unknown';
    }
  }
  const outcomes = structural.filter((item) => ['validation_passed', 'validation_failed', 'task_complete_structured'].includes(item.type)).map((item) => ({ id: `outcome:${hash(item.id)}`, workBlockId: item.workBlockId, state: 'unknown', evidenceClass: item.type.startsWith('validation') ? 'test-result' : 'host-structured', checks: [{ kind: item.type, status: item.type === 'validation_passed' ? 'passed' : item.type === 'validation_failed' ? 'failed' : 'observed', observedAt: item.timestamp, source: item.source }], recordedAt: item.timestamp }));
  const capabilityEvidence = capabilityUsageEvents.map((item) => ({ id: `capability-evidence:${hash(item.id)}`, capabilityId: item.capabilityId, host: item.agent === 'Claude' ? 'Claude Code' : null, projectId: item.projectId || null, sessionId: item.sessionId || null, attemptId: null, workBlockId: bySession.get(item.sessionId)?.id || null, class: 'confirmed-invocation', source: item.evidenceType, observedAt: item.timestamp, details: {} }));
  for (const attempt of attempts) attempt.capabilityEvidenceIds = capabilityEvidence.filter((item) => item.sessionId === attempt.sessionId).map((item) => item.id);
  return { metricDefinitionVersion: EFFICIENCY_METRIC_VERSION, privacyClass: 'structural-only', usageObservations: observations, workBlocks: blocks, attempts, events: [...structural, ...retries], outcomes, capabilityEvidence, controlledExperiments: [], modelSwitches: detectedModelSwitches(blocks) };
}

function blankModel(identity = {}) { return { model: identity.model || 'Unknown model', modelId: identity.modelId || 'unknown', provider: identity.provider || null, host: identity.host || null, workBlocks: 0, sessions: new Set(), tokens: emptyTokens(), tokenObservationCount: 0, tests: { attempted: null, passed: null, failed: null }, toolCalls: null, toolFailures: null, commandFailures: null, retriesMeasured: null, retriesInferred: null, possibleRework: null, exactApiCost: null, costCoverage: 'Unavailable', modelSwitches: 0 }; }
function countMetric(row, field) { row[field] = (row[field] == null ? 0 : row[field]) + 1; }

export function efficiencySnapshot(foundation = {}, { period = '7d', now = new Date(), remoteAnalytics = null } = {}) {
  const bounds = periodBounds(period, now);
  const blocks = (foundation.workBlocks || []).filter((item) => inPeriod(item.startedAt, bounds));
  const byBlock = new Map(blocks.map((item) => [item.id, item]));
  const rows = new Map();
  const ensure = (identity) => { const id = identity?.modelId || identity?.model || 'unknown'; if (!rows.has(id)) rows.set(id, blankModel(identity)); return rows.get(id); };
  for (const block of blocks) { const row = ensure(block.identity); row.workBlocks++; row.sessions.add(block.sessionIds?.[0] || block.id); }
  for (const observation of foundation.usageObservations || []) if (byBlock.has(observation.workBlockId)) { const row = ensure(observation.identity); row.tokens = addTokens(row.tokens, observation.tokens); row.tokenObservationCount++; }
  for (const item of foundation.events || []) if (byBlock.has(item.workBlockId)) { const row = ensure(item.identity || { model: item.model }); if (item.type === 'validation_attempted') countMetric(row.tests, 'attempted'); if (item.type === 'validation_passed') countMetric(row.tests, 'passed'); if (item.type === 'validation_failed') countMetric(row.tests, 'failed'); if (item.type === 'tool_call') countMetric(row, 'toolCalls'); if (item.type === 'tool_error') countMetric(row, 'toolFailures'); if (item.type === 'command_nonzero_exit') countMetric(row, 'commandFailures'); if (item.type === 'retry_measured') countMetric(row, 'retriesMeasured'); if (item.type === 'retry_inferred') countMetric(row, 'retriesInferred'); if (item.type === 'possible_rework') countMetric(row, 'possibleRework'); }
  const remoteRangeMatches = remoteAnalytics?.range?.id === bounds.id || (bounds.id === 'all' && remoteAnalytics?.range);
  if (remoteRangeMatches) for (const item of remoteAnalytics?.models || []) if (item.modelId && item.cost != null) { const row = ensure(item); row.exactApiCost = (row.exactApiCost || 0) + item.cost; row.costCoverage = 'Exact OpenRouter provider-reported aggregate; not assigned to a work block.'; }
  const models = [...rows.values()].map((row) => ({ ...row, sessions: row.sessions.size, freshPlusOutput: row.tokenObservationCount ? freshPlusOutput(row.tokens) : null, observedTokenActivity: row.tokenObservationCount ? tokenActivity(row.tokens) : null, comparison: { eligible: false, reason: 'Not enough observations to compare: this foundation does not yet have equivalent task/outcome cohorts.' } })).sort((a, b) => b.workBlocks - a.workBlocks || String(a.model).localeCompare(String(b.model)));
  const caps = (foundation.capabilityEvidence || []).filter((item) => byBlock.has(item.workBlockId)).reduce((all, item) => { const current = all.get(item.capabilityId) || { capabilityId: item.capabilityId, confirmedInvocations: 0, workBlocks: new Set(), observationalOnly: true }; current.confirmedInvocations++; current.workBlocks.add(item.workBlockId); all.set(item.capabilityId, current); return all; }, new Map());
  return { metricDefinitionVersion: EFFICIENCY_METRIC_VERSION, period: { ...bounds, start: bounds.start?.toISOString?.() || null, end: bounds.end?.toISOString?.() || null }, evidenceLegend: EFFICIENCY_EVIDENCE, readiness: { workBlocks: blocks.length, attempts: (foundation.attempts || []).filter((item) => byBlock.has(item.workBlockId)).length, outcomes: (foundation.outcomes || []).filter((item) => byBlock.has(item.workBlockId)).length, comparable: false, reason: 'Descriptive evidence only. Equivalent tasks and outcome criteria are required before comparison.' }, models, capabilities: [...caps.values()].map((item) => ({ ...item, workBlocks: item.workBlocks.size })), workBlocks: blocks, outcomes: (foundation.outcomes || []).filter((item) => byBlock.has(item.workBlockId)), sharing: 'disabled' };
}
