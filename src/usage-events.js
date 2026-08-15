import { emptyTokens, tokenActivity } from './core-tokens.js';
import { addTokens, localDateKey } from './tokens.js';

const iso = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};
const n = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

function pickUsage(source = {}) {
  if (source?.payload?.info?.last_token_usage && typeof source.payload.info.last_token_usage === 'object') {
    return { raw: source.payload.info.last_token_usage, recordType: 'codex-last-token-usage' };
  }
  if (source?.usage && typeof source.usage === 'object') return { raw: source.usage, recordType: source.type === 'assistant' ? 'assistant-usage' : 'usage' };
  if (source?.message?.usage && typeof source.message.usage === 'object') return { raw: source.message.usage, recordType: 'assistant-usage' };
  if (source?.payload?.usage && typeof source.payload.usage === 'object') return { raw: source.payload.usage, recordType: 'payload-usage' };
  if (source && (source.input_tokens != null || source.output_tokens != null || source.inputTokens != null || source.outputTokens != null)) {
    return { raw: source, recordType: 'usage' };
  }
  return { raw: {}, recordType: null };
}

export function normalizeUsage(source = {}) {
  const { raw: u } = pickUsage(source);
  return {
    freshInput: n(u.input_tokens ?? u.inputTokens),
    output: n(u.output_tokens ?? u.outputTokens),
    cacheRead: n(u.cache_read_input_tokens ?? u.cacheReadInputTokens ?? u.cached_tokens ?? u.cached_input_tokens),
    cacheCreation: n(u.cache_creation_input_tokens ?? u.cacheCreationInputTokens ?? u.cache_write_input_tokens),
    reasoning: n(u.reasoning_tokens ?? u.reasoningTokens ?? u.reasoning_output_tokens),
    other: n(u.other_tokens ?? u.otherTokens)
  };
}

export function extractUsageEvent(row = {}) {
  const picked = pickUsage(row);
  if (!picked.recordType) return null;
  const tokens = normalizeUsage(row);
  if (!tokenActivity(tokens)) return null;
  const timestamp = iso(row.timestamp);
  if (!timestamp) return null;
  return {
    timestamp,
    tokens,
    recordType: picked.recordType,
    messageId: row.message?.id || null,
    requestId: row.requestId || row.payload?.id || null,
    uuid: row.uuid || row.id || null,
    model: typeof row.message?.model === 'string' ? row.message.model : (typeof row.model === 'string' ? row.model : row.payload?.model || null)
  };
}

export function usageEventKey(event) {
  return event?.messageId || event?.requestId || event?.uuid || `${event?.timestamp}:${tokenActivity(event?.tokens)}:${event?.tokens?.freshInput}:${event?.tokens?.output}`;
}

export function dedupeUsageEvents(events = []) {
  const byKey = new Map();
  for (const event of events) {
    if (!event?.timestamp) continue;
    const key = usageEventKey(event);
    const previous = byKey.get(key);
    if (!previous || event.timestamp >= previous.timestamp) byKey.set(key, event);
  }
  return [...byKey.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export function aggregateTokenDays(events = [], dateKey = localDateKey) {
  const days = {};
  for (const event of events) {
    const date = dateKey(event.timestamp);
    if (!date) continue;
    const day = days[date] || { date, tokens: emptyTokens(), eventCount: 0, firstAt: event.timestamp, lastAt: event.timestamp };
    day.tokens = addTokens(day.tokens, event.tokens);
    day.eventCount += 1;
    if (event.timestamp < day.firstAt) day.firstAt = event.timestamp;
    if (event.timestamp > day.lastAt) day.lastAt = event.timestamp;
    days[date] = day;
  }
  return days;
}

export function tokensFromDays(tokenDays = {}) {
  return Object.values(tokenDays).reduce((sum, day) => addTokens(sum, day.tokens), emptyTokens());
}
