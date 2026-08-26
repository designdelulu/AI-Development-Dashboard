import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverLmStudio, discoverOllama, localInferenceServices } from '../src/local-inference.js';
import { sessionIdentity } from '../src/identity.js';

const execute = (routes) => ({ execFile: (_binary, args) => {
  const url = args.at(-1);
  if (!(url in routes)) throw new Error('runtime unavailable');
  return JSON.stringify(routes[url]);
} });

test('Ollama keeps installed, loaded, and observed usage distinct', () => {
  const state = discoverOllama({ now: 1_000, lookup: () => '/usr/local/bin/ollama', execute: execute({
    'http://127.0.0.1:11434/api/tags': { models: [{ name: 'qwen3:14b', size: 9_000, details: { format: 'gguf', parameter_size: '14B', quantization_level: 'Q4_K_M' } }] },
    'http://127.0.0.1:11434/api/ps': { models: [{ name: 'qwen3:14b', size: 9_000, size_vram: 7_000, context_length: 32_768, details: { format: 'gguf', parameter_size: '14B', quantization_level: 'Q4_K_M' } }] }
  }) });
  const model = state.localInference.installedModels[0];
  assert.equal(state.connection.state, 'connected');
  assert.equal(model.installed, true);
  assert.equal(model.loaded, true);
  assert.equal(model.observed, false);
  assert.equal(model.active, 'Unavailable');
  assert.equal(model.memoryBytes, 7_000);
  assert.equal(state.history.state, 'not-applicable');
  assert.equal(state.localInference.telemetry.tokens, 'Unavailable');
  assert.equal(state.localInference.telemetry.apiCost, 'Local / no provider billing');
});

test('installed but stopped local runtimes do not invent model telemetry', () => {
  const state = discoverOllama({ now: 1_000, lookup: () => '/usr/local/bin/ollama', execute: execute({}) });
  assert.equal(state.installed.state, 'detected');
  assert.equal(state.connection.state, 'unavailable');
  assert.equal(state.localInference.installedModels.length, 0);
  assert.equal(state.localInference.telemetry.loadedModels, 'Unavailable');
});

test('LM Studio uses its fixed documented local endpoint without a port scan', () => {
  const state = discoverLmStudio({ now: 1_000, lookup: () => '/usr/local/bin/lms', execute: execute({
    'http://127.0.0.1:1234/api/v0/models': { data: [{ id: 'qwen3-14b', state: 'loaded', quantization: 'Q4_K_M', max_context_length: 32_768 }] }
  }) });
  assert.equal(state.connection.state, 'connected');
  assert.equal(state.localInference.installedModels[0].loaded, true);
  assert.equal(state.localInference.loadedModels[0].id, 'qwen3-14b');
});

test('explicit local route evidence preserves the agent and does not turn Ollama into OpenRouter', () => {
  const identity = sessionIdentity({ agent: 'Cline', host: 'Cursor', provider: 'Ollama', model: 'qwen3:14b', inferAgent: false });
  assert.equal(identity.agent, 'Cline');
  assert.equal(identity.host, 'Cursor');
  assert.equal(identity.locality, 'Local');
  assert.equal(identity.engine, 'Ollama');
  assert.equal(identity.gateway, null);
  assert.notEqual(identity.gateway, 'OpenRouter');
  assert.equal(identity.model, 'qwen3:14b');
});

test('runtime resources expose exact runtime-reported model memory without calling Apple unified memory VRAM', () => {
  const services = localInferenceServices({ Ollama: { installed: { state: 'detected' }, connection: { state: 'connected' }, health: { level: 'ok' }, localInference: { loadedModels: [{ label: 'Qwen3 14B', memoryBytes: 7_000, resourceEvidence: 'Exact runtime-reported model allocation' }], telemetry: { apiCost: 'Local / no provider billing', tokens: 'Unavailable', activeGeneration: 'Unavailable' } } } });
  assert.equal(services[0].modelMemoryBytes, 7_000);
  assert.match(services[0].modelMemoryEvidence, /Exact/);
  assert.equal(services[0].telemetry.apiCost, 'Local / no provider billing');
});
