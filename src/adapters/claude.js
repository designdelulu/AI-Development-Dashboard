import { ADAPTER_CONTRACT_VERSION } from './contract.js';

export const manifest = {
  id: 'claude', contractVersion: ADAPTER_CONTRACT_VERSION, adapterVersion: 1,
  displayName: 'Claude Code', kind: 'local', risk: 'local-read',
  runtime: { sourceKey: 'Claude', agent: 'Claude', host: 'Claude Code', presence: { processPathIncludes: ['/claude-code/'] } },
  capabilities: { discover: 'local', history: 'exact', live: 'file-growth', tokens: 'exact', capacity: 'partial', models: 'exact', projects: 'exact', health: true }
};

export function discover(context) {
  return context.discovery?.Claude || { installed: { state: 'unknown' }, history: { state: 'unknown' }, live: { state: 'unknown' }, connection: { state: 'not-applicable' } };
}

export function historicalSessions(context) {
  return context.legacy.scanClaude(context.projects, context.sources.claudeRoot, context.previousSessions);
}
