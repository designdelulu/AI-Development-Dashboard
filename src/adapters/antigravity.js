import { ADAPTER_CONTRACT_VERSION } from './contract.js';
import { antigravityCapacity, antigravityCaptureConfigured, normalizeAntigravityStatus, readAntigravitySettings, readAntigravityState } from '../antigravity.js';

export const manifest = {
  id: 'antigravity', contractVersion: ADAPTER_CONTRACT_VERSION, adapterVersion: 1,
  displayName: 'Antigravity', kind: 'optional-local-integration', risk: 'local-read',
  capabilities: { discover: 'local', history: 'unsupported', live: 'unsupported', tokens: 'exact', capacity: 'partial', models: 'exact', projects: 'partial', health: true }
};

export function discover(context) {
  const closed = context.discovery?.Antigravity || {};
  const home = context.sources?.homeDir;
  const settings = readAntigravitySettings(home);
  const state = readAntigravityState(home);
  const cliPresent = Boolean(closed.installed?.evidence?.includes('binary'));
  const capacity = antigravityCapacity(home, { cliPresent, now: context.now?.getTime?.() || Date.now() });
  const snapshot = normalizeAntigravityStatus(state || {});
  return {
    ...closed,
    history: { state: 'unsupported', recordCount: 0, reason: 'No stable safe retained Antigravity history format is supported.' },
    live: { state: 'unsupported', evidence: [], freshness: 'unavailable', reason: 'A running app or status snapshot is not live-work evidence.' },
    connection: { state: 'not-applicable' },
    telemetry: { configured: antigravityCaptureConfigured(settings, home), state: capacity.status, model: snapshot?.model || null, quotaBuckets: snapshot?.quotaBuckets?.length || 0 },
    health: { level: capacity.health, code: capacity.status.toLowerCase().replaceAll(' ', '-'), message: capacity.message, checkedAt: new Date(context.now || Date.now()).toISOString() }
  };
}
