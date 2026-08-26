// Agent, host, provider, model, and optional role are separate dimensions.
// Role is never inferred for historical sessions. Provider/agent may be
// inferred only from an observed model ID or a documented host default.

import { cursorTokenAvailability } from './cursor-usage.js';

export const TASK_ROLES = Object.freeze([
  'Planning',
  'Architecture',
  'Implementation',
  'QA',
  'Debugging',
  'Audit'
]);

export const IDENTITY_REGISTRY_VERSION = 1;
export const KNOWN_HARNESSES = Object.freeze([
  { id: 'standalone', label: 'Standalone' },
  { id: 'deepseek-harness', label: 'DeepSeek Harness' }
]);

export const KNOWN_HOSTS = Object.freeze([
  { id: 'claude-code', label: 'Claude Code', kind: 'cli' },
  { id: 'codex-cli', label: 'Codex CLI', kind: 'cli' },
  { id: 'cursor', label: 'Cursor', kind: 'ide' },
  { id: 'vscode', label: 'VS Code', kind: 'ide' },
  { id: 'windsurf', label: 'Windsurf', kind: 'ide' },
  { id: 'zed', label: 'Zed', kind: 'ide' },
  { id: 'jetbrains', label: 'JetBrains', kind: 'ide' },
  { id: 'kimi-code', label: 'Kimi Code', kind: 'cli' },
  { id: 'opencode', label: 'OpenCode', kind: 'cli' },
  { id: 'terminal', label: 'terminal', kind: 'shell' }
]);

export const TOKEN_UNSUPPORTED_AGENTS = Object.freeze({});

const MODEL_PROVIDERS = [
  { provider: 'Moonshot', pattern: /kimi|moonshot|(^|[^a-z])k3([^a-z]|$)|k2\.7-code/i, agent: 'Kimi' },
  { provider: 'DeepSeek', pattern: /deepseek/i, agent: 'DeepSeek' },
  { provider: 'xAI', pattern: /grok/i, agent: 'Grok' },
  { provider: 'Google', pattern: /gemini|gemma/i, agent: null },
  { provider: 'Alibaba', pattern: /qwen/i, agent: null },
  { provider: 'Anthropic', pattern: /claude|opus|sonnet|haiku|fable/i, agent: 'Claude' },
  { provider: 'OpenAI', pattern: /gpt-|o1-|o3-|o4-|codex/i, agent: 'Codex' }
];

const HOST_PROVIDER_DEFAULT = Object.freeze({
  Claude: { provider: 'Anthropic', confidence: 'Inferred from host' },
  Codex: { provider: 'OpenAI', confidence: 'Inferred from host' },
  Cursor: { provider: 'Unknown', confidence: 'Unavailable' }
});

export function displayModel(model) {
  const value = String(model || '').trim();
  if (!value) return null;
  return value
    .replace(/^claude-/i, 'Claude ')
    .replace(/^gpt-/i, 'GPT-')
    .replace(/^kimi-/i, 'Kimi ')
    .replace(/^deepseek-/i, 'DeepSeek ')
    .replace(/^grok-/i, 'Grok ')
    .replace(/-/g, ' ');
}

export function normalizeModelId(model) {
  const value = String(model || '').trim();
  return value ? value.toLowerCase() : null;
}

export function normalizeHarness(harness) {
  const value = String(harness || 'standalone').trim().toLowerCase();
  return KNOWN_HARNESSES.some((item) => item.id === value) ? value : (value || 'standalone');
}

export function inferProvider(model, { agent = null } = {}) {
  const id = String(model || '').trim();
  if (id) {
    for (const row of MODEL_PROVIDERS) {
      if (row.pattern.test(id)) return { provider: row.provider, confidence: 'Observed from model', agentHint: row.agent };
    }
    return { provider: 'Unknown', confidence: 'Unknown model family', agentHint: null };
  }
  return HOST_PROVIDER_DEFAULT[agent] || { provider: 'Unknown', confidence: 'Unknown', agentHint: null };
}

export function inferAgentFromModel(model, fallbackAgent) {
  const found = inferProvider(model, { agent: fallbackAgent });
  if (found.confidence === 'Observed from model' && found.agentHint) return found.agentHint;
  return fallbackAgent;
}

export function localInferenceEngine(value) {
  const id = String(value || '').trim().toLowerCase();
  if (/\bollama\b/.test(id)) return 'Ollama';
  if (/\blm\s*studio\b|\blmstudio\b/.test(id)) return 'LM Studio';
  return null;
}

export function sessionIdentity({ agent, host, provider = null, gateway = null, engine = null, locality = null, account = null, model, role = null, harness = 'standalone', inferAgent = true } = {}) {
  const inferred = inferProvider(model, { agent });
  const resolvedAgent = inferAgent ? inferAgentFromModel(model, agent) : (agent || null);
  const localEngine = locality === 'Local' ? (engine || localInferenceEngine(gateway) || localInferenceEngine(provider)) : (localInferenceEngine(engine) || localInferenceEngine(gateway) || localInferenceEngine(provider));
  const explicitProviderIsEngine = localEngine && localInferenceEngine(provider) === localEngine;
  return {
    agent: resolvedAgent,
    host: host || agent || null,
    gateway: localEngine ? null : (gateway || null),
    engine: localEngine || null,
    locality: localEngine ? 'Local' : 'Remote',
    account: account || null,
    provider: explicitProviderIsEngine ? inferred.provider : (provider || inferred.provider),
    providerConfidence: explicitProviderIsEngine ? inferred.confidence : (provider ? 'Observed from source' : inferred.confidence),
    model: model || null,
    modelRaw: model || null,
    modelId: normalizeModelId(model),
    modelLabel: displayModel(model),
    role: TASK_ROLES.includes(role) ? role : null,
    harness: normalizeHarness(harness)
  };
}

export function emptyHarnessRun(overrides = {}) {
  return {
    id: null,
    harness: null,
    projectId: null,
    task: null,
    startedAt: null,
    endedAt: null,
    workers: [],
    ...overrides
  };
}

export function harnessWorker({ agent, host, provider, model, role = null, sessionId = null, tokens = null, outcome = null } = {}) {
  return {
    agent: agent || null,
    host: host || null,
    provider: provider || null,
    model: model || null,
    role: TASK_ROLES.includes(role) ? role : null,
    sessionId,
    tokens,
    outcome
  };
}

export function agentTokenAvailability(agent, diagnostics = {}) {
  if (agent === 'Cursor' || TOKEN_UNSUPPORTED_AGENTS[agent]) {
    return cursorTokenAvailability(diagnostics);
  }
  return { available: true, reason: null };
}
