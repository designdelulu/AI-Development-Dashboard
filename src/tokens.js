import { tokenActivity } from './core-tokens.js';
import { agentTokenAvailability } from './identity.js';

export const TOKEN_PERIODS = Object.freeze(['today', 'yesterday', '7d', 'month', 'all']);
export const TOKEN_CATEGORIES = Object.freeze(['freshInput', 'output', 'cacheRead', 'cacheCreation', 'reasoning', 'other']);

export function emptyTokens() {
  return { freshInput: 0, output: 0, cacheRead: 0, cacheCreation: 0, reasoning: 0, other: 0 };
}

export function addTokens(target = emptyTokens(), source = emptyTokens()) {
  const next = { ...emptyTokens(), ...target };
  for (const key of TOKEN_CATEGORIES) next[key] += Number(source?.[key]) || 0;
  return next;
}

export function freshPlusOutput(tokens = emptyTokens()) {
  return (Number(tokens.freshInput) || 0) + (Number(tokens.output) || 0);
}

export function localDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function localDayStart(value = new Date()) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
  }
  const date = value instanceof Date ? new Date(value) : new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function periodBounds(period = 'today', now = new Date()) {
  const current = now instanceof Date ? now : new Date(now);
  const today = localDayStart(current);
  if (period === 'yesterday') {
    const start = new Date(today);
    start.setDate(start.getDate() - 1);
    return { id: 'yesterday', label: 'Yesterday', start, end: today };
  }
  if (period === '7d') {
    const start = new Date(today);
    start.setDate(start.getDate() - 6);
    return { id: '7d', label: 'Last 7 days', start, end: current };
  }
  if (period === 'month') {
    return { id: 'month', label: 'This month', start: new Date(current.getFullYear(), current.getMonth(), 1), end: current };
  }
  if (period === 'all') {
    return { id: 'all', label: 'Since tracking began', start: null, end: current };
  }
  return { id: 'today', label: 'Today', start: today, end: current };
}

export function inPeriod(timestamp, bounds) {
  const at = new Date(timestamp).getTime();
  if (!Number.isFinite(at)) return false;
  if (bounds.start && at < bounds.start.getTime()) return false;
  if (bounds.end && at >= bounds.end.getTime() && bounds.id === 'yesterday') return false;
  if (bounds.end && bounds.id !== 'yesterday' && at > bounds.end.getTime()) return false;
  return true;
}

function sessionInPeriod(session, bounds) {
  return session?.timestamp && inPeriod(session.timestamp, bounds);
}

export function buildTokenCalendar(sessions = [], now = new Date()) {
  const days = {};
  for (const session of sessions) {
    const key = localDateKey(session.timestamp);
    if (!key) continue;
    const day = days[key] || { date: key, tokens: emptyTokens(), byAgent: {}, byModel: {}, byHost: {}, byProvider: {}, sessionCount: 0 };
    day.sessionCount += 1;
    day.tokens = addTokens(day.tokens, session.tokens);
    const agent = session.agent || 'Unknown';
    const agentRow = day.byAgent[agent] || { agent, tokens: emptyTokens(), sessionCount: 0 };
    agentRow.tokens = addTokens(agentRow.tokens, session.tokens);
    agentRow.sessionCount += 1;
    day.byAgent[agent] = agentRow;
    if (session.model) {
      const modelRow = day.byModel[session.model] || { model: session.model, agent, host: session.host || null, provider: session.provider || null, tokens: emptyTokens(), sessionCount: 0 };
      modelRow.tokens = addTokens(modelRow.tokens, session.tokens);
      modelRow.sessionCount += 1;
      day.byModel[session.model] = modelRow;
    }
    if (session.host) {
      const hostRow = day.byHost[session.host] || { host: session.host, tokens: emptyTokens(), sessionCount: 0 };
      hostRow.tokens = addTokens(hostRow.tokens, session.tokens);
      hostRow.sessionCount += 1;
      day.byHost[session.host] = hostRow;
    }
    if (session.provider) {
      const providerRow = day.byProvider[session.provider] || { provider: session.provider, tokens: emptyTokens(), sessionCount: 0 };
      providerRow.tokens = addTokens(providerRow.tokens, session.tokens);
      providerRow.sessionCount += 1;
      day.byProvider[session.provider] = providerRow;
    }
    days[key] = day;
  }
  const timestamps = sessions.map((session) => session.timestamp).filter(Boolean).sort();
  return {
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'local',
    generatedAt: new Date(now).toISOString(),
    trackingStartedAt: timestamps[0] || null,
    days
  };
}

function mergeMaps(target, source, keyName) {
  for (const row of Object.values(source || {})) {
    const key = row[keyName];
    const current = target[key] || { [keyName]: key, tokens: emptyTokens(), sessionCount: 0, agent: row.agent, host: row.host, provider: row.provider, model: row.model };
    current.tokens = addTokens(current.tokens, row.tokens);
    current.sessionCount += row.sessionCount || 0;
    target[key] = current;
  }
  return target;
}

function daysInPeriod(calendar, bounds) {
  return Object.values(calendar.days || {}).filter((day) => {
    const start = localDayStart(day.date);
    if (bounds.start && start < bounds.start) return false;
    if (bounds.id === 'yesterday') return start.getTime() === bounds.start.getTime();
    if (bounds.end && start > bounds.end) return false;
    return true;
  });
}

function contributionRows(map, known, unavailableAgents = {}) {
  const names = [...new Set([...(known || []), ...Object.keys(map)])];
  const observed = names.filter((name) => !unavailableAgents[name]);
  const total = observed.reduce((sum, name) => sum + tokenActivity(map[name]?.tokens), 0);
  return names.map((name) => {
    const blocked = unavailableAgents[name];
    if (blocked) return { agent: name, available: false, reason: blocked, observedActivity: null, freshPlusOutput: null, share: null, tokens: emptyTokens(), sessionCount: map[name]?.sessionCount || 0 };
    const tokens = map[name]?.tokens || emptyTokens();
    const observedActivity = tokenActivity(tokens);
    return {
      agent: name,
      available: true,
      reason: null,
      observedActivity,
      freshPlusOutput: freshPlusOutput(tokens),
      share: total ? observedActivity / total : 0,
      tokens,
      sessionCount: map[name]?.sessionCount || 0
    };
  }).sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1;
    return (b.observedActivity || 0) - (a.observedActivity || 0) || a.agent.localeCompare(b.agent);
  });
}

export function tokenReportFromCalendar(calendar, period = 'today', now = new Date(), { knownAgents = ['Claude', 'Codex', 'Cursor'] } = {}) {
  const bounds = periodBounds(period, now);
  const days = daysInPeriod(calendar, bounds);
  const tokens = days.reduce((sum, day) => addTokens(sum, day.tokens), emptyTokens());
  const byAgent = {};
  const byModel = {};
  const byHost = {};
  const byProvider = {};
  let sessionCount = 0;
  for (const day of days) {
    sessionCount += day.sessionCount || 0;
    mergeMaps(byAgent, day.byAgent, 'agent');
    mergeMaps(byModel, day.byModel, 'model');
    mergeMaps(byHost, day.byHost, 'host');
    mergeMaps(byProvider, day.byProvider, 'provider');
  }
  const unavailable = Object.fromEntries(knownAgents.map((agent) => [agent, agentTokenAvailability(agent)]).filter(([, info]) => !info.available).map(([agent, info]) => [agent, info.reason]));
  return {
    period: bounds.id,
    label: bounds.label,
    from: bounds.start ? bounds.start.toISOString() : calendar.trackingStartedAt,
    to: bounds.end.toISOString(),
    timezone: calendar.timezone,
    trackingStartedAt: calendar.trackingStartedAt,
    sessionCount,
    observedActivity: tokenActivity(tokens),
    freshPlusOutput: freshPlusOutput(tokens),
    tokens,
    byAgent: contributionRows(byAgent, knownAgents, unavailable),
    byModel: Object.values(byModel).map((row) => ({
      ...row,
      observedActivity: tokenActivity(row.tokens),
      freshPlusOutput: freshPlusOutput(row.tokens)
    })).sort((a, b) => b.observedActivity - a.observedActivity || String(a.model).localeCompare(String(b.model))),
    byHost: Object.values(byHost).sort((a, b) => tokenActivity(b.tokens) - tokenActivity(a.tokens)),
    byProvider: Object.values(byProvider).sort((a, b) => tokenActivity(b.tokens) - tokenActivity(a.tokens))
  };
}

export function tokenReports(sessions, now = new Date(), options = {}) {
  const calendar = buildTokenCalendar(sessions, now);
  const reports = Object.fromEntries(TOKEN_PERIODS.map((period) => [period, tokenReportFromCalendar(calendar, period, now, options)]));
  return { calendar, reports };
}

export { tokenActivity };
