import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { OUTCOME_STATES, EFFICIENCY_EVIDENCE } from './efficiency.js';

const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 20);
const fileFor = (dataDir) => path.join(dataDir, 'efficiency-metadata.json');
const clean = (value = {}) => ({ version: 1, outcomes: value.outcomes && typeof value.outcomes === 'object' ? value.outcomes : {}, cycles: Array.isArray(value.cycles) ? value.cycles.filter((item) => Array.isArray(item.workBlockIds)) : [], experiments: Array.isArray(value.experiments) ? value.experiments : [] });
export function loadEfficiencyMetadata(dataDir) { try { return clean(JSON.parse(fs.readFileSync(fileFor(dataDir), 'utf8'))); } catch { return clean(); } }
export function saveEfficiencyMetadata(dataDir, metadata) { fs.mkdirSync(dataDir, { recursive: true }); const next = clean(metadata); fs.writeFileSync(fileFor(dataDir), JSON.stringify(next, null, 2)); return next; }
export function recordOutcome(metadata, workBlockId, state) { const next = clean(metadata); if (!OUTCOME_STATES.includes(state) || state === 'unknown') { delete next.outcomes[workBlockId]; return next; } next.outcomes[workBlockId] = { state, evidenceClass: EFFICIENCY_EVIDENCE.userConfirmed, recordedAt: new Date().toISOString() }; return next; }
export function createCycle(metadata, workBlockIds = []) { const ids = [...new Set(workBlockIds.filter(Boolean))]; if (ids.length < 2) throw new Error('Select at least two work blocks to create a user-confirmed cycle.'); const next = clean(metadata), cycle = { id: `cycle:${hash(ids.sort().join(':'))}`, workBlockIds: ids, boundaryMethod: 'user-confirmed-grouping', boundaryConfidence: 'user-confirmed', createdAt: new Date().toISOString() }; next.cycles = [...next.cycles.filter((item) => item.id !== cycle.id), cycle]; return { metadata: next, cycle }; }
export function removeCycle(metadata, id) { const next = clean(metadata); next.cycles = next.cycles.filter((item) => item.id !== id); return next; }
export function applyEfficiencyMetadata(foundation = {}, metadata = {}) { const next = clean(metadata); const outcomes = [...(foundation.outcomes || [])]; for (const [workBlockId, value] of Object.entries(next.outcomes)) outcomes.push({ id: `outcome:user:${hash(workBlockId)}`, workBlockId, state: value.state, evidenceClass: 'user-confirmed', checks: [], recordedAt: value.recordedAt });
  const cycles = next.cycles.map((item) => ({ ...item, labels: [], attemptIds: [], outcomeId: null }));
  return { ...foundation, outcomes, userCycles: cycles, controlledExperiments: next.experiments };
}
