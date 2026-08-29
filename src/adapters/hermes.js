import { ADAPTER_CONTRACT_VERSION } from './contract.js';
import { discoverHermes, hermesInstallation, readHermesHistory } from '../hermes.js';

export const manifest = {
  id: 'hermes', contractVersion: ADAPTER_CONTRACT_VERSION, adapterVersion: 1,
  displayName: 'Hermes Agent', kind: 'local', risk: 'local-read',
  runtime: { sourceKey: 'Hermes Agent', agent: 'Hermes Agent', host: 'Hermes Agent', presence: { processNames: ['hermes'], processPathIncludes: ['/hermes-agent/'] } },
  capabilities: { discover: 'local', history: 'partial', live: 'exact', tokens: 'exact', cost: 'unsupported', capacity: 'unsupported', models: 'exact', projects: 'partial', health: true }
};

export function discover(context) {
  return discoverHermes({ homeDir: context.sources?.homeDir, env: context.sources?.env, now: context.now || new Date() });
}

export function historicalSessions(context) {
  const installation = hermesInstallation({ homeDir: context.sources?.homeDir, env: context.sources?.env });
  return readHermesHistory({ installation, projects: context.projects, now: context.now || new Date() });
}
