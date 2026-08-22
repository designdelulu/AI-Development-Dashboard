import { ADAPTER_CONTRACT_VERSION } from './contract.js';

export const manifest = {
  id: 'cursor', contractVersion: ADAPTER_CONTRACT_VERSION, adapterVersion: 1,
  displayName: 'Cursor', kind: 'local', risk: 'local-read',
  runtime: { sourceKey: 'Cursor', agent: 'Cursor', host: 'Cursor', presence: { processNames: ['cursor'], processPathSuffixes: ['cursor.app/contents/macos/cursor'] } },
  capabilities: { discover: 'local', history: 'partial', live: 'file-growth', tokens: 'mixed', capacity: 'unsupported', models: 'partial', projects: 'partial', health: true }
};

export function discover(context) { return context.discovery?.Cursor || { installed: { state: 'unknown' }, history: { state: 'unknown' }, live: { state: 'unknown' }, connection: { state: 'not-applicable' } }; }
export function historicalSessions(context) { return context.legacy.scanCursor(context.projects, context.sources.cursorRoot, context.previousSessions); }
