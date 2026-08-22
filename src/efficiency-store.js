import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { OUTCOME_STATES, EFFICIENCY_EVIDENCE } from './efficiency.js';

const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 20);
const fileFor = (dataDir) => path.join(dataDir, 'efficiency-metadata.json');
export const EFFICIENCY_METADATA_VERSION = 2;
export const VALIDATION_STRENGTHS = Object.freeze(['V4', 'V3', 'V2', 'V1', 'V0']);

const bounded = (value, length = 128) => typeof value === 'string' && value.trim() ? value.trim().slice(0, length) : null;
const timestamp = (value) => value == null || value === '' || Number.isNaN(new Date(value).getTime()) ? null : new Date(value).toISOString();
const contract = (value = null) => {
  if (!value || typeof value !== 'object') return null;
  const kind = bounded(value.kind, 64), strength = bounded(value.strength, 4);
  if (!kind || !VALIDATION_STRENGTHS.includes(strength)) return null;
  return { targetId: bounded(value.targetId, 128), kind, strength, version: bounded(value.version, 64), requiredStatus: bounded(value.requiredStatus, 32) || 'passed' };
};
const cycle = (item = {}) => {
  const workBlockIds = [...new Set((Array.isArray(item.workBlockIds) ? item.workBlockIds : []).filter(Boolean))];
  if (!workBlockIds.length) return null;
  return {
    id: bounded(item.id, 160) || `cycle:${hash(workBlockIds.slice().sort().join(':'))}`,
    workBlockIds,
    boundaryMethod: bounded(item.boundaryMethod, 80) || 'user-confirmed-grouping',
    boundaryConfidence: bounded(item.boundaryConfidence, 80) || 'user-confirmed',
    createdAt: timestamp(item.createdAt),
    taskKey: bounded(item.taskKey, 128),
    privateLabel: bounded(item.privateLabel, 160),
    validationContract: contract(item.validationContract),
    variantDefinition: ['model-path', 'capability-assignment', 'host-harness-path'].includes(item.variantDefinition) ? item.variantDefinition : 'model-path',
    capabilityConfiguration: Array.isArray(item.capabilityConfiguration) ? [...new Set(item.capabilityConfiguration.map((value) => bounded(value, 128)).filter(Boolean))].sort() : [],
    startingState: item.startingState && typeof item.startingState === 'object' ? { revisionHash: bounded(item.startingState.revisionHash, 128), environmentFingerprint: bounded(item.startingState.environmentFingerprint, 128), known: item.startingState.known === true } : { revisionHash: null, environmentFingerprint: null, known: false }
  };
};
const clean = (value = {}) => ({
  version: EFFICIENCY_METADATA_VERSION,
  outcomes: value.outcomes && typeof value.outcomes === 'object' ? value.outcomes : {},
  cycles: Array.isArray(value.cycles) ? value.cycles.map(cycle).filter(Boolean) : [],
  // Unit 6 remains deliberately dormant. This persists no imported reports.
  experiments: Array.isArray(value.experiments) ? value.experiments : [],
  comparison: {
    instrumentationStartedAt: timestamp(value.comparison?.instrumentationStartedAt),
    eligibilityVersion: bounded(value.comparison?.eligibilityVersion, 32) || '1'
  }
});
export function loadEfficiencyMetadata(dataDir) { try { return clean(JSON.parse(fs.readFileSync(fileFor(dataDir), 'utf8'))); } catch { return clean(); } }
export function saveEfficiencyMetadata(dataDir, metadata) { fs.mkdirSync(dataDir, { recursive: true }); const next = clean(metadata); fs.writeFileSync(fileFor(dataDir), JSON.stringify(next, null, 2)); return next; }
export function beginComparisonTracking(metadata, now = new Date()) { const next = clean(metadata); if (!next.comparison.instrumentationStartedAt) next.comparison.instrumentationStartedAt = timestamp(now); return next; }
export function recordOutcome(metadata, workBlockId, state) { const next = clean(metadata); if (!OUTCOME_STATES.includes(state) || state === 'unknown') { delete next.outcomes[workBlockId]; return next; } next.outcomes[workBlockId] = { state, evidenceClass: EFFICIENCY_EVIDENCE.userConfirmed, recordedAt: new Date().toISOString() }; return next; }
export function createCycle(metadata, workBlockIds = [], details = {}) { const ids = [...new Set(workBlockIds.filter(Boolean))]; if (ids.length < 2) throw new Error('Select at least two work blocks to create a user-confirmed cycle.'); const next = clean(metadata), created = cycle({ id: `cycle:${hash(ids.slice().sort().join(':'))}`, workBlockIds: ids, boundaryMethod: 'user-confirmed-grouping', boundaryConfidence: 'user-confirmed', createdAt: new Date().toISOString(), ...details }); next.cycles = [...next.cycles.filter((item) => item.id !== created.id), created]; return { metadata: next, cycle: created }; }
export function removeCycle(metadata, id) { const next = clean(metadata); next.cycles = next.cycles.filter((item) => item.id !== id); return next; }
export function applyEfficiencyMetadata(foundation = {}, metadata = {}) { const next = clean(metadata); const outcomes = [...(foundation.outcomes || [])]; for (const [workBlockId, value] of Object.entries(next.outcomes)) outcomes.push({ id: `outcome:user:${hash(workBlockId)}`, workBlockId, state: value.state, evidenceClass: 'user-confirmed', checks: [], recordedAt: value.recordedAt });
  const cycles = next.cycles.map((item) => ({ ...item, labels: [], attemptIds: [], outcomeId: null }));
  return { ...foundation, outcomes, userCycles: cycles, controlledExperiments: next.experiments, comparison: next.comparison };
}
