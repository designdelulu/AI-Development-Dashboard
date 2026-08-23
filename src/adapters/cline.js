import path from 'node:path';
import { ADAPTER_CONTRACT_VERSION } from './contract.js';
import { clineInstallation, discoverCline, scanCline } from '../cline.js';

export const manifest = {
  id: 'cline', contractVersion: ADAPTER_CONTRACT_VERSION, adapterVersion: 1,
  displayName: 'Cline', kind: 'local', risk: 'local-read',
  runtime: {
    sourceKey: 'Cline', agent: 'Cline', host: 'Cline',
    // A Cline extension hosted by Cursor has no separate process. The host
    // process is used only for Closed/Present semantics; structured Cline
    // session evidence remains the sole source of AI-work activity.
    presence: { processNames: ['cline', 'cursor'], processPathIncludes: ['/cline/', '/cursor.app/'] }
  },
  // Cline's local session snapshots are exact for model/route metadata and
  // may expose exact numeric usage fields, but the ledger is schema-dependent.
  // Keep the capability partial so missing local tokens stay unavailable
  // rather than becoming zero or being overstated as universally exact.
  capabilities: { discover: 'local', history: 'partial', live: 'partial', tokens: 'partial', cost: 'unsupported', capacity: 'unsupported', models: 'exact', projects: 'partial', health: true }
};

export function discover(context) {
  return discoverCline({ homeDir: context.sources?.homeDir, env: context.sources?.env, platform: process.platform, now: context.now || new Date() });
}

export function historicalSessions(context) {
  const homeDir = context.sources?.homeDir || path.dirname(context.sources?.clineRoot || '');
  const installation = clineInstallation({ homeDir, env: context.sources?.env, platform: process.platform });
  return scanCline(context.projects, context.sources?.clineRoot || path.join(homeDir, '.cline'), context.previousSessions, { now: context.now || new Date(), installation });
}
