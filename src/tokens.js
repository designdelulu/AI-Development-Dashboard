import { tokenActivity } from './core-tokens.js';
import { agentTokenAvailability } from './identity.js';
import { TOKEN_EVIDENCE, addEvidence, emptyEvidence, evidenceFromCounts, formatObservedTokens, mergeEvidenceLevel } from './token-evidence.js';

export const TIMESTAMP_DEFINITION = 'Each token event is bucketed by the usage-record timestamp in the operator timezone. Scan time, index update time, file mtime, and session end time are not used as the usage date.';

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

export function resolvedTimeZone(now = new Date()) {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
  } catch {
    const offset = -now.getTimezoneOffset();
    const sign = offset >= 0 ? '+' : '-';
    const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0');
    const minutes = String(Math.abs(offset) % 60).padStart(2, '0');
    return `UTC${sign}${hours}:${minutes}`;
  }
}

export function localDateKey(value = new Date(), timeZone = resolvedTimeZone()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  try {
    const formatted = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
    const match = formatted.match(/\d{4}-\d{2}-\d{2}/);
    if (match) return match[0];
  } catch {}
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
  if (bounds.end && bounds.id === 'yesterday' && at >= bounds.end.getTime()) return false;
  if (bounds.end && bounds.id !== 'yesterday' && at > bounds.end.getTime()) return false;
  return true;
}

function sessionTokenDays(session) {
  if (session?.tokenDays && typeof session.tokenDays === 'object' && Object.keys(session.tokenDays).length) {
    return session.tokenDays;
  }
  return null;
}

function mergeContributor(target, session, day) {
  const id = session.sessionId || session.id || session.sourceFile || `${session.agent}:${day.date}`;
  const current = target[id] || {
    sessionId: session.sessionId || session.id || null,
    agent: session.agent || 'Unknown',
    host: session.host || null,
    provider: session.provider || null,
    model: session.model || null,
    recordUpdatedAt: session.recordedAt || session.indexUpdatedAt || null,
    eventCount: 0,
    tokens: emptyTokens(),
    firstAt: day.firstAt || null,
    lastAt: day.lastAt || null
  };
  current.eventCount += day.eventCount || 0;
  current.tokens = addTokens(current.tokens, day.tokens);
  if (day.firstAt && (!current.firstAt || day.firstAt < current.firstAt)) current.firstAt = day.firstAt;
  if (day.lastAt && (!current.lastAt || day.lastAt > current.lastAt)) current.lastAt = day.lastAt;
  target[id] = current;
  return target;
}

export function buildTokenCalendar(sessions = [], now = new Date()) {
  const days = {};
  const unallocated = [];
  for (const session of sessions) {
    const tokenDays = sessionTokenDays(session);
    if (!tokenDays) {
      if (tokenActivity(session.tokens)) unallocated.push({ sessionId: session.id || null, agent: session.agent || 'Unknown', reason: 'No usage-event timestamps; session end/mtime was not used as a usage date.' });
      continue;
    }
    for (const row of Object.values(tokenDays)) {
      const key = row.date || localDateKey(row.firstAt);
      if (!key) continue;
      const day = days[key] || { date: key, tokens: emptyTokens(), exactTokens: emptyTokens(), estimatedTokens: emptyTokens(), evidenceCounts: emptyEvidence(), byAgent: {}, byModel: {}, byHost: {}, byProvider: {}, sessionCount: 0, eventCount: 0, contributors: {} };
      day.eventCount += row.eventCount || 0;
      day.sessionCount += 1;
      day.tokens = addTokens(day.tokens, row.tokens);
      day.exactTokens = addTokens(day.exactTokens, row.exactTokens || (row.evidence === TOKEN_EVIDENCE.estimated ? emptyTokens() : row.tokens));
      day.estimatedTokens = addTokens(day.estimatedTokens, row.estimatedTokens || (row.evidence === TOKEN_EVIDENCE.estimated ? row.tokens : emptyTokens()));
      day.evidenceCounts = addEvidence(day.evidenceCounts, TOKEN_EVIDENCE.exact, row.evidenceCounts?.exact || (row.evidence === TOKEN_EVIDENCE.estimated ? 0 : row.eventCount || 0));
      day.evidenceCounts = addEvidence(day.evidenceCounts, TOKEN_EVIDENCE.estimated, row.evidenceCounts?.estimated || (row.evidence === TOKEN_EVIDENCE.estimated ? row.eventCount || 0 : 0));
      day.evidence = evidenceFromCounts(day.evidenceCounts);
      const agent = session.agent || 'Unknown';
      const agentRow = day.byAgent[agent] || { agent, tokens: emptyTokens(), sessionCount: 0, eventCount: 0, evidence: row.evidence || session.tokenEvidence || TOKEN_EVIDENCE.exact };
      agentRow.tokens = addTokens(agentRow.tokens, row.tokens);
      agentRow.sessionCount += 1;
      agentRow.eventCount += row.eventCount || 0;
      agentRow.evidence = mergeEvidenceLevel(agentRow.evidence, row.evidence || session.tokenEvidence || TOKEN_EVIDENCE.exact);
      day.byAgent[agent] = agentRow;
      if (session.model) {
        const modelRow = day.byModel[session.model] || { model: session.model, agent, host: session.host || null, provider: session.provider || null, tokens: emptyTokens(), sessionCount: 0, eventCount: 0 };
        modelRow.tokens = addTokens(modelRow.tokens, row.tokens);
        modelRow.sessionCount += 1;
        modelRow.eventCount += row.eventCount || 0;
        day.byModel[session.model] = modelRow;
      }
      if (session.host) {
        const hostRow = day.byHost[session.host] || { host: session.host, tokens: emptyTokens(), sessionCount: 0, eventCount: 0 };
        hostRow.tokens = addTokens(hostRow.tokens, row.tokens);
        hostRow.sessionCount += 1;
        hostRow.eventCount += row.eventCount || 0;
        day.byHost[session.host] = hostRow;
      }
      if (session.provider) {
        const providerRow = day.byProvider[session.provider] || { provider: session.provider, tokens: emptyTokens(), sessionCount: 0, eventCount: 0 };
        providerRow.tokens = addTokens(providerRow.tokens, row.tokens);
        providerRow.sessionCount += 1;
        providerRow.eventCount += row.eventCount || 0;
        day.byProvider[session.provider] = providerRow;
      }
      mergeContributor(day.contributors, session, { ...row, date: key });
      days[key] = day;
    }
  }
  const usageTimes = Object.values(days).flatMap((day) => Object.values(day.contributors || {}).flatMap((row) => [row.firstAt, row.lastAt])).filter(Boolean).sort();
  return {
    timezone: resolvedTimeZone(now instanceof Date ? now : new Date(now)),
    generatedAt: new Date(now).toISOString(),
    trackingStartedAt: usageTimes[0] || null,
    timestampDefinition: TIMESTAMP_DEFINITION,
    unallocated,
    days
  };
}

function mergeMaps(target, source, keyName) {
  for (const row of Object.values(source || {})) {
    const key = row[keyName];
    const current = target[key] || { [keyName]: key, tokens: emptyTokens(), sessionCount: 0, eventCount: 0, agent: row.agent, host: row.host, provider: row.provider, model: row.model, evidence: row.evidence || null };
    current.tokens = addTokens(current.tokens, row.tokens);
    current.sessionCount += row.sessionCount || 0;
    current.eventCount += row.eventCount || 0;
    current.evidence = mergeEvidenceLevel(current.evidence, row.evidence);
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

function contributionRows(map, { keyName = 'agent', unavailable = {}, includeZero = false } = {}) {
  const names = Object.keys(map);
  for (const name of Object.keys(unavailable)) if (!names.includes(name)) names.push(name);
  const observed = names.filter((name) => !unavailable[name]);
  const total = observed.reduce((sum, name) => sum + tokenActivity(map[name]?.tokens), 0);
  return names.map((name) => {
    const blocked = unavailable[name];
    if (blocked) {
      const info = keyName === 'agent' ? agentTokenAvailability(name) : {};
      return { [keyName]: name, available: false, reason: typeof blocked === 'string' ? blocked : info.reason, action: info.action || null, observedActivity: null, freshPlusOutput: null, share: null, tokens: emptyTokens(), sessionCount: map[name]?.sessionCount || 0, eventCount: map[name]?.eventCount || 0 };
    }
    const tokens = map[name]?.tokens || emptyTokens();
    const observedActivity = tokenActivity(tokens);
    if (!includeZero && !observedActivity && !(map[name]?.sessionCount)) return null;
    return {
      [keyName]: name,
      available: true,
      reason: null,
      evidence: map[name]?.evidence || TOKEN_EVIDENCE.exact,
      observedActivity,
      freshPlusOutput: freshPlusOutput(tokens),
      share: total ? observedActivity / total : 0,
      tokens,
      sessionCount: map[name]?.sessionCount || 0,
      eventCount: map[name]?.eventCount || 0,
      agent: map[name]?.agent,
      host: map[name]?.host,
      provider: map[name]?.provider,
      model: map[name]?.model
    };
  }).filter(Boolean).sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1;
    return (b.observedActivity || 0) - (a.observedActivity || 0) || String(a[keyName]).localeCompare(String(b[keyName]));
  });
}

export function tokenReportFromCalendar(calendar, period = 'today', now = new Date(), { knownAgents = [], unavailableAgents = {}, diagnostics = {} } = {}) {
  const bounds = periodBounds(period, now);
  const days = daysInPeriod(calendar, bounds);
  const tokens = days.reduce((sum, day) => addTokens(sum, day.tokens), emptyTokens());
  const exactTokens = days.reduce((sum, day) => addTokens(sum, day.exactTokens || emptyTokens()), emptyTokens());
  const estimatedTokens = days.reduce((sum, day) => addTokens(sum, day.estimatedTokens || emptyTokens()), emptyTokens());
  const evidenceCounts = days.reduce((sum, day) => ({
    exact: sum.exact + (day.evidenceCounts?.exact || 0),
    estimated: sum.estimated + (day.evidenceCounts?.estimated || 0)
  }), emptyEvidence());
  const evidence = evidenceFromCounts(evidenceCounts);
  const byAgent = {};
  const byModel = {};
  const byHost = {};
  const byProvider = {};
  const contributors = {};
  let sessionCount = 0;
  let eventCount = 0;
  for (const day of days) {
    sessionCount += day.sessionCount || 0;
    eventCount += day.eventCount || 0;
    mergeMaps(byAgent, day.byAgent, 'agent');
    mergeMaps(byModel, day.byModel, 'model');
    mergeMaps(byHost, day.byHost, 'host');
    mergeMaps(byProvider, day.byProvider, 'provider');
    for (const row of Object.values(day.contributors || {})) mergeContributor(contributors, row, row);
  }
  const unavailable = { ...unavailableAgents };
  for (const agent of Object.keys(unavailable)) {
    const hasActivity = tokenActivity(byAgent[agent]?.tokens) > 0 || (byAgent[agent]?.eventCount || 0) > 0;
    if (hasActivity) delete unavailable[agent];
  }
  for (const agent of knownAgents) {
    if (unavailable[agent]) continue;
    const hasActivity = tokenActivity(byAgent[agent]?.tokens) > 0 || (byAgent[agent]?.eventCount || 0) > 0;
    if (hasActivity) continue;
    const info = agentTokenAvailability(agent, diagnostics);
    if (!info.available) unavailable[agent] = info.reason;
  }
  const report = {
    period: bounds.id,
    label: bounds.label,
    from: bounds.start ? bounds.start.toISOString() : calendar.trackingStartedAt,
    to: bounds.end.toISOString(),
    timezone: calendar.timezone,
    trackingStartedAt: calendar.trackingStartedAt,
    timestampDefinition: calendar.timestampDefinition || TIMESTAMP_DEFINITION,
    sessionCount,
    eventCount,
    observedActivity: tokenActivity(tokens),
    exactObservedActivity: tokenActivity(exactTokens),
    estimatedObservedActivity: tokenActivity(estimatedTokens),
    evidence,
    evidenceCounts,
    freshPlusOutput: freshPlusOutput(tokens),
    tokens,
    exactTokens,
    estimatedTokens,
    byAgent: contributionRows(byAgent, { keyName: 'agent', unavailable }),
    byModel: Object.values(byModel).map((row) => ({
      ...row,
      observedActivity: tokenActivity(row.tokens),
      freshPlusOutput: freshPlusOutput(row.tokens)
    })).sort((a, b) => b.observedActivity - a.observedActivity || String(a.model).localeCompare(String(b.model))),
    byHost: Object.values(byHost).sort((a, b) => tokenActivity(b.tokens) - tokenActivity(a.tokens)),
    byProvider: Object.values(byProvider).map((row) => ({
      ...row,
      observedActivity: tokenActivity(row.tokens),
      freshPlusOutput: freshPlusOutput(row.tokens)
    })).sort((a, b) => b.observedActivity - a.observedActivity || String(a.provider).localeCompare(String(b.provider))),
    unallocated: calendar.unallocated || [],
    explain: null
  };
  report.explain = {
    range: { id: report.period, label: report.label, from: report.from, to: report.to, timezone: report.timezone },
    timestampDefinition: report.timestampDefinition,
    observedActivity: report.observedActivity,
    exactObservedActivity: report.exactObservedActivity,
    estimatedObservedActivity: report.estimatedObservedActivity,
    evidence: report.evidence,
    freshPlusOutput: report.freshPlusOutput,
    tokens: report.tokens,
    sessionCount: report.sessionCount,
    eventCount: report.eventCount,
    byAgent: report.byAgent,
    byProvider: report.byProvider,
    byModel: report.byModel,
    unavailable: report.byAgent.filter((row) => !row.available),
    contributors: Object.values(contributors).sort((a, b) => tokenActivity(b.tokens) - tokenActivity(a.tokens)).slice(0, 24),
    unallocated: report.unallocated
  };
  return report;
}

export function tokenReports(sessions, now = new Date(), options = {}) {
  const calendar = buildTokenCalendar(sessions, now);
  const reports = Object.fromEntries(TOKEN_PERIODS.map((period) => [period, tokenReportFromCalendar(calendar, period, now, options)]));
  return { calendar, reports };
}

export { tokenActivity, formatObservedTokens, TOKEN_EVIDENCE, mergeEvidenceLevel };
