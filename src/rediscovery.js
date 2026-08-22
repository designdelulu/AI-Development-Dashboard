// Bounded local rediscovery. This module never opens an application, reads a
// transcript body, or performs a network request. Watch events are debounced;
// the five-minute fallback catches installations that happen outside watched
// adapter roots.

export const REDISCOVERY_INTERVAL_MS = 5 * 60 * 1000;
export const REDISCOVERY_DEBOUNCE_MS = 7_500;

export function createRediscoveryScheduler({ run, setIntervalFn = setInterval, clearIntervalFn = clearInterval, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout, intervalMs = REDISCOVERY_INTERVAL_MS, debounceMs = REDISCOVERY_DEBOUNCE_MS } = {}) {
  if (typeof run !== 'function') throw new Error('Rediscovery requires a run function.');
  let interval = null;
  let debounce = null;
  let running = false;
  let pendingReason = null;
  let scans = 0;

  const execute = (reason) => {
    if (running) { pendingReason = pendingReason || reason; return null; }
    running = true;
    try { scans += 1; return run(reason); }
    finally {
      running = false;
      if (pendingReason) {
        const next = pendingReason;
        pendingReason = null;
        execute(next);
      }
    }
  };

  return {
    start() {
      if (interval) return;
      interval = setIntervalFn(() => execute('periodic rediscovery'), intervalMs);
      interval?.unref?.();
    },
    stop() {
      if (interval) clearIntervalFn(interval);
      if (debounce) clearTimeoutFn(debounce);
      interval = null;
      debounce = null;
    },
    startup() { return execute('startup discovery'); },
    trigger(reason = 'source change') {
      if (debounce) clearTimeoutFn(debounce);
      debounce = setTimeoutFn(() => { debounce = null; execute(reason); }, debounceMs);
      debounce?.unref?.();
    },
    periodic() { return execute('periodic rediscovery'); },
    state() { return { scans, running, scheduled: Boolean(interval), pending: Boolean(pendingReason || debounce) }; }
  };
}
