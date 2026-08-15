const fmt = (n) => new Intl.NumberFormat().format(n || 0);
const short = (n) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : fmt(n);
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
  const name = String(agent || '').toLowerCase();
  const file = ['claude', 'codex', 'cursor'].includes(name) ? name : null;
  if (!file) return `<span class="agent-glyph unknown ${size}" aria-hidden="true">${esc((agent || '?').slice(0, 1))}</span>`;
  return `<span class="agent-glyph ${name} ${size}" aria-hidden="true"><img src="/assets/agents/${file}.png" alt=""></span>`;
}

export function tokenBarRows(contributions = []) {
  const available = contributions.filter((row) => row.available);
  const peak = Math.max(1, ...available.map((row) => row.observedActivity || 0));
  return contributions.map((row) => {
    if (!row.available) {
      return `<div class="token-agent is-unavailable">${glyph(row.agent)}<div><strong>${esc(row.agent)}</strong><small>Unavailable</small></div><b>Unavailable</b></div>`;
    }
    const width = Math.max(3, ((row.observedActivity || 0) / peak) * 100);
    const share = Math.round((row.share || 0) * 100);
    return `<div class="token-agent">${glyph(row.agent)}<div><strong>${esc(row.agent)}</strong><span class="token-track" aria-hidden="true"><i style="width:${width}%"></i></span></div><b>${short(row.observedActivity)} · ${share}%</b></div>`;
  }).join('');
}

export function tokenModule(report = {}, { selected = 'today', yesterday = null, expanded = false } = {}) {
  const today = selected === 'today';
  const comparison = today && yesterday ? `<div class="token-yesterday"><span>Yesterday</span><strong>${short(yesterday.observedActivity || 0)}</strong></div>` : '';
  const categories = Object.entries(CATEGORY_LABELS).map(([id, label]) => {
    const value = Number(report.tokens?.[id]) || 0;
    if (!value && id !== 'freshInput' && id !== 'output' && id !== 'cacheRead' && id !== 'cacheCreation') return '';
    return `<div class="token-category"><span>${esc(label)}</span><b>${short(value)}</b></div>`;
  }).join('');
  const models = (report.byModel || []).slice(0, 8).map((row) => `<div class="token-model"><span>${esc(row.model)}</span><small>${esc([row.provider, row.host, row.agent].filter(Boolean).join(' · '))}</small><b>${short(row.observedActivity)}</b></div>`).join('') || `<div class="empty">No observed model IDs in this period.</div>`;
  return `<section class="token-module panel" data-token-period="${esc(selected)}">
    <header class="token-head">
      <div><span class="kicker">TOKEN ACTIVITY</span><h3>${esc(report.label || 'Observed token activity')}</h3></div>
      <p>Observed token activity includes cache. Fresh + Output is ${short(report.freshPlusOutput || 0)}. This is not billed subscription usage.</p>
    </header>
    <button class="token-hero" data-token-expand="1" aria-expanded="${expanded}">
      <span>${esc(today ? 'Today' : report.label || 'Selected period')}</span>
      <strong>${short(report.observedActivity || 0)}</strong>
      <small>observed token activity</small>
    </button>
    <div class="token-agents">${tokenBarRows(report.byAgent || [])}</div>
    ${comparison}
    <div class="token-periods">${TOKEN_PERIOD_BUTTONS.map(([id, label]) => `<button data-token-period="${id}" class="${id === selected ? 'selected' : ''}" aria-pressed="${id === selected}">${esc(label)}</button>`).join('')}</div>
    <div class="token-detail" ${expanded ? '' : 'hidden'}>
      <div class="token-categories">${categories}<div class="token-category emphasis"><span>Fresh + Output</span><b>${short(report.freshPlusOutput || 0)}</b></div></div>
      <h4>By model</h4>
      ${models}
    </div>
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
