# Adapter Expansion Plan

Research date: 2026-08-22. This is the integration-research and adapter-contract handoff. It does not authorize credentials, configuration changes, process launch, or new network calls.

## Executive decisions

1. Replace the implicit adapters in `src/core.js` with a registry of versioned, capability-declaring adapters before adding sources.
2. Make source lifecycle a normalized platform feature: **Installed**, **Historically observed**, **Active now**, and **Connected** are independent states.
3. Preserve exact observed model IDs. A model catalog enriches them after discovery; it does not pre-create every possible model.
4. Keep Local Core network-free. Connected Services and update checks are disabled by default and independently permissioned.
5. Add OpenRouter as the first connected adapter. Add Gemini CLI and OpenCode as the best early local adapters. Add Antigravity through closed-app discovery plus an optional CLI status-line bridge. Keep DeepSeek Harness feature-probed and explicitly experimental.
6. Treat OpenBot as design research only; the dashboard remains an observer, not a gateway or execution platform.

## Implemented registry/discovery status

The registry foundation is now implemented. Adapter manifests declare their version, capabilities, and optional execution-runtime presentation (`sourceKey`, agent, host, harness); local discovery and historical scans feed normalized lifecycle state and an observed identity registry. Each `ai-dashboard open` performs a bounded local discovery pass, known adapter roots are debounced, and a five-minute fallback notices supported local tools installed while the server runs. A new observed model retains its raw ID plus first/last-seen metadata and uses provider/letter branding if no dedicated asset exists.

Structural dashboard surfaces no longer allocate permanent Claude/Codex/Cursor slots: Live Agent Activity renders only registered local runtimes with validated live capability; token, capacity, efficiency, and share identity views consume normalized observations. OpenRouter remains a connected gateway/account, not a runtime lane; its synced model identities retain `gateway: OpenRouter` with unknown agent/host/project unless independently proven. Source-specific parsers and safe launch commands remain intentionally source-specific. An unsupported application may be displayed as detected with no telemetry adapter; it is never treated as supported usage.

Current implementation also includes a feature-probed Cline local adapter. Cline is one possible host for OpenRouter-routed inference, not an exclusive route: the normalized path may be `Cline → OpenRouter → provider → model`, while Claude Code, Codex, or another supported host may use the same gateway independently. The adapter reads only bounded session JSON/JSONL metadata and exact numeric usage fields where exposed; SQLite session indexes, provider settings, and inference credentials remain outside its read boundary. Cline has no capacity source of its own.

On the audited machine, Claude Code, Codex CLI, Cursor, and the Antigravity desktop application were detectable while closed. Their standard configuration/data roots also existed. Antigravity history roots contained no safely usable records in this probe, which is a valid **Installed, no history observed** state. DeepSeek Harness was not present. Current dashboard output already contained Claude/Codex/Cursor sessions; no prompts, message bodies, credentials, or raw tool payloads were inspected for this conclusion.

## Capability matrix

Legend: **Yes** is supported from a documented/stable source; **Experimental** uses versioned undocumented local storage; **Opt-in bridge** modifies one documented host integration after explicit approval; **Connected** requires a separately enabled credential; **Partial** means some records or account tiers expose it; **No** means the adapter must report unavailable.

| Source | Detect closed | History | Live | Tokens | Cost | Capacity | Models | Project attribution | Confidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Claude Code | Yes | Yes | Yes, file growth | Exact local events | Provider/local estimate where present | Opt-in status-line bridge | Exact observed IDs | Confirmed cwd; encoded-root Strong | High except account capacity bridge freshness |
| Codex CLI | Yes | Yes | Yes, file growth | Exact local events | Exact credits only when native fields say so; catalog otherwise | Native local rate-limit events | Exact observed IDs | Confirmed cwd | High |
| Cursor | Yes | Yes | Experimental local DB/transcripts | Yes, file/WAL signal | Exact/Estimated/Mixed | No supported local source | Partial | encoded path Strong; otherwise Unknown | Mixed; undocumented storage |
| Cline | Yes: CLI/root/known extension | Partial; feature-probed session JSON/JSONL | Structured session lifecycle when exposed | Exact local fields where exposed | Unavailable locally; OpenRouter billed aggregate remains separate | No Cline source | Exact observed IDs; configured route is not usage | Recorded workspace/cwd only when below known project | Partial; schema/version dependent |
| Antigravity | Yes: app/config/CLI | Only safe documented metadata; unavailable if opaque | Local file signal when proven; CLI bridge | Opt-in CLI status-line exact current/session fields | No historical bill source | Opt-in CLI status-line quota buckets | Exact status-line IDs; history partial | status-line workspace/cwd Confirmed | High for documented bridge, Unknown for opaque IDE history |
| OpenRouter | Connected/config hint only | Connected Analytics API | Connected polling, not remote streaming | Exact | Exact billed | Credits/key limits | Exact catalog and observed IDs | Key/workspace/app/session partial; local correlation otherwise inferred | High for API fields; project mapping Partial |
| DeepSeek Harness | Yes, after adapter | Feature-probed JSONL/SQLite | File growth/process hint | Exact only where usage events exist | Provider-reported only; catalog estimate separate | Provider-specific only | Exact per request | header cwd Confirmed | Experimental; version/feature dependent |
| OpenCode | Yes | Yes | File growth; server only if already running | Exact stats/session fields | Exact when recorded; catalog otherwise | Provider-specific only | Exact observed | project/cwd | High for documented CLI/storage |
| Gemini CLI | Yes | Yes, retained sessions | File growth | Exact session schema | Catalog equivalent only unless billed field exists | No automatic interactive `/stats` | Exact observed | project-specific history root | High with fixture/version guard |
| Kimi CLI | Yes | Yes | File growth | Partial after safe event fixture audit | Provider field only | No documented noninteractive source | Exact observed | cwd-grouped sessions | Medium; strict allowlist required |
| VS Code / Copilot | Yes | History presence; metadata only initially | Host/session file signal after fixtures | Unavailable initially | Unavailable locally | External/account only | Partial | repository/workspace metadata | Medium for presence; low for tokens |
| Windsurf / Devin Desktop | Yes | Presence/metadata initially | File signal after fixtures | Unavailable locally initially | Connected Enterprise analytics only | Native UI/account | Partial | Enterprise dimensions may be partial | Medium local, High API fields |
| Zed | Yes | Fixture research required | File signal after fixtures | Unavailable initially | Native billing or provider connector | Native account page | Provider config/observed partial | workspace metadata if stable | Low until fixtures |
| JetBrains AI / Junie | Yes | Metadata only initially | IDE signal after fixtures | Unavailable locally | Native account credits | Native IDE widget | Partial | project metadata | Medium presence, unavailable usage |

Sources: [Claude status line](https://code.claude.com/docs/en/statusline), [OpenRouter analytics](https://openrouter.ai/docs/cookbook/administration/analytics-cost-control), [Antigravity status line](https://antigravity.google/docs/cli/statusline/), [DeepSeek Harness sessions](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/session.md), [OpenCode CLI](https://opencode.ai/docs/cli/), [OpenCode storage](https://dev.opencode.ai/docs/troubleshooting/), [Gemini session management](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/session-management.md), [Kimi sessions](https://www.kimi.com/code/docs/en/kimi-code-cli/guides/sessions), [VS Code session insights](https://code.visualstudio.com/docs/copilot/chat/session-insights), [Windsurf URLs now redirecting to Devin Desktop analytics](https://docs.windsurf.com/windsurf/accounts/analytics), [Zed API providers](https://zed.dev/docs/ai/use-api-access), [JetBrains usage](https://www.jetbrains.com/help/ai-assistant/licensing-and-subscriptions.html).

## Stable adapter contract

Create `src/adapters/` and keep the contract small. An adapter module exports a declaration and only the functions it supports:

```js
export const manifest = {
  id: 'openrouter',
  contractVersion: 1,
  adapterVersion: 1,
  displayName: 'OpenRouter',
  kind: 'connected-service',
  risk: 'network-opt-in',
  capabilities: {
    discover: 'connected',
    history: 'exact',
    live: 'polling',
    tokens: 'exact',
    cost: 'provider-billed',
    capacity: 'credits-and-key-limits',
    models: 'exact',
    projects: 'partial',
    health: true
  }
};

export async function discover(context) {}
export async function historicalSessions(context, cursor) {}
export async function liveActivity(context, cursor) {}
export async function tokenUsage(context, cursor) {}
export async function capacity(context) {}
export async function models(context, cursor) {}
export async function projects(context, cursor) {}
export async function health(context) {}
```

The runtime never assumes every function exists. Manifest values describe semantics, not just booleans. `tokens: 'mixed'` and `cost: 'list-price-equivalent'` are meaningfully different from exact/provider-billed.

### Context supplied to adapters

- allowlisted platform paths and configured project roots;
- read-only filesystem and SQLite helpers;
- normalized identity/model registries;
- abort signal, time budget, and bounded logger;
- credential lookup by opaque reference for enabled connected adapters;
- permission snapshot (`localRead`, `network`, `localIntegrationWrite`, `externalModification`);
- prior adapter cursor/fingerprints, never another adapter's private state.

Adapters do not receive a general shell, unrestricted home traversal, browser cookies, raw credential values in logs, or permission to start a host application.

### Normalized source lifecycle

```text
SourceState
  sourceId, adapterVersion
  installed: { state, version?, evidence[], observedAt }
  history: { state, recordCount?, newestAt?, reason? }
  live: { state, lastEventAt?, evidence?, freshness }
  connection: { state, accountLabel?, credentialRef?, checkedAt?, errorCode? }
  health: { level, code, detail, checkedAt }
```

Allowed states are explicit. `installed.state`: detected/not-detected/unknown. `history.state`: observed/none-yet/unsupported/permission-needed/error. `live.state`: active/recent/idle/unsupported/unknown. `connection.state`: disabled/configured/connected/expired/error/not-applicable. UI copy derives from these fields instead of ad hoc source checks.

### Adapter result envelope

Every observation includes:

- `sourceId`, `adapterVersion`, source schema/version if known;
- `observedAt` and event timestamp separately;
- stable source record ID or collision-resistant fingerprint;
- `evidence` (Exact/Estimated/Mixed/Unavailable) and derivation code;
- `freshness` and parse warnings;
- identity fields as observed plus normalized IDs;
- project attribution and confidence;
- cost semantic and pricing version where applicable;
- no prompt, response, code, tool arguments/results, cookies, tokens, or secret headers.

Malformed or future-version records are counted in adapter health and skipped. They do not abort the whole scan.

## Identity and model discovery

Add a registry that separates these axes:

```text
host/surface -> harness -> agent -> provider -> model exact ID -> model family
account/quota bucket (separate)
project/workspace (separate, confidence-bearing)
```

Examples:

- Kimi K2.5 through Claude Code: host `claude-code`, agent/provider `moonshot`, exact model observed; it is not a Claude model.
- OpenRouter serving DeepSeek: source/account `openrouter`, provider dimension from OpenRouter, exact OpenRouter model ID, project only if independently attributable.
- DeepSeek Harness using an OpenAI model: harness `deepseek-harness`, surface `dsh-web` or CLI, provider/model per request.

The lifecycle is:

1. Discover exact IDs from actual records or documented APIs.
2. Normalize aliases with a versioned registry while retaining the raw ID.
3. Enrich from provider catalogs (OpenRouter's `canonical_slug` and pricing are useful) only when enabled/available.
4. Mark aliases/families stale or ambiguous rather than guessing.
5. Keep historical unknown models visible with fallback branding.

Do not pre-create all models. Pre-register source/host brands and a small alias rule set; create model rows only when observed or returned by a connected account's catalog/query. `src/identity.js`, `src/brands.js`, and `public/brands.js` should consume one shared data registry or generated public subset.

## Discovery rules when applications are closed

Initial setup must not ask users to launch every IDE. Detection proceeds through read-only evidence:

1. executable in PATH and safe `--version` only for documented non-mutating CLIs;
2. OS application installation metadata;
3. standard config/data root existence;
4. installed extension/plugin inventory;
5. retained session metadata;
6. currently running process only for **Active now**.

No process is launched solely for discovery. No browser/session credential store is read. A detected app with no records is **Installed but no history yet**. An adapter that needs one real session says **Needs one session**. An unsupported format says **History unavailable in this version**, not Not detected.

## OpenRouter connector

### Credential and endpoint decision

Use a **Management API key** for Analytics and credits. It cannot make model requests and is intentionally separate from inference keys. Store it in the platform credential store (macOS Keychain, Windows Credential Manager, Linux Secret Service) or accept a process environment variable; persist only an opaque credential reference and redacted suffix. Never write the key into dashboard JSON or logs. [Management key boundary](https://openrouter.ai/docs/guides/overview/auth/management-api-keys)

The connector has an allowlist of read endpoints:

- `GET /api/v1/analytics/meta`
- `POST /api/v1/analytics/query`
- `GET /api/v1/credits`
- public model catalog endpoint
- optional `GET /api/v1/generation?id=...` only for a generation ID already present in analytics/local evidence
- `GET /api/v1/key` only when the user deliberately connects an inference key for its own limits; this is a separate credential role.

Never call key create/update/delete endpoints. Test the URL and HTTP method allowlist directly.

### Schema discovery and storage

Call Analytics `/meta` before composing queries and cache its returned metric/dimension/operator/granularity schema with an expiry. Query only fields advertised by that response. At the current documentation date, useful metrics include usage/cost components, request count, prompt/completion/reasoning tokens, and cache hit rate; useful dimensions include model, provider, API key, app, workspace, user, origin, finish reason, session, and generation. The API is beta, queries are currently constrained to at most two dimensions, counts may be encoded as strings, and `metadata.truncated` must be inspected. [Analytics API](https://openrouter.ai/docs/cookbook/administration/analytics-cost-control)

Store aggregate time buckets and stable IDs, not raw response bodies. Never query or store prompt detail even if an account has prompt logging enabled. Use generation details only to fill documented numeric/identity fields. [Generation fields](https://openrouter.ai/docs/api/api-reference/generations/get-generation)

### Project attribution

OpenRouter does not inherently know the dashboard's Git project. Attribution confidence order:

1. Confirmed: a connected API key/workspace is explicitly mapped by the user to one project, or a session/request ID exactly matches local harness evidence with confirmed cwd.
2. Strong: an existing OpenRouter key/workspace naming convention is mapped by an explicit rule and previewed.
3. Weak: timestamp/model correlation, never included in project headlines by default.
4. Unknown: retain globally.

Do not automatically create per-project keys. `HTTP-Referer` and `X-OpenRouter-Title` identify an application and can affect public app attribution; they are not private Git project tags. Do not inject `user` or `session_id` into arbitrary host requests. [App attribution](https://openrouter.ai/docs/app-attribution), [user tracking](https://openrouter.ai/docs/cookbook/administration/user-tracking)

### Refresh behavior

Connected polling runs only while enabled. Use backoff and conditional/scheduled refresh: credits/key limits every 5–15 minutes while UI is open, analytics aggregates every 15 minutes with a manual refresh, model catalog daily, and no background network when the local service is stopped. Display last successful refresh and retain stale prior data after transient failures.

## Google Antigravity adapter

Antigravity 2.0 presents IDE, CLI, and SDK as separate surfaces, so the source identity must retain surface. [Surface overview](https://cloud.google.com/blog/topics/developers-practitioners/choosing-your-surface-antigravity-20-antigravity-cli-antigravity-ide-or-antigravity-sdk)

### Closed discovery

- detect application bundle/install metadata, the `agy` CLI when present, and standard Gemini/Antigravity roots;
- detect safely parseable historical metadata only after fixture review;
- do not parse opaque protobuf/cache databases merely because files exist;
- do not scrape authenticated Electron state, cookies, or account tokens.

### Optional status-line capture

The documented CLI status-line JSON is the smallest trustworthy bridge. It includes cwd/workspace, session/conversation/transcript path, model ID/display name, context input/output/cache fields, quota map with remaining fraction and reset time, plan tier, agent state, and execution mode. The setup screen previews a helper and a settings change, preserves/chains existing status-line behavior where the host format supports it, asks for explicit **Enable local integration** approval, and writes only allowlisted numeric/identity fields to the dashboard data directory. [Status-line schema](https://antigravity.google/docs/cli/statusline/)

Quota rows retain their bucket identity because several models may share one quota. Historical snapshots are shown with timestamps and become stale; they are not copied onto each model. The bridge requires a real Antigravity CLI session to emit data. The dashboard must never run `agy -p '/usage'`: current issue evidence shows that form is interpreted as a model prompt and can consume quota rather than invoke the interactive command. [CLI issue 234](https://github.com/google-antigravity/antigravity-cli/issues/234)

The capture allowlist excludes `email`, transcript content, arbitrary paths not needed for project attribution, VCS details beyond the normalized project evidence, and sandbox configuration. It may retain a session/conversation ID and normalized workspace/cwd, but it never opens the advertised `transcript_path`. IDE history/token support remains unavailable until a stable allowlisted record format is proven. Installed IDE support can ship without pretending that history exists.

## DeepSeek Harness adapter

DeepSeek Harness is MIT-licensed and explicitly a developer preview whose plugin-oriented internals may break. [Repository](https://github.com/deepseek-ai/deepseek-harness), [architecture](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)

Today the dashboard would not detect it. The smallest adapter should:

1. detect `dsh`, npm package metadata, `DSH_HOME`/default `~/.dsh`, and settings without launching the harness;
2. record exact harness version and declare compatible version ranges;
3. feature-probe settings for session backend and root rather than assuming a universal location;
4. support JSONL and SQLite through separate readers;
5. parse only header/event envelopes needed for session ID, cwd, time, request provider/model, usage, status, and errors;
6. exclude prompt/message text, tool arguments/results, files, and provider credentials;
7. derive live activity from supported file growth and an already-running process, never start it;
8. degrade per capability when a new schema appears.

Session persistence is pluggable. Event logs can contain cwd, request provider/model, usage including failed attempts, and typed tool records; those same logs can contain sensitive bodies, so an allowlist parser is mandatory. [Session subsystem](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/session.md), [settings](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/settings/settings-file/README.md), [Python SDK session root](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/python-sdk.md)

Do not enable or consume Harness OpenTelemetry. Its telemetry can include prompt/tool content depending on configuration; the dashboard needs only retained local structural events, and current Harness work makes telemetry default-off. [Telemetry default-off note](https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/implemented/feature/2026-08-10-telemetry-default-off.md)

## OpenBot lessons

OpenBot is MIT and alpha. Useful transferable patterns from its current design are:

- external agents register explicitly behind a protocol/endpoint boundary;
- registration and health are separate from capabilities;
- credentials are write-only and never returned to normal UI reads;
- policy fails closed;
- an action audit record is created before execution and ends permitted/refused/failed with the responsible rule;
- startup performs migration/health checks and gives concrete next steps.

These patterns should influence connected adapters and future capability updates. [OpenBot repository](https://github.com/CopilotKit/OpenBot)

Do **not** copy its per-bot computer/container model, browser-control stack, shell action gateway, PostgreSQL/pgvector infrastructure, enterprise authentication, Docker/Bun deployment, or generative agent UI. The dashboard does not run agents and should not grow a general action platform.

## Priority after the foundation

1. **OpenRouter connected adapter:** highest new cross-tool value; documented exact cost/token analytics; bounded credential review required.
2. **Gemini CLI local adapter:** documented retained project sessions and exact token schema make it a strong closed-app source.
3. **OpenCode local adapter:** documented storage plus JSON session listing/stats; avoid full transcript export.
4. **Antigravity discovery + optional status-line bridge:** valuable installed/quota visibility, but split closed discovery from opt-in capture.
5. **DeepSeek Harness:** useful architectural test, behind Experimental because storage is pluggable and project is preview.
6. **Kimi CLI:** good documented session roots; ship after strict sensitive-event fixture audit.
7. **VS Code/Copilot metadata:** add host/history presence first; defer token claims.
8. **Windsurf / Devin Desktop, Zed, JetBrains:** detect installed surfaces and preserve historical product aliases; connected/team analytics only when user demand and official interfaces justify it.

Cursor work in this phase is UX and import research, not credential extraction or unsupported API reverse engineering.

## Required tests

- contract validation rejects unknown capabilities and unsafe risk combinations;
- one adapter failure does not suppress other adapters;
- fixture tests include valid, partial, malformed, future-version, duplicate, and prompt-bearing records;
- snapshots assert forbidden fields never enter normalized output or logs;
- exact/estimated/unavailable and cost semantics survive aggregation;
- raw and normalized identities round-trip without model-family loss;
- closed detection uses no host launch and no network;
- OpenRouter endpoint/method allowlist, redaction, 401/403/429/backoff, schema change, truncation, string counts, and stale cache;
- Antigravity settings preview/chaining/rollback and quota-bucket non-duplication;
- DeepSeek JSONL/SQLite feature probing and unsupported-version degradation;
- browser states for Detected, Used before, Installed/no history, Needs one session, Connect, Disabled, Stale, and Error.

## Must-not-change invariants

- localhost/private by default;
- no prompts, code, transcript bodies, tool payloads, or secrets in the index;
- no cookies/JWTs/private authenticated endpoint scraping;
- no app/process launch for discovery;
- no network in Local Core;
- missing fields remain unavailable;
- capacity remains separate from token activity;
- installed/history/live/connected remain independent;
- the dashboard observes harnesses; it does not orchestrate them.
