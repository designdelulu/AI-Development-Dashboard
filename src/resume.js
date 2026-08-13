import { classifyAgentState } from '../public/agent-state.js';

const HEADLINE = new Set(['Confirmed', 'Strongly inferred']);
const SECRET_FILE = /(\.env(?:$|\.)|credentials|id_rsa|\.pem$|secret|token\.json|\.netrc)/i;
const FORBIDDEN = /prompt|transcript|conversation|credential|api[_-]?key|password/i;

export function lastSessionForProject(sessions = [], projectId) {
  return [...sessions]
    .filter((session) => session.projectId === projectId && HEADLINE.has(session.attributionConfidence))
    .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))[0] || null;
}

export function recentCapabilitiesForProject(index, projectId, limit = 4) {
  const events = (index.capabilityUsageEvents || []).filter((event) => event.projectId === projectId && event.confidence === 'Confirmed');
  const caps = new Map((index.capabilities || []).map((cap) => [cap.id, cap]));
  const ranked = [];
  for (const event of events.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))) {
    const cap = caps.get(event.capabilityId);
    if (!cap || ranked.some((item) => item.id === cap.id)) continue;
    ranked.push({ id: cap.id, name: cap.name, type: cap.type });
    if (ranked.length >= limit) break;
  }
  return ranked;
}

export function liveStatesFromEvents(events = [], agents = ['Claude', 'Codex', 'Cursor'], now = Date.now()) {
  return Object.fromEntries(agents.map((agent) => [agent, classifyAgentState(events, agent, now, { sourceKnown: true })]));
}

export function rankResumeCandidates(projects = [], sessions = [], { liveStates = {}, now = Date.now(), limit = 5 } = {}) {
  const scored = projects.filter((project) => project.status !== 'Archived' || project.pinned).map((project) => {
    const last = lastSessionForProject(sessions, project.id);
    const lastAgent = last?.agent || null;
    const agentState = lastAgent ? liveStates[lastAgent] : null;
    const waiting = agentState?.state === 'Waiting for You';
    const working = agentState?.state === 'Working';
    const recency = last?.timestamp ? Math.max(0, now - new Date(last.timestamp).getTime()) : Number.POSITIVE_INFINITY;
    const gitRecency = project.git?.lastCommitAt ? Math.max(0, now - new Date(project.git.lastCommitAt).getTime()) : Number.POSITIVE_INFINITY;
    let score = 0;
    if (project.pinned) score += 1000;
    if (project.status === 'Waiting') score += 220;
    if (project.status === 'Active') score += 120;
    if (project.status === 'Done') score += 10;
    if (project.status === 'Archived' && !project.pinned) score -= 500;
    if (waiting) score += 320;
    if (working) score += 260;
    if (project.note) score += 40;
    if (Number.isFinite(recency)) score += Math.max(0, 180 - recency / 3_600_000);
    if (Number.isFinite(gitRecency)) score += Math.max(0, 30 - gitRecency / 86_400_000);
    return { project, last, lastAgent, agentState, waiting, working, recency, score };
  }).sort((a, b) => b.score - a.score || a.project.name.localeCompare(b.project.name));
  return scored.filter((item) => item.score > 0 || item.last || item.project.pinned || item.project.status || item.project.note).slice(0, limit);
}

export function observedContext(card = {}, { now = Date.now() } = {}) {
  const project = card.project || card;
  const git = project.git || {};
  const agent = card.lastAgent;
  const parts = [];
  if (agent) parts.push(`Last activity was in ${agent}${git.branch ? ` on ${git.branch}` : ''}.`);
  else if (git.branch) parts.push(`On ${git.branch}.`);
  if (git.lastCommitSubject) parts.push(`Latest commit: "${git.lastCommitSubject}".`);
  if (git.dirty === true) parts.push('Working tree has uncommitted changes.');
  else if (git.dirty === false) parts.push('Working tree clean.');
  const state = card.agentState?.state;
  if (state === 'Waiting for You' && agent) parts.push(`${agent} is currently waiting for you.`);
  else if (state === 'Working' && agent) parts.push(`${agent} is currently working.`);
  void now;
  return parts.join(' ') || 'No recent observed project activity.';
}

function weeklyCodexWindow(capacity) {
  const provider = (capacity?.providers || []).find((item) => item.provider === 'Codex' && item.status === 'Available');
  if (!provider?.windows?.length) return null;
  return provider.windows.find((window) => /weekly/i.test(window.label || '')) || provider.windows[0];
}

export function startHereRecommendation({ lastAgent = null, agentState = null, capacity = null, availableAgents = ['Claude', 'Codex', 'Cursor'] } = {}) {
  const available = (agent) => availableAgents.includes(agent);
  const unknownQuota = (agent) => agent === 'Claude' || agent === 'Cursor';
  const weekly = weeklyCodexWindow(capacity);
  const remaining = weekly && Number.isFinite(Number(weekly.remainingPercent)) ? Math.round(weekly.remainingPercent) : null;

  if (agentState?.state === 'Waiting for You' && lastAgent && available(lastAgent)) {
    return { agent: lastAgent, reason: `${lastAgent} is waiting for you on this project.` };
  }
  if (lastAgent === 'Codex' && remaining != null && available('Codex')) {
    return { agent: 'Codex', reason: `Codex was the last agent used on this project and has ${remaining}% of its weekly capacity remaining.` };
  }
  if (lastAgent && available(lastAgent)) {
    let reason = `${lastAgent} was the last agent used on this project.`;
    if (unknownQuota(lastAgent)) reason += ` ${lastAgent} plan capacity is unknown locally.`;
    if (remaining != null && lastAgent !== 'Codex') reason += ` Codex has ${remaining}% of its weekly capacity remaining if you want to switch.`;
    return { agent: lastAgent, reason };
  }
  if (remaining != null && remaining >= 40 && available('Codex')) {
    return { agent: 'Codex', reason: `Codex has ${remaining}% of its weekly capacity remaining.` };
  }
  const fallback = availableAgents[0] || 'Claude';
  return { agent: fallback, reason: 'No stronger local signal is available. Continue with an installed agent.' };
}

export function safeRecentFiles(files = []) {
  return files.filter((file) => file && !SECRET_FILE.test(file) && !FORBIDDEN.test(file)).slice(0, 8);
}

export function projectHandoff(project, {
  lastAgent = null,
  agentState = null,
  capabilities = [],
  includeNote = true,
  generatedAt = new Date()
} = {}) {
  const git = project.git || {};
  const files = safeRecentFiles(git.recentFiles || []);
  const note = includeNote && project.note ? String(project.note).slice(0, 500) : '';
  const lines = [
    '# Project Handoff',
    '',
    `Project: ${project.name}`,
    `Path: ${project.canonicalPath}`,
    `Branch: ${git.branch || 'unknown'}`,
    `HEAD: ${[git.lastCommitHash, git.lastCommitSubject].filter(Boolean).join(' — ') || 'unknown'}`,
    '',
    `Last Agent: ${lastAgent || 'unknown'}`,
    `Current State: ${agentState?.state || 'unknown'}`,
    `Generated: ${new Date(generatedAt).toISOString()}`
  ];
  if (project.status) lines.push(`Status: ${project.status}`);
  if (note) {
    lines.push('', 'Your Note:', note);
  }
  lines.push('', 'Recent Work:');
  lines.push(`- Latest Git commit: ${git.lastCommitSubject || 'unavailable'}`);
  lines.push(`- Working tree: ${git.dirty ? 'uncommitted changes' : git.dirty === false ? 'clean' : 'unknown'}`);
  if (files.length) lines.push(`- Recent files: ${files.join(', ')}`);
  if (capabilities.length) {
    lines.push('', 'Capabilities:');
    for (const cap of capabilities) lines.push(`- ${cap.name}`);
  }
  lines.push('', 'Instruction:');
  lines.push('Audit the current repository state before changing anything. Continue from the existing work rather than recreating completed functionality.');
  const markdown = `${lines.join('\n')}\n`;
  if (FORBIDDEN.test(markdown) && /prompt|transcript/i.test(markdown) && !/Instruction:/.test(markdown)) {
    throw new Error('Handoff contained forbidden fields.');
  }
  return markdown;
}

export function needsYou(projects = [], sessions = [], liveStates = {}, now = Date.now()) {
  const waitingAgents = Object.entries(liveStates).filter(([, state]) => state?.state === 'Waiting for You').map(([agent, state]) => ({ agent, state }));
  if (!waitingAgents.length) return [];
  return waitingAgents.map(({ agent, state }) => {
    const recent = [...sessions]
      .filter((session) => session.agent === agent && HEADLINE.has(session.attributionConfidence) && session.projectId)
      .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))[0];
    const project = projects.find((item) => item.id === recent?.projectId) || null;
    return {
      agent,
      projectId: project?.id || null,
      projectName: project?.name || 'Unattributed session',
      waitingSince: state.since || now,
      waitingMs: Math.max(0, now - (state.since || now)),
      lastActivity: recent?.timestamp || null
    };
  });
}

export function operatorSummary({ projects = [], sessions = [], liveStates = {}, capacity = null, now = Date.now() } = {}) {
  const today = new Date(now).toISOString().slice(0, 10);
  const todayProjects = new Set(sessions.filter((session) => session.timestamp?.slice(0, 10) === today && session.projectId).map((session) => session.projectId));
  const waiting = needsYou(projects, sessions, liveStates, now);
  const resume = rankResumeCandidates(projects, sessions, { liveStates, now, limit: 5 });
  const paused = projects.filter((project) => project.status === 'Paused').map((project) => project.name);
  const done = projects.filter((project) => project.status === 'Done').map((project) => project.name);
  const weekly = weeklyCodexWindow(capacity);
  return {
    todayProjectCount: todayProjects.size,
    waitingCount: waiting.length,
    waiting,
    continueName: resume[0]?.project?.name || null,
    continueId: resume[0]?.project?.id || null,
    paused,
    done,
    codexRemaining: weekly && Number.isFinite(Number(weekly.remainingPercent)) ? Math.round(weekly.remainingPercent) : null,
    generatedAt: new Date(now).toISOString()
  };
}

export function decorateResumeCards(cards, index, { capacity = null, availableAgents = ['Claude', 'Codex', 'Cursor'] } = {}) {
  return cards.map((card) => {
    const capabilities = recentCapabilitiesForProject(index, card.project.id);
    const recommendation = startHereRecommendation({
      lastAgent: card.lastAgent,
      agentState: card.agentState,
      capacity,
      availableAgents
    });
    return {
      ...card,
      capabilities,
      observedContext: observedContext(card),
      recommendation
    };
  });
}

export function buildOperator(index, events = [], capacity = null, { now = Date.now(), availableAgents = ['Claude', 'Codex', 'Cursor'] } = {}) {
  const liveStates = liveStatesFromEvents(events, ['Claude', 'Codex', 'Cursor'], now);
  const cards = decorateResumeCards(
    rankResumeCandidates(index.projects || [], index.sessions || [], { liveStates, now, limit: 5 }),
    index,
    { capacity, availableAgents }
  );
  return {
    summary: operatorSummary({ projects: index.projects || [], sessions: index.sessions || [], liveStates, capacity, now }),
    resume: cards,
    liveStates,
    needsYou: needsYou(index.projects || [], index.sessions || [], liveStates, now)
  };
}
