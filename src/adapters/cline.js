import path from 'node:path';
import { ADAPTER_CONTRACT_VERSION } from './contract.js';
import { discoverCline, scanCline } from '../cline.js';

export const manifest = {
  id: 'cline', contractVersion: ADAPTER_CONTRACT_VERSION, adapterVersion: 1,
  displayName: 'Cline', kind: 'local', risk: 'local-read',
  runtime: {
    sourceKey: 'Cline', agent: 'Cline', host: 'Cline',
    // This identifies the Cline CLI only. VS Code extension presence is not
    // treated as a process signal because a generic Code process is not proof
    // that a Cline turn is running.
    presence: { processNames: ['cline'], processPathIncludes: ['/cline/'] }
  },
  capabilities: { discover: 'local', history: 'partial', live: 'partial', tokens: 'exact', cost: 'unsupported', capacity: 'unsupported', models: 'exact', projects: 'partial', health: true }
};

export function discover(context) {
  return discoverCline({ homeDir: context.sources?.homeDir, env: context.sources?.env, platform: process.platform, now: context.now || new Date() });
}

export function historicalSessions(context) {
  return scanCline(context.projects, context.sources?.clineRoot || path.join(context.sources?.homeDir || '', '.cline'), context.previousSessions, { now: context.now || new Date() });
}
