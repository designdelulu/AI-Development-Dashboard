export const ADAPTER_CONTRACT_VERSION = 1;

export const ADAPTER_CAPABILITIES = Object.freeze([
  'discover', 'history', 'live', 'tokens', 'cost', 'capacity', 'models', 'projects', 'capabilities', 'health'
]);

const CAPABILITY_VALUES = new Set([
  true, false, 'exact', 'estimated', 'mixed', 'partial', 'unsupported', 'local', 'file-growth', 'native', 'connected', 'unavailable'
]);

export function validateManifest(manifest = {}) {
  const errors = [];
  if (!/^[a-z0-9-]+$/.test(String(manifest.id || ''))) errors.push('Adapter id must be a lowercase slug.');
  if (manifest.contractVersion !== ADAPTER_CONTRACT_VERSION) errors.push(`Adapter contractVersion must be ${ADAPTER_CONTRACT_VERSION}.`);
  if (!Number.isInteger(manifest.adapterVersion) || manifest.adapterVersion < 1) errors.push('adapterVersion must be a positive integer.');
  if (!['local', 'connected-service', 'optional-local-integration'].includes(manifest.kind)) errors.push('Adapter kind is not supported.');
  if (!['local-read', 'network-opt-in', 'local-write-opt-in'].includes(manifest.risk)) errors.push('Adapter risk is not supported.');
  for (const [name, value] of Object.entries(manifest.capabilities || {})) {
    if (!ADAPTER_CAPABILITIES.includes(name)) errors.push(`Unknown adapter capability: ${name}.`);
    if (!CAPABILITY_VALUES.has(value)) errors.push(`Unsupported capability value for ${name}.`);
  }
  if (manifest.runtime != null) {
    if (!manifest.runtime || typeof manifest.runtime !== 'object' || Array.isArray(manifest.runtime)) errors.push('Adapter runtime must be an object.');
    else {
      for (const field of ['sourceKey', 'agent', 'host', 'harness']) {
        if (manifest.runtime[field] != null && (typeof manifest.runtime[field] !== 'string' || !manifest.runtime[field].trim())) errors.push(`Adapter runtime ${field} must be a non-empty string when provided.`);
      }
      if (manifest.runtime.presence != null) {
        const presence = manifest.runtime.presence;
        if (!presence || typeof presence !== 'object' || Array.isArray(presence)) errors.push('Adapter runtime presence must be an object.');
        else for (const field of ['processNames', 'processPathSuffixes', 'processPathIncludes']) {
          if (presence[field] != null && (!Array.isArray(presence[field]) || presence[field].some((value) => typeof value !== 'string' || !value.trim()))) errors.push(`Adapter runtime presence ${field} must be an array of non-empty strings when provided.`);
        }
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

export function assertManifest(manifest) {
  const result = validateManifest(manifest);
  if (!result.valid) throw new Error(`Invalid adapter manifest: ${result.errors.join(' ')}`);
  return Object.freeze({ ...manifest, capabilities: Object.freeze({ ...(manifest.capabilities || {}) }) });
}
