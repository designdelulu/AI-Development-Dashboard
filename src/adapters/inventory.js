import { ADAPTER_CONTRACT_VERSION } from './contract.js';

export const manifest = {
  id: 'local-inventory', contractVersion: ADAPTER_CONTRACT_VERSION, adapterVersion: 1,
  displayName: 'Local capability inventory', kind: 'local', risk: 'local-read',
  capabilities: { discover: 'local', capabilities: 'exact', health: true }
};

export function discover(context) { return context.discovery?.Inventory || { installed: { state: 'detected' }, history: { state: 'not-applicable' }, live: { state: 'unsupported' }, connection: { state: 'not-applicable' } }; }
export function capabilities(context) { return [...context.legacy.discoverCapabilities(context.projects, context.sources), ...context.legacy.discoverNativeAutomations()]; }
