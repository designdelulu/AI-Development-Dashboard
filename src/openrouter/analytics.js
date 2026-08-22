import { sessionIdentity } from '../identity.js';

const METRIC_CANDIDATES = ['total_usage', 'request_count', 'tokens_total', 'tokens_prompt', 'tokens_completion', 'tokens_reasoning', 'tokens_cached', 'cache_hit_rate', 'error_count'];
const DIMENSION_CANDIDATES = ['model', 'provider'];

const number = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const entries = (value) => Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : [];
const names = (value) => Array.isArray(value) ? entries(value).map((item) => typeof item === 'string' ? item : item?.name || item?.id || item?.field).filter(Boolean) : (value && typeof value === 'object' ? Object.keys(value) : []);

export function analyticsSchema(meta = {}) {
  const data = meta.data || meta;
  const metrics = names(data.metrics || data.available_metrics);
  const dimensions = names(data.dimensions || data.available_dimensions);
  return { metrics: METRIC_CANDIDATES.filter((item) => metrics.includes(item)), dimensions: DIMENSION_CANDIDATES.filter((item) => dimensions.includes(item)) };
}

export function analyticsQuery(schema, range, dimensions = []) {
  const metrics = schema.metrics || [];
  if (!metrics.length) return null;
  return {
    metrics,
    dimensions: dimensions.filter((item) => schema.dimensions?.includes(item)).slice(0, 2),
    order_by: metrics.includes('total_usage') ? { field: 'total_usage', direction: 'desc' } : undefined,
    time_range: { start: range.start, end: range.end },
    limit: 50
  };
}

function row(value = {}) {
  const identity = sessionIdentity({ agent: null, host: null, provider: value.provider || null, model: value.model || null, inferAgent: false });
  return {
    model: identity.model,
    modelId: identity.modelId,
    modelLabel: identity.modelLabel,
    provider: identity.provider === 'Unknown' ? null : identity.provider,
    providerConfidence: identity.providerConfidence,
    agent: null,
    host: null,
    harness: 'standalone',
    gateway: 'OpenRouter',
    account: 'OpenRouter',
    cost: number(value.total_usage),
    requests: number(value.request_count),
    tokens: number(value.tokens_total),
    inputTokens: number(value.tokens_prompt),
    outputTokens: number(value.tokens_completion),
    reasoningTokens: number(value.tokens_reasoning),
    cacheTokens: number(value.tokens_cached),
    errors: number(value.error_count),
    evidence: 'Exact',
    projectId: null,
    attributionConfidence: 'Unknown'
  };
}

function sum(values, key) { const valid = values.map((item) => item[key]).filter((item) => item != null); return valid.length ? valid.reduce((total, item) => total + item, 0) : null; }

export function normalizeAnalytics({ modelResponse = {}, providerResponse = {}, creditsResponse = {}, schema, range }) {
  const modelRows = entries(modelResponse.data || modelResponse).map(row).filter((item) => item.model);
  const providerRows = entries(providerResponse.data || providerResponse).map(row).filter((item) => item.provider);
  const all = [...modelRows, ...providerRows];
  const creditData = creditsResponse.data || {};
  return {
    version: 1,
    source: 'OpenRouter',
    syncedAt: new Date().toISOString(),
    range,
    schema,
    truncated: Boolean(modelResponse?.data?.metadata?.truncated || modelResponse?.metadata?.truncated || providerResponse?.data?.metadata?.truncated || providerResponse?.metadata?.truncated),
    summary: { cost: sum(modelRows, 'cost') ?? sum(providerRows, 'cost'), requests: sum(modelRows, 'requests') ?? sum(providerRows, 'requests'), tokens: sum(modelRows, 'tokens') ?? sum(providerRows, 'tokens'), evidence: 'Exact' },
    models: modelRows,
    providers: providerRows,
    credits: { totalCredits: number(creditData.total_credits), totalUsage: number(creditData.total_usage), evidence: 'Exact' },
    projectAttribution: 'Unknown unless explicitly mapped; timestamp proximity is not used.'
  };
}
