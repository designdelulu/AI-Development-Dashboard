import { assertManifest } from './contract.js';

export class AdapterRegistry {
  #adapters = new Map();

  register(adapter) {
    const manifest = assertManifest(adapter?.manifest);
    if (this.#adapters.has(manifest.id)) throw new Error(`Adapter already registered: ${manifest.id}`);
    this.#adapters.set(manifest.id, Object.freeze({ ...adapter, manifest }));
    return this;
  }

  adapters() { return [...this.#adapters.values()]; }

  run(method, context) {
    const results = [];
    for (const adapter of this.#adapters.values()) {
      if (adapter.manifest.risk === 'local-read' && context?.permissions?.localRead !== true) {
        results.push({ id: adapter.manifest.id, manifest: adapter.manifest, denied: true, error: { code: 'permission-denied', message: 'Local reading is disabled.' } });
        continue;
      }
      if (typeof adapter[method] !== 'function') {
        results.push({ id: adapter.manifest.id, manifest: adapter.manifest, unsupported: true });
        continue;
      }
      try {
        results.push({ id: adapter.manifest.id, manifest: adapter.manifest, value: adapter[method](context) });
      } catch (error) {
        results.push({ id: adapter.manifest.id, manifest: adapter.manifest, error: { code: 'adapter-error', message: error instanceof Error ? error.message : 'Adapter failed.' } });
      }
    }
    return results;
  }

  async runAsync(method, context, { timeoutMs = 1_000 } = {}) {
    const results = [];
    for (const adapter of this.#adapters.values()) {
      if (adapter.manifest.risk === 'local-read' && context?.permissions?.localRead !== true) {
        results.push({ id: adapter.manifest.id, manifest: adapter.manifest, denied: true, error: { code: 'permission-denied', message: 'Local reading is disabled.' } });
        continue;
      }
      if (typeof adapter[method] !== 'function') { results.push({ id: adapter.manifest.id, manifest: adapter.manifest, unsupported: true }); continue; }
      const controller = new AbortController();
      const adapterContext = Object.freeze({ ...context, signal: controller.signal });
      let timer;
      try {
        const value = await Promise.race([
          Promise.resolve(adapter[method](adapterContext)),
          new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Adapter timed out.')); }, timeoutMs); })
        ]);
        results.push({ id: adapter.manifest.id, manifest: adapter.manifest, value });
      } catch (error) {
        results.push({ id: adapter.manifest.id, manifest: adapter.manifest, error: { code: controller.signal.aborted ? 'adapter-timeout' : 'adapter-error', message: error instanceof Error ? error.message : 'Adapter failed.' } });
      } finally { clearTimeout(timer); }
    }
    return results;
  }
}
