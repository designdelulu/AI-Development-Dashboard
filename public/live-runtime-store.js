const EMPTY_CATALOG = { version: 1, runtimes: [], liveRuntimes: [] };

function normalizedCatalog(catalog = EMPTY_CATALOG) {
  const seen = new Set();
  const liveRuntimes = (catalog?.liveRuntimes || []).filter((runtime) => {
    const key = runtime?.id || runtime?.agent;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { ...EMPTY_CATALOG, ...catalog, liveRuntimes };
}

function laneIds(catalog) {
  return (catalog?.liveRuntimes || []).map((runtime) => runtime.id || runtime.agent).filter(Boolean);
}

// Base scan data and live state arrive independently. The last accepted live
// catalog owns current runtime lanes until a newer live response replaces it.
export function createLiveRuntimeStore({ traceLimit = 80, now = Date.now } = {}) {
  let baseCatalog = EMPTY_CATALOG;
  let liveCatalog = null;
  let nextRequest = 0;
  let lastAcceptedRequest = 0;
  const trace = [];
  const record = (source, mutation, details = {}) => {
    trace.push({ at: new Date(now()).toISOString(), source, mutation, ...details, renderedLaneIds: laneIds(current()) });
    while (trace.length > traceLimit) trace.shift();
  };
  const current = () => liveCatalog || baseCatalog;
  return {
    current,
    applyBase(catalog, { source = 'data' } = {}) {
      baseCatalog = normalizedCatalog(catalog);
      record(source, liveCatalog ? 'base-updated-live-retained' : 'base-updated');
      return current();
    },
    beginLiveRequest(source = 'live-state') {
      const request = ++nextRequest;
      record(source, 'live-request-started', { request });
      return request;
    },
    applyLive(catalog, { request, source = 'live-state' } = {}) {
      const generation = Number(request) || ++nextRequest;
      if (generation < lastAcceptedRequest) {
        record(source, 'stale-live-response-ignored', { request: generation, lastAcceptedRequest });
        return false;
      }
      lastAcceptedRequest = generation;
      liveCatalog = normalizedCatalog(catalog);
      record(source, 'live-updated', { request: generation });
      return true;
    },
    retainLive({ source = 'live-state', mutation = 'live-response-retained' } = {}) {
      record(source, mutation);
      return current();
    },
    diagnostics() {
      return { bounded: true, currentLaneIds: laneIds(current()), trace: trace.slice() };
    }
  };
}
