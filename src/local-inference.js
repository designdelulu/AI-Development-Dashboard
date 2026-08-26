import { execFileSync } from 'node:child_process';
import { lookupBinary } from './open-agent.js';

// Local inference is intentionally adapter-based.  These are the two known
// runtimes we feature-probe; this module never scans localhost or sends a
// request beyond a loopback endpoint documented by the runtime itself.
const LOOPBACK = /^(?:127\.0\.0\.1|localhost|::1)(?::\d+)?$/i;
const bytes = (value) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : null;
const text = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;

function command(binary, args, { execFile = execFileSync } = {}) {
  try { return execFile(binary, args, { encoding: 'utf8', timeout: 900, maxBuffer: 256 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; }
}

function jsonAt(url, options) {
  // curl is used only to access a documented, fixed loopback API.  Keeping
  // this synchronous lets the existing background scan preserve its bounded
  // and deterministic adapter contract without adding a server dependency.
  const output = command('curl', ['-fsS', '--connect-timeout', '0.2', '--max-time', '0.7', url], options);
  try { return output ? JSON.parse(output) : null; } catch { return null; }
}

function localHost(value, fallback) {
  const candidate = String(value || fallback).replace(/^https?:\/\//i, '').replace(/\/$/, '');
  return LOOPBACK.test(candidate) ? candidate : fallback;
}

function state({ name, binary, models = [], loaded = [], connection = false, loadedEvidence = false, now, reason = null }) {
  const loadedById = new Map(loaded.map((model) => [model.id, model]));
  return {
    installed: { state: binary ? 'detected' : 'not-detected', evidence: binary ? ['binary'] : [], observedAt: new Date(now).toISOString() },
    history: { state: 'not-applicable', recordCount: 0, reason: 'Installed local models are inventory only; they are not usage history.' },
    live: { state: loaded.length ? 'loaded' : 'unavailable', evidence: loaded.length ? ['runtime-model-list'] : [], freshness: loadedEvidence ? 'scan' : 'unavailable', reason: loadedEvidence ? 'The runtime exposes loaded models, not active generation state.' : reason || 'Loaded-model telemetry is unavailable from the local runtime.' },
    connection: { state: connection ? 'connected' : binary ? 'unavailable' : 'not-detected', reason: connection ? null : reason || 'The local runtime is not responding.' },
    health: { level: connection ? 'ok' : binary ? 'unknown' : 'unknown', code: connection ? 'connected' : binary ? 'not-running' : 'not-detected', checkedAt: new Date(now).toISOString() },
    localInference: {
      engine: name, locality: 'Local', binary: binary || null,
      installedModels: models.map((model) => {
        const loadedModel = loadedById.get(model.id);
        return { ...model, ...(loadedModel ? { memoryBytes: loadedModel.memoryBytes, contextLength: loadedModel.contextLength || model.contextLength, resourceEvidence: loadedModel.resourceEvidence } : {}), installed: true, loaded: Boolean(loadedModel), observed: false, active: 'Unavailable' };
      }),
      loadedModels: loaded,
      telemetry: {
        installedModels: connection ? 'Exact' : 'Unavailable', loadedModels: loadedEvidence ? 'Exact' : 'Unavailable', activeGeneration: 'Unavailable',
        historicalUsage: 'Unavailable', tokens: 'Unavailable', projectAttribution: 'Unavailable', apiCost: 'Local / no provider billing',
        memory: loaded.some((model) => model.memoryBytes != null) ? 'Exact service model allocation' : 'Unavailable'
      },
      privacy: 'Read-only local runtime metadata. No prompts, requests, model inventory, or resource data leaves this machine.'
    }
  };
}

function ollamaModel(value = {}, { loaded = false } = {}) {
  const details = value.details || {};
  return {
    id: text(value.model) || text(value.name) || 'unknown-model',
    label: text(value.name) || text(value.model) || 'Unknown model', sizeBytes: bytes(value.size), memoryBytes: loaded ? bytes(value.size_vram) : null,
    quantization: text(details.quantization_level), parameterSize: text(details.parameter_size), contextLength: bytes(value.context_length),
    format: text(details.format), loaded, resourceEvidence: loaded && bytes(value.size_vram) != null ? 'Exact runtime-reported model allocation' : 'Unavailable'
  };
}

export function discoverOllama({ env = process.env, now = Date.now(), lookup = lookupBinary, execute = {} } = {}) {
  const binary = lookup('ollama', ['/opt/homebrew/bin', '/usr/local/bin'], env);
  if (!binary) return state({ name: 'Ollama', binary: null, now, reason: 'Ollama is not detected.' });
  const host = localHost(env.OLLAMA_HOST, '127.0.0.1:11434');
  const tags = jsonAt(`http://${host}/api/tags`, execute);
  const running = tags ? jsonAt(`http://${host}/api/ps`, execute) : null;
  if (!tags || !Array.isArray(tags.models)) return state({ name: 'Ollama', binary, now, reason: 'Ollama is installed, but its local API is not responding.' });
  const models = tags.models.map((model) => ollamaModel(model));
  const loaded = Array.isArray(running?.models) ? running.models.map((model) => ollamaModel(model, { loaded: true })) : [];
  return state({ name: 'Ollama', binary, models, loaded, connection: true, loadedEvidence: Array.isArray(running?.models), now });
}

function lmStudioModel(value = {}) {
  return {
    id: text(value.id) || text(value.model_key) || text(value.modelKey) || 'unknown-model', label: text(value.id) || text(value.display_name) || text(value.displayName) || 'Unknown model',
    sizeBytes: bytes(value.size_bytes ?? value.sizeBytes), memoryBytes: null, quantization: text(value.quantization), parameterSize: text(value.params_string ?? value.paramsString),
    contextLength: bytes(value.max_context_length ?? value.maxContextLength), format: text(value.compatibility_type ?? value.compatibilityType),
    loaded: /loaded|active/i.test(String(value.state || '')), resourceEvidence: 'Unavailable'
  };
}

export function discoverLmStudio({ env = process.env, now = Date.now(), lookup = lookupBinary, execute = {} } = {}) {
  const binary = lookup('lms', ['/opt/homebrew/bin', '/usr/local/bin'], env);
  if (!binary) return state({ name: 'LM Studio', binary: null, now, reason: 'LM Studio CLI is not detected.' });
  const models = jsonAt('http://127.0.0.1:1234/api/v0/models', execute);
  if (!models || !Array.isArray(models.data)) return state({ name: 'LM Studio', binary, now, reason: 'LM Studio is installed, but its documented local API is not responding.' });
  const inventory = models.data.map(lmStudioModel);
  const loaded = inventory.filter((model) => model.loaded).map((model) => ({ ...model, loaded: true }));
  return state({ name: 'LM Studio', binary, models: inventory, loaded, connection: true, loadedEvidence: true, now });
}

export function discoverLocalInference(options = {}) {
  return { Ollama: discoverOllama(options), 'LM Studio': discoverLmStudio(options) };
}

export function localInferenceServices(sourceStates = {}) {
  return ['Ollama', 'LM Studio'].map((name) => {
    const state = sourceStates[name];
    if (!state?.localInference || state.installed?.state !== 'detected') return null;
    const local = state.localInference, loaded = local.loadedModels || [], first = loaded[0];
    return {
      id: `local-inference-${name.toLowerCase().replaceAll(' ', '-')}`, displayName: name, category: 'LOCAL INFERENCE', health: state.health?.level === 'ok' ? 'Healthy' : 'Unknown',
      status: state.connection?.state === 'connected' ? (loaded.length ? 'Working' : 'Idle') : 'Stopped', lifecycle: state.connection?.state === 'connected' ? 'running' : 'stopped',
      source: 'documented local runtime interface', evidence: ['local-only', ...(state.connection?.state === 'connected' ? ['runtime-api'] : ['runtime-unavailable'])],
      model: first ? `${first.label}${loaded.length > 1 ? ` + ${loaded.length - 1} more` : ''}` : null,
      modelMemoryBytes: first?.memoryBytes ?? null, modelMemoryEvidence: first?.resourceEvidence || 'Unavailable',
      telemetry: local.telemetry, controls: { stop: false, restart: false, reason: 'Observe only · the dashboard never changes local inference runtime configuration.' }
    };
  }).filter(Boolean);
}
