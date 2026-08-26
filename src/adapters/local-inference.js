import { ADAPTER_CONTRACT_VERSION } from './contract.js';
import { discoverLocalInference } from '../local-inference.js';

export const manifest = {
  id: 'local-inference', contractVersion: ADAPTER_CONTRACT_VERSION, adapterVersion: 1,
  displayName: 'Local inference runtimes', kind: 'local', risk: 'local-read',
  // This is a service inventory, not an agent runtime. It therefore cannot
  // create a Live Agent Activity lane on its own.
  capabilities: { discover: 'local', history: 'unsupported', live: 'partial', tokens: 'unsupported', cost: 'unsupported', models: 'exact', projects: 'unsupported', health: true }
};

export function discover(context) { return discoverLocalInference({ env: context.sources?.env || process.env, now: context.now || Date.now() }); }
