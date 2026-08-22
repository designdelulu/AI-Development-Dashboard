// Runtime presentation is derived from adapter manifests and normalized records.
// It deliberately describes an execution runtime, not a provider, gateway, or
// model. Those identities remain independent on every observed record.

const liveCapability = (value) => value && value !== false && value !== 'unsupported' && value !== 'unavailable';
const usableState = (state = {}) => state.installed?.state === 'detected' || state.history?.state === 'observed' || state.live?.state === 'active';

export function runtimeDescriptor(manifest = {}) {
  const runtime = manifest.runtime || {};
  return {
    id: manifest.id || runtime.id || 'unknown-runtime',
    sourceKey: runtime.sourceKey || manifest.displayName || manifest.id || 'Unknown',
    agent: runtime.agent || manifest.displayName || manifest.id || 'Unknown',
    host: runtime.host || runtime.agent || manifest.displayName || manifest.id || 'Unknown',
    harness: runtime.harness || null,
    presence: runtime.presence ? { ...runtime.presence } : null,
    displayName: manifest.displayName || runtime.agent || manifest.id || 'Unknown',
    liveCapable: Boolean(manifest.kind !== 'connected-service' && liveCapability(manifest.capabilities?.live)),
    capabilities: { ...(manifest.capabilities || {}) }
  };
}

export function runtimeCatalog(manifests = [], sourceStates = {}, sessions = []) {
  const declared = manifests.map(runtimeDescriptor);
  const byId = new Map(declared.map((item) => [item.id, item]));
  const observed = new Map();

  for (const runtime of declared) {
    const state = sourceStates[runtime.sourceKey] || {};
    if (runtime.liveCapable && usableState(state)) observed.set(runtime.id, { ...runtime, sourceState: state });
  }

  // A future adapter can omit presentation hints and still become visible once
  // it emits a normalized runtime identity. It cannot become a live lane unless
  // its manifest explicitly declares a validated live capability.
  for (const session of sessions) {
    const id = session.adapterId;
    const declaredRuntime = id ? byId.get(id) : null;
    if (!declaredRuntime?.liveCapable || observed.has(declaredRuntime.id)) continue;
    const state = sourceStates[declaredRuntime.sourceKey] || {};
    if (!usableState(state)) continue;
    observed.set(declaredRuntime.id, {
      ...declaredRuntime,
      agent: session.runtimeAgent || declaredRuntime.agent,
      host: session.host || declaredRuntime.host,
      sourceState: state
    });
  }

  return {
    version: 1,
    runtimes: declared,
    liveRuntimes: [...observed.values()]
  };
}

export function observedIdentityRegistry(sessions = [], previous = [], { now = new Date() } = {}) {
  const prior = new Map((previous || []).map((item) => [item.key, item]));
  const seenAt = new Date(now).toISOString();
  for (const session of sessions) {
    if (!session?.modelId && !session?.modelRaw) continue;
    const modelId = session.modelId || String(session.modelRaw).toLowerCase();
    const gateway = session.gateway || null;
    const key = [gateway || 'direct', session.provider || 'Unknown', modelId, session.host || 'Unknown', session.harness || 'standalone'].join('|');
    const existing = prior.get(key);
    prior.set(key, {
      key,
      gateway,
      provider: session.provider || 'Unknown',
      model: session.model || session.modelRaw || 'Unknown',
      modelRaw: session.modelRaw || session.model || null,
      modelId,
      agent: session.agent || null,
      host: session.host || null,
      harness: session.harness || 'standalone',
      firstSeenAt: existing?.firstSeenAt || seenAt,
      lastSeenAt: seenAt,
      source: session.adapterId || existing?.source || 'local-adapter'
    });
  }
  return [...prior.values()].sort((a, b) => String(a.firstSeenAt).localeCompare(String(b.firstSeenAt)) || a.key.localeCompare(b.key));
}

// Connected usage is a gateway/account record, not an execution-runtime
// record. It joins the observed identity registry so new route/model IDs are
// retained, while never making OpenRouter a live agent lane.
export function mergeObservedIdentities(previous = [], observations = [], { now = new Date() } = {}) {
  const models = (observations || []).map((item) => ({
    adapterId: item.source || 'connected-service',
    gateway: item.gateway || 'OpenRouter',
    provider: item.provider || 'Unknown',
    model: item.model,
    modelRaw: item.modelId || item.model,
    modelId: item.modelId || (item.model ? String(item.model).toLowerCase() : null),
    agent: item.agent || null,
    host: item.host || null,
    harness: item.harness || 'standalone'
  }));
  return observedIdentityRegistry(models, previous, { now });
}
