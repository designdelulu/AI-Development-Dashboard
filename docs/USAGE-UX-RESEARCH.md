# Usage UX Research

Research date: 2026-08-22. This document separates observed facts from product recommendations. Product limits, fields, and interfaces are expected to change; links point to the source used for each current claim.

## Decision

The dashboard should answer four questions in order:

1. **Can I keep working?** Show remaining plan capacity, reset time, connected-service balance, and source freshness.
2. **What is consuming it?** Show tokens, requests, cost, cache, and model/provider/project contribution for the selected period.
3. **Is the pattern changing?** Show history, burn rate, and a conservative projection only where the evidence supports one.
4. **Which setup works better?** Compare like-for-like model or capability cohorts only after task and outcome evidence exists.

This is an operations dashboard, not a billing replica and not a leaderboard. The first screen should remain useful in roughly ten seconds; advanced provider dimensions belong in drill-down.

## Current product audit

The current dashboard already gets several hard things right:

- plan capacity is separate from local token activity;
- token categories and Exact / Estimated / Mixed / Unavailable evidence are explicit;
- the selected calendar range applies consistently;
- activity is not presented as remote inference or productivity;
- project attribution has a confidence boundary;
- missing evidence is not converted to zero.

The next pass should preserve those semantics while reducing the amount a user must mentally join. Today, plan capacity lives in Live Feed while historical token analysis and projects are elsewhere. The Overview should gain a compact **Usage now** strip that links to one dedicated Usage workspace. It should not duplicate every chart.

## Competitive and interface audit

| Product | Strongest information-architecture lesson | Boundary or caution |
| --- | --- | --- |
| Claude Code | Its status line keeps model, context, cost, duration, and Git context close to the active session. Official JSON distinguishes estimated session cost and context-window token counts. | Context usage, API cost, and subscription capacity are different concepts. The dashboard must not collapse them. [Status-line fields](https://code.claude.com/docs/en/statusline) |
| Codex | Current usage is surfaced in a Usage panel; plan limits and purchased credits are account concepts. Current credit charging is token-category based. | Local transcript tokens are evidence of model activity, not automatically the account credit ledger. [Codex rate card](https://help.openai.com/en/articles/20001106) |
| Cursor | Account usage belongs in Cursor's own dashboard; Team/Enterprise analytics adds exportable organization views. | Do not scrape authenticated pages or claim that undocumented local SQLite equals billing. Offer a stable external link and a user-selected export import when the account provides one. [Models and pricing](https://cursor.com/docs/models-and-pricing), [team analytics](https://cursor.com/docs/account/teams/analytics) |
| Google Antigravity | `/usage` or `/quota` shows a quota view, while the documented CLI status-line JSON exposes structured model, context, quota bucket, remaining fraction, and reset fields. | A quota bucket can cover a model group. Do not clone account quota onto every observed model. [Usage command](https://www.antigravity.google/docs/cli/commands/usage), [status-line schema](https://antigravity.google/docs/cli/statusline/) |
| OpenRouter | The Activity experience starts with spend, requests, token volume, cache rate, and blended cost, then drills into model/provider/key/app/workspace/session and latency. | The Analytics API is beta and schema-discoverable. The dashboard should expose a focused cross-tool slice, not rebuild OpenRouter's explorer. [Activity dashboard](https://openrouter.ai/blog/announcements/activity-dashboard/), [Analytics API](https://openrouter.ai/docs/cookbook/administration/analytics-cost-control) |
| ccusage | Compact daily/monthly/model tables and explicit API-equivalent cost make local logs legible. JSON output is a useful interoperability model. | API-equivalent cost is not subscription spend. Model pricing coverage must be visible. [JSON output](https://github.com/ccusage/ccusage/blob/main/docs/guide/json-output.md) |
| CodeBurn | One range drives project, model, activity, tools, skills, agents, cache, rework, and cost breakdowns. It emphasizes a path from cost to project/task. | Its one-shot and efficiency concepts are hypotheses to validate, not definitions to copy. [Product overview](https://codeburn.app/), [source](https://github.com/getagentseal/codeburn) |
| Zed | Hosted usage is token-priced and visible through account billing; provider API access is clearly separated from hosted access. | Provider keys remain provider billing, and Zed stores configured keys in the system keychain. This supports the dashboard's local-vs-connected distinction. [Plans and usage](https://zed.dev/docs/account/plans-and-pricing), [API access](https://zed.dev/docs/ai/use-api-access) |
| Windsurf / Devin Desktop | The former Windsurf documentation URLs now redirect to Devin Desktop documentation. Personal analytics focuses on completion behavior; team analytics adds code contribution, tools, and credit consumption. Enterprise exposes an authenticated analytics API. | Preserve Windsurf as a historical/source alias while treating the current product identity as Devin Desktop. Enterprise/team analytics is not a general personal connector. Do not request a service key unless an organization administrator deliberately configures it. [Analytics](https://docs.windsurf.com/windsurf/accounts/analytics), [Analytics API](https://docs.windsurf.com/windsurf/accounts/api-reference/analytics-api-introduction) |
| JetBrains AI | The IDE widget emphasizes credits remaining, overall progress, and reset date. Guidance explains that long context and expensive models affect usage. | Credits are an account quota, not a cross-provider token unit. No local parsing plan should imply otherwise. [Plans and usage](https://www.jetbrains.com/help/ai-assistant/licensing-and-subscriptions.html) |

Tokscale and similar community tools reinforce the popularity of model/day/project tables, but no decision in this plan depends on an undocumented product claim from them.

## Recommended information hierarchy

### At a glance

Show at most five items in the Overview **Usage now** strip:

- **Capacity:** lowest remaining supported account window, with provider/plan, reset time, and freshness.
- **Today:** total observed token activity, with Exact/Estimated mix.
- **This month:** provider-billed spend where connected; otherwise list-price equivalent with its label.
- **Active sources:** live/connected/stale/error count with one health link.
- **Top contributor:** model or project for the selected metric, never an opaque composite score.

If capacity is unavailable, the card says why: Not supported, Waiting for first session, Integration disabled, Stale, or Error. It must not show 0%.

### Usage workspace

Use one page with four progressive layers:

1. **Now:** quota/balance cards and reset clocks. Account buckets stay visually separate from model rows.
2. **Period:** a time-range control drives tokens, requests, cost, cache, errors, and activity. Default is Last 7 days for history and Today for the compact Overview strip.
3. **Breakdown:** model, provider, host, project, source, and evidence. Only show dimensions actually present.
4. **Explain:** source, timestamp/freshness, calculation, coverage, exact/estimated portions, exclusions, and link to the native provider dashboard.

The default chart set should be small:

- token categories over time;
- cost over time, split by cost semantic;
- contribution table with sortable model/project/provider rows;
- capacity timeline only after the dashboard has collected more than a single current snapshot.

Latency percentiles, finish reasons, API-key/workspace dimensions, reasoning-token composition, request errors, and overages remain collapsed until the selected source exposes them.

### History and compare

- Compare equivalent ranges and show the sample count on every comparison.
- Prefer medians and interquartile ranges for task-level token/cost/duration metrics; totals remain appropriate for budget views.
- Keep model identity as the exact observed ID plus provider and host. A friendly family name is a grouping, never a replacement.
- Do not rank model efficiency until task boundaries and outcomes are available. Usage alone can rank consumption, not value.

## Metric presentation rules

| Concept | Default label | Required qualifier |
| --- | --- | --- |
| Provider invoice amount | Provider-billed cost | Source and retrieval time |
| OpenRouter generation/analytics cost | OpenRouter billed cost | Exact endpoint/source; query coverage |
| Catalog calculation | List-price equivalent | Pricing snapshot/version and coverage |
| Subscription use | Plan capacity used/remaining | Window and reset time |
| Token log sum | Observed token activity | Exact/estimated composition |
| Context-window fields | Current context | Never added to historical usage totals without event semantics |
| Project mapping | Project contribution | Confirmed/Strong/Weak/Unknown attribution |
| Forecast | Projected period total | Formula, observation window, and uncertainty state |

Fresh input, output, cache read, cache creation, and reasoning/other remain distinct. Cache hit rate should state its denominator. Unknown cost must be excluded from cost totals with pricing coverage shown; it must not become zero-cost usage.

## Confidence and freshness UX

Every derived value should carry two orthogonal properties:

- **Evidence:** Exact, Estimated, Mixed, or Unavailable.
- **Freshness:** Live, current as of timestamp, stale, or error.

Project attribution confidence is a third property and should appear only where attribution is relevant. Avoid badge overload on headline cards: show one compact phrase such as “Exact · refreshed 2m ago,” with full provenance in Explain.

Suggested stale thresholds are adapter-owned rather than global. A local history scan may be current for five minutes; OpenRouter analytics can be considered current after a successful scheduled refresh; a status-line quota snapshot should become stale after its advertised reset or a conservative adapter threshold. Stale data remains visible with its timestamp.

## OpenRouter-specific slice

The connected card should show credits remaining, current-period billed spend, requests, tokens, cache rate when available, and top model. Drill-down can query up to two dimensions after first calling `/api/v1/analytics/meta`, because documented analytics capabilities are discoverable and evolving. Generation detail may provide exact native token categories, cost, provider, latency, request, and session identity. The connector must not retrieve prompt bodies. [Usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting), [generation lookup](https://openrouter.ai/docs/api/api-reference/generations/get-generation)

## Cursor-specific slice

Add one **View Cursor Usage** action that opens `https://cursor.com/dashboard` in the user's normal browser. Do not iframe it. Add **Import usage export** only after fixtures establish the current schemas offered to individual and organization accounts. Import is a user-selected file, is previewed before ingestion, and reports which columns can or cannot map to models, projects, tokens, requests, and spend. Retain the current experimental local-token evidence as a separate local source.

## Accessibility and density acceptance

- Capacity never relies on color alone; include percentage, reset time, and provider name.
- Tables remain usable at 200% zoom and by keyboard.
- Tooltips are supplementary; provenance is reachable without hover.
- Number abbreviations reveal exact values on focus/click.
- Mobile may stack the at-a-glance cards, but the primary acceptance target remains laptop/desktop.
- No default view has more than one primary chart and one contribution table above the fold.

## What not to claim

- tokens equal work, quality, or productivity;
- more cache is always better;
- subscription capacity can be reconstructed from local tokens;
- list-price equivalent is money paid or saved;
- requests are comparable across tools;
- a model is efficient without comparable task/outcome evidence;
- inactive local file growth proves remote inference;
- missing telemetry means zero use.

## Implementation implications

This UX requires the normalized store to add source health, freshness, cost semantics, capacity bucket identity, and calculation provenance before adding charts. It does not require a framework rewrite. Existing `public/app.js`, `public/live-ui.js`, `public/overview-copy.js`, `public/signal-field.js`, and the current CSS can host the first pass after the server/index contracts are extended.
