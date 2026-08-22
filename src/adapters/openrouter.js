import { ADAPTER_CONTRACT_VERSION } from './contract.js';

export const manifest = {
  id: 'openrouter', contractVersion: ADAPTER_CONTRACT_VERSION, adapterVersion: 1,
  displayName: 'OpenRouter', kind: 'connected-service', risk: 'network-opt-in',
  runtime: { sourceKey: 'OpenRouter', agent: 'OpenRouter', host: 'OpenRouter' },
  capabilities: { discover: 'connected', history: 'exact', tokens: 'exact', cost: 'exact', capacity: 'partial', models: 'exact', projects: 'unsupported', health: true }
};

export function discover(context) {
  const service = context.sources?.connectedServices?.openRouter || {};
  return {
    installed: { state: 'not-applicable' },
    history: { state: service.lastSyncAt ? 'observed' : 'none-yet', lastObservedAt: service.lastSyncAt || null },
    live: { state: 'unsupported' },
    connection: { state: service.enabled ? 'configured' : 'disabled' }
  };
}
