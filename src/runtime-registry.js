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

  const presentationFor = (runtime, state = {}) => {
    const hosts = [...new Set((sessions || [])
      .filter((session) => session?.adapterId === runtime.id && session.host)
      .map((session) => session.host))];
    const configuredHost = state.installation?.primaryHost || null;
    const host = hosts.length === 1 ? hosts[0] : hosts.length > 1 ? 'Multiple hosts' : configuredHost || runtime.host;
    return { ...runtime, host, observedHosts: hosts, sourceState: state };
  };

  for (const runtime of declared) {
    const state = sourceStates[runtime.sourceKey] || {};
    if (runtime.liveCapable && usableState(state)) observed.set(runtime.id, presentationFor(runtime, state));
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
      ...presentationFor(declaredRuntime, state),
      agent: session.runtimeAgent || declaredRuntime.agent,
      sourceState: state
    });
  }

  return {
    version: 1,
    runtimes: declared,
    liveRuntimes: [...observed.values()]
  };
}

// Live evidence can arrive before the asynchronous historical scan has
// produced source states/sessions. Preserve the declared adapter boundary and
// add only agents that have a current validated signal; presence or an
// installed extension alone never enters this list.
export function runtimeCatalogForLiveEvidence(catalog = {}, manifests = [], agents = [], hostOverrides = {}, liveDetails = {}) {
  const declared = new Map((catalog.runtimes || []).filter((runtime) => runtime?.id).map((runtime) => [runtime.id, runtime]));
  for (const manifest of manifests || []) {
    const runtime = runtimeDescriptor(manifest);
    if (runtime.id && !declared.has(runtime.id)) declared.set(runtime.id, runtime);
  }
  const live = new Map((catalog.liveRuntimes || []).filter((runtime) => runtime?.id).map((runtime) => [runtime.id, runtime]));
  for (const agent of new Set(agents || [])) {
    const runtime = [...declared.values()].find((item) => item.agent === agent && item.liveCapable);
    if (!runtime) continue;
    const host = hostOverrides[agent] || runtime.host;
    const detail = liveDetails[agent] || {};
    if (live.has(runtime.id)) {
      live.set(runtime.id, {
        ...live.get(runtime.id),
        host,
        observedHosts: host ? [host] : live.get(runtime.id).observedHosts || [],
        ...(detail.model ? { model: detail.model, modelLabel: detail.model } : {}),
        ...(detail.provider ? { provider: detail.provider } : {}),
        ...(detail.gateway ? { gateway: detail.gateway } : {})
      });
      continue;
    }
    live.set(runtime.id, { ...runtime, host, observedHosts: host ? [host] : [], ...(detail.model ? { model: detail.model, modelLabel: detail.model, provider: detail.provider || null, gateway: detail.gateway || null } : {}), sourceState: { live: { state: 'active', evidence: ['validated-live-signal'] } } });
  }
  return { version: 1, runtimes: [...declared.values()], liveRuntimes: [...live.values()] };
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
