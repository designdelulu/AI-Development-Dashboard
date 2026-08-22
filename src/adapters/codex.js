import { ADAPTER_CONTRACT_VERSION } from './contract.js';

export const manifest = {
  id: 'codex', contractVersion: ADAPTER_CONTRACT_VERSION, adapterVersion: 1,
  displayName: 'Codex CLI', kind: 'local', risk: 'local-read',
  capabilities: { discover: 'local', history: 'exact', live: 'file-growth', tokens: 'exact', capacity: 'native', models: 'exact', projects: 'exact', health: true }
};

export function discover(context) { return context.discovery?.Codex || { installed: { state: 'unknown' }, history: { state: 'unknown' }, live: { state: 'unknown' }, connection: { state: 'not-applicable' } }; }
export function historicalSessions(context) { return context.legacy.scanCodex(context.projects, context.sources.codexRoot, context.previousSessions); }
