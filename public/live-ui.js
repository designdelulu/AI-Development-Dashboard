import { brandOf } from './brands.js';

const fmt = (n) => new Intl.NumberFormat().format(n || 0);
const short = (n, evidence) => {
  const amount = Number(n) || 0;
  const compact = amount >= 1e9 ? `${(amount / 1e9).toFixed(2)}B` : amount >= 1e6 ? `${(amount / 1e6).toFixed(1)}M` : amount >= 1e3 ? `${(amount / 1e3).toFixed(0)}K` : fmt(amount);
  return evidence === 'estimated' || evidence === 'mixed' ? `~${compact}` : compact;
};
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[x]));
const TOKEN_PERIOD_BUTTONS = [['today', 'Today'], ['yesterday', 'Yesterday'], ['7d', '7D'], ['month', 'Month'], ['all', 'Since tracking']];
const CATEGORY_LABELS = {
  freshInput: 'Fresh Input',
  output: 'Output',
  cacheRead: 'Cache Read',
  cacheCreation: 'Cache Creation',
  reasoning: 'Reasoning',
  other: 'Other'
};

export function glyph(agent, size = '') {
  const brand = brandOf(agent);
  if (brand.file) return `<span class="agent-glyph ${esc(brand.id.toLowerCase())} ${size}" aria-hidden="true"><img src="/assets/agents/${esc(brand.file)}" alt=""></span>`;
  return `<span class="agent-glyph fallback ${size}" aria-hidden="true">${esc(brand.letter)}</span>`;
}

export function liveLanes(events = [], sessions = [], { now = Date.now(), runtimes = [] } = {}) {
  void now;
  const newest = [...sessions].sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
  const lanes = [];
  for (const runtime of runtimes.filter((item) => item?.liveCapable)) {
    const recent = newest.find((session) => session.adapterId === runtime.id) || newest.find((session) => session.host && session.host === runtime.host) || null;
    lanes.push({
      id: runtime.id,
      adapter: runtime.id,
      eventAgent: runtime.agent,
      host: runtime.host,
      agent: runtime.agent,
      model: recent?.model || null,
      modelLabel: recent?.modelLabel || recent?.model || null,
      provider: recent?.provider || null,
      harness: recent?.harness || runtime.harness || null
    });
  }
  return lanes;
}

export function liveFeedSignalState(states = {}) {
  const values = Object.values(states);
  if (values.some((state) => state?.state === 'Working')) return { mode: 'working', label: 'An agent is working' };
  if (values.some((state) => state?.state === 'Needs You' || state?.state === 'Recently Active')) return { mode: 'recent', label: 'Recent agent activity' };
  return { mode: 'idle', label: 'All observed agents idle' };
}

export function tokenBarRows(contributions = []) {
  return contributions.map((row) => {
    const name = row.agent || row.provider || row.model;
    if (!row.available) {
      const action = row.action?.href ? row.action : null;
      const link = action?.href ? `<a href="${esc(action.href)}" target="_blank" rel="noreferrer">${esc(action.label || 'View usage')}</a>` : '';
      return `<div class="token-agent is-unavailable">${glyph(name)}<div><strong>${esc(name)}</strong><small>${esc(row.reason || 'Local token telemetry unavailable')}</small></div><b>${link || 'Local token telemetry unavailable'}</b></div>`;
    }
    // This is a selected-range observed-token *distribution* bar. Its geometry
    // intentionally uses the exact same total-share denominator as its label;
    // adaptive Fresh + Output intensity has its own meter above.
    const exactShare = Math.max(0, Math.min(1, Number(row.share) || 0));
    const width = exactShare * 100;
    const share = exactShare > 0 && exactShare < .005 ? '<1%' : `${Math.round(exactShare * 100)}%`;
    const estimated = row.evidence === 'estimated' || row.evidence === 'mixed';
    const badge = estimated ? '<em class="token-estimated">Estimated</em>' : '';
    return `<div class="token-agent">${glyph(name)}<div><strong>${esc(name)} ${badge}</strong><span class="token-track" title="Selected-range observed token activity share: ${esc(share)}" aria-hidden="true"><i style="width:${width}%"></i></span></div><b>${short(row.observedActivity, row.evidence)} · ${esc(share)}</b></div>`;
  }).join('');
}

function scaleMarkup(scale = {}) {
  if (!scale?.bucket) return '';
  const current = scale.current || {};
  const recent = scale.recent || {};
  const record = scale.record || null;
  const currentRatio = Math.min(100, Math.max(0, Number(current.ratio || 0) * 100));
  const recordRatio = record ? Math.min(100, Math.max(0, (Number(record.value || 0) / Math.max(1, Number(record.previousCeiling || 0))) * 100)) : 0;
  const currentValue = short(current.value || 0, current.evidence);
  const p95 = recent.p95 == null ? 'Learning from completed days' : `${short(recent.p95)} / day`;
  const lifetime = scale.lifetimeHigh?.value ? `${short(scale.lifetimeHigh.value, scale.lifetimeHigh.evidence)} / day` : 'No completed high yet';
  return `<section class="token-intensity" data-token-intensity title="Meter scale adapts to recent comparable local-day Fresh + Output windows. It does not change token totals.">
    <div class="token-intensity-head"><span class="kicker">ACTIVITY INTENSITY · FRESH + OUTPUT</span><b>${currentValue} / day</b></div>
    <span class="token-intensity-track" aria-label="Current activity intensity"><i style="width:${currentRatio}%"></i></span>
    <div class="token-intensity-meta"><span>Recent heavy range ${p95}</span><span>Lifetime high ${lifetime}</span></div>
    ${record ? `<div class="token-record" data-token-record><span>New activity high</span><b>${short(record.value, record.evidence)} / day</b><i aria-hidden="true" style="width:${recordRatio}%"></i></div>` : ''}
  </section>`;
}

function explainMarkup(explain = {}, report = {}, scale = null) {
  if (!explain) return '';
  const range = explain.range || {};
  const categories = Object.entries(CATEGORY_LABELS).map(([id, label]) => {
    const value = Number(explain.tokens?.[id] || report.tokens?.[id]) || 0;
    return `<li><span>${esc(label)}</span><b>${short(value)}</b></li>`;
  }).join('');
  const agents = (explain.byAgent || []).map((row) => `<li><span>${esc(row.agent)}${row.available ? '' : ' · unavailable'}${row.evidence === 'estimated' || row.evidence === 'mixed' ? ' · estimated' : ''}</span><b>${row.available ? short(row.observedActivity, row.evidence) : esc(row.reason || 'Unavailable')}</b></li>`).join('');
  const providers = (explain.byProvider || []).map((row) => `<li><span>${esc(row.provider)}</span><b>${short(row.observedActivity)}</b></li>`).join('') || '<li><span>No provider IDs in this range</span><b>—</b></li>';
  const models = (explain.byModel || []).slice(0, 8).map((row) => `<li><span>${esc(row.model)}<small>${esc([row.provider, row.host, row.agent].filter(Boolean).join(' · '))}</small></span><b>${short(row.observedActivity)}</b></li>`).join('') || '<li><span>No model IDs in this range</span><b>—</b></li>';
  const contributors = (explain.contributors || []).slice(0, 8).map((row) => `<li><span>${esc(row.agent)}${row.model ? ` · ${esc(row.model)}` : ''}<small>${esc(row.eventCount || 0)} events · usage ${esc(row.firstAt || '—')} → ${esc(row.lastAt || '—')}${row.recordUpdatedAt && row.recordUpdatedAt !== row.lastAt ? ` · record updated ${esc(row.recordUpdatedAt)}` : ''}</small></span><b>${short(tokenSum(row.tokens))}</b></li>`).join('') || '<li><span>No dated usage events in this range</span><b>—</b></li>';
  const unavailable = (explain.unavailable || []).map((row) => `<li>${esc(row.agent)}: ${esc(row.reason)}</li>`).join('') || '<li>None</li>';
  const exact = Number(explain.exactObservedActivity || 0);
  const estimated = Number(explain.estimatedObservedActivity || 0);
  const quality = explain.evidence === 'mixed'
    ? `<div><dt>Exact</dt><dd>${short(exact)}</dd></div><div><dt>Estimated</dt><dd>${short(estimated, 'estimated')}</dd></div>`
    : explain.evidence === 'estimated'
      ? `<div><dt>Evidence</dt><dd>Estimated</dd></div>`
      : `<div><dt>Evidence</dt><dd>${explain.evidence === 'unavailable' ? 'Unavailable' : 'Exact'}</dd></div>`;
  return `<section class="token-explain" data-token-explain-panel>
    <h4>Why this number</h4>
    <p>${esc(range.label || report.label || 'Selected range')} · ${esc(range.timezone || '')}. ${esc(explain.timestampDefinition || '')}</p>
    <dl>
      <div><dt>Observed token activity</dt><dd>${short(explain.observedActivity || 0, explain.evidence)}</dd></div>
      ${quality}
      <div><dt>Fresh + Output</dt><dd>${short(explain.freshPlusOutput || 0, explain.evidence)}</dd></div>
      <div><dt>Source events</dt><dd>${fmt(explain.eventCount || 0)}</dd></div>
      <div><dt>Sessions</dt><dd>${fmt(explain.sessionCount || 0)}</dd></div>
    </dl>
    ${scale?.bucket ? `<h5>Meter scale</h5><p>Fresh + Output per ${esc(scale.bucket.label)}. Recent P95: ${scale.recent?.p95 == null ? 'learning from completed days' : `${short(scale.recent.p95)} / day`}; lifetime high: ${scale.lifetimeHigh?.value ? `${short(scale.lifetimeHigh.value, scale.lifetimeHigh.evidence)} / day` : 'not observed yet'}. This display scale does not change totals.</p>` : ''}
    <h5>Categories</h5><ul>${categories}</ul>
    <h5>Agents / runtimes</h5><ul>${agents}</ul>
    <h5>Providers</h5><ul>${providers}</ul>
    <h5>Models</h5><ul>${models}</ul>
    <h5>Contributing sessions</h5><ul>${contributors}</ul>
    <h5>Unavailable sources</h5><ul>${unavailable}</ul>
  </section>`;
}

function tokenSum(tokens = {}) {
  return Object.values(tokens).reduce((sum, value) => sum + (Number(value) || 0), 0);
}

export function tokenModule(report = {}, { selected = 'today', yesterday = null, expanded = false, explainOpen = false, visualScale = null } = {}) {
  const rangeLabel = report.label || 'Selected period';
  const comparison = selected === 'today' && yesterday ? `<div class="token-yesterday"><span>Yesterday</span><strong>${short(yesterday.observedActivity || 0, yesterday.evidence)}</strong></div>` : '';
  const categories = Object.entries(CATEGORY_LABELS).map(([id, label]) => {
    const value = Number(report.tokens?.[id]) || 0;
    if (!value && id !== 'freshInput' && id !== 'output' && id !== 'cacheRead' && id !== 'cacheCreation') return '';
    return `<div class="token-category"><span>${esc(label)} · ${esc(rangeLabel)}</span><b>${short(value)}</b></div>`;
  }).join('');
  const models = (report.byModel || []).slice(0, 8).map((row) => `<div class="token-model"><span>${esc(row.model)}</span><small>${esc([row.provider, row.host, row.agent].filter(Boolean).join(' · '))}</small><b>${short(row.observedActivity)}</b></div>`).join('') || `<div class="empty">No observed model IDs in this period.</div>`;
  const providers = (report.byProvider || []).map((row) => `<div class="token-model"><span>${esc(row.provider)}</span><small>provider</small><b>${short(row.observedActivity)}</b></div>`).join('');
  return `<section class="token-module panel" data-token-period="${esc(selected)}">
    <header class="token-head">
      <div><span class="kicker">TOKEN ACTIVITY · ${esc(rangeLabel)}</span><h3>Observed token activity</h3></div>
      <p title="Includes cache reads/writes. Not the same as fresh tokens or subscription usage.">Includes cache reads/writes. Not billed usage. Fresh + Output · ${esc(rangeLabel)} is ${short(report.freshPlusOutput || 0)}.</p>
    </header>
    <button class="token-hero" data-token-expand="1" aria-expanded="${expanded}" title="Includes cache reads and writes. Fresh + Output excludes cache.">
      <span>${esc(rangeLabel)}</span>
      <strong>${short(report.observedActivity || 0, report.evidence)}</strong>
      <small>observed token activity${report.evidence === 'mixed' ? ` · includes ${short(report.estimatedObservedActivity || 0, 'estimated')} estimated` : report.evidence === 'estimated' ? ' · estimated' : ''}</small>
    </button>
    ${selected === 'today' ? scaleMarkup(visualScale) : ''}
    <div class="token-agents">${tokenBarRows(report.byAgent || [])}</div>
    ${comparison}
    <div class="token-periods">${TOKEN_PERIOD_BUTTONS.map(([id, label]) => `<button data-token-period="${id}" class="${id === selected ? 'selected' : ''}" aria-pressed="${id === selected}">${esc(label)}</button>`).join('')}</div>
    <div class="token-actions"><button class="text-action" data-token-explain="1" aria-expanded="${explainOpen}">Explain this number</button></div>
    <div class="token-detail" ${expanded ? '' : 'hidden'}>
      <div class="token-categories">${categories}<div class="token-category emphasis"><span>Fresh + Output · ${esc(rangeLabel)}</span><b>${short(report.freshPlusOutput || 0)}</b></div></div>
      ${providers ? `<h4>By provider</h4>${providers}` : ''}
      <h4>By model</h4>
      ${models}
    </div>
    ${explainOpen ? explainMarkup(report.explain, report, visualScale) : ''}
  </section>`;
}

export function startHereCard(lead) {
  if (!lead) return '';
  const rec = lead.recommendation || {};
  const agent = rec.agent || lead.lastAgent || 'agent';
  return `<section class="start-here panel">
    <div class="section-head"><div><h3>Start Here</h3><p>Where should I continue?</p></div></div>
    <p class="start-here-project">${esc(lead.project.name)}</p>
    <p class="start-here-agent">Continue in ${esc(agent)}</p>
    <p class="start-here-copy">${esc(rec.reason || 'Continue with the last observed agent.')}</p>
    <div class="resume-actions">
      <button class="primary" data-open-agent="${esc(agent)}" data-open-project="${lead.project.id}">Open in ${esc(agent)}</button>
      <button class="text-action" data-project="${lead.project.id}">Open project</button>
    </div>
  </section>`;
}

export function needsYouPanel(waiting = [], { notifyOn = false } = {}) {
  const items = waiting.slice(0, 1).map((item) => waitingRow(item)).join('');
  const extra = waiting.length > 1 ? `<details class="needs-you-more"><summary>${waiting.length - 1} more</summary>${waiting.slice(1).map(waitingRow).join('')}</details>` : '';
  const empty = `<div class="needs-you-empty">Nothing needs your attention right now.</div>`;
  return `<section class="needs-you panel ${waiting.length ? '' : 'is-empty'}">
    <div class="section-head"><div><h3>Needs You</h3><p>Only explicit, supported local attention signals.</p></div>${waiting.length ? `<label class="notify-opt"><input type="checkbox" id="notify-waiting" ${notifyOn ? 'checked' : ''}> Notify</label>` : ''}</div>
    ${waiting.length ? `${items}${extra}` : empty}
  </section>`;
}

function waitingRow(item) {
  return `<div class="waiting-row">
    <span class="waiting-agent">${glyph(item.agent)}</span>
    <div class="waiting-project"><strong title="${esc(item.projectName)}">${esc(item.projectName)}</strong><span class="waiting-agent-name">${esc(item.agent)}</span></div>
    <div class="waiting-state"><span class="state-badge needs-you">Needs you</span></div>
    ${item.projectId ? `<div class="waiting-action"><button class="primary" data-project="${item.projectId}">Open</button></div>` : ''}
  </div>`;
}

export function footerMarkup(release = {}) {
  const source = release.repositoryPublic && release.sourceUrl
    ? `<a href="${esc(release.sourceUrl)}" target="_blank" rel="noreferrer">${esc(release.sourceLabel || 'Source code')}</a>`
    : '';
  return `<p class="site-footer__line">
    ${source ? `${source} · ` : ''}© ${esc(release.year || 2026)}
    <a href="${esc(release.personalSite)}" rel="author" target="_blank">${esc(release.author)}</a>
    · <a href="${esc(release.articleUrl)}" target="_blank" rel="noreferrer">${esc(release.articleLabel || 'Read how this was built')}</a>
    · A product of <a href="${esc(release.organizationUrl)}" target="_blank" rel="noreferrer">${esc(release.organizationName)}</a>
  </p>`;
}

export function projectRootPrompt(settings = {}) {
  const current = (settings.projectsRoots || []).join(', ');
  return `<section class="setup-roots panel">
    <div class="section-head"><div><h3>Choose a projects folder</h3><p>Point this dashboard at the local folder that holds your Git projects. Nothing is uploaded. Dropbox is not required.</p></div></div>
    <label class="root-field">Projects folder<input id="projects-root-input" value="${esc(current)}" placeholder="/Users/you/Projects"></label>
    <button class="primary" id="save-projects-root">Save and scan</button>
  </section>`;
}
