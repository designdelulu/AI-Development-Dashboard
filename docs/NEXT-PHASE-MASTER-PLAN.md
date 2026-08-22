# Next-Phase Master Plan

Planning date: 2026-08-22. This is the canonical plan for the next implementation passes. The five companion documents contain deeper research and must be treated as normative where referenced:

- `docs/USAGE-UX-RESEARCH.md`
- `docs/ADAPTER-EXPANSION-PLAN.md`
- `docs/CAPABILITY-UPDATES-PLAN.md`
- `docs/EFFICIENCY-ANALYTICS-PLAN.md`
- `docs/INSTALL-EXPERIENCE-PLAN.md`

No product code, credentials, tool configuration, capability installation/update, or external publication changed during this planning pass.

## Product decisions

1. The dashboard remains a lightweight local analytics/operator layer. It does not become an inference proxy, harness, agent gateway, browser controller, or package manager.
2. **Local Core** remains network-free and read-only by default. **Connected Services**, **update checks**, **local integration writes**, and **external capability modifications** are distinct permissions.
3. Source lifecycle becomes foundational: Installed, Historically observed, Active now, and Connected are independent states.
4. Introduce a stable, versioned adapter registry before adding new sources. Adapters declare partial capabilities and degrade independently.
5. Preserve exact observed model identity across host, harness, agent, provider, and model. Pre-register brands/aliases, not every possible model row.
6. OpenRouter is the first connected service. Gemini CLI and OpenCode are the strongest early local adapters. Antigravity is split into closed-app discovery and an optional documented CLI status-line capture. DeepSeek Harness remains Experimental and feature-probed.
7. Cursor gets a better native-dashboard entry point and later user-selected export import; no credential extraction, web scraping, or unsupported private API.
8. Capability provenance/update **discovery** precedes any update execution. Observe only is default; no silent mutation and no initial Update all.
9. Efficiency begins with event/cycle/outcome semantics and evidence readiness, not a score. Controlled trials and observational comparisons are visibly different.
10. Installation moves to a lifecycle CLI (`open/start/stop/status`) and npm distribution first; signed standalone executables follow. No Electron decision is needed.

## Current-state findings

### Repository

- Node >=20, dependency-free runtime/UI, normalized local index, localhost server, incremental file watching, and 92 passing tests.
- `src/core.js` owns adapters and much normalization in one dense module; `src/cli.js` mixes command/server/routes/lifecycle; `src/identity.js` hard-codes model patterns; `public/brands.js` assumes the current known brands.
- Claude and Codex have stable local JSONL sources. Cursor has experimental read-only SQLite/transcript support with Exact/Estimated/Mixed token evidence.
- Codex capacity is read from native structured events. Claude capacity uses an explicit optional status-line helper. Cursor capacity is unavailable.
- `src/telemetry-contract.js` is a descriptive future contract, not a runtime adapter API.
- Capability grouping/ownership is already conservative and suitable to extend, but source/version/update state is largely unknown.
- First run is only a project-root input; lifecycle is developer-oriented (`npm start`, manual browser).

### Read-only local audit

- Claude Code 2.1.198, Codex CLI 0.41.0, Cursor 3.16.29, and Antigravity app 2.8.1 were detectable while closed.
- Standard Claude/Codex/Cursor/Gemini/Antigravity/VS Code data roots existed. Antigravity retained-history roots did not contain safely supported history in this snapshot; that must display as Installed/no history, not failure.
- Caveman existed through Claude marketplace checkout/cache. Its trustworthy installed identity was a Git commit when no semantic plugin version was present; a nearby package `0.1.0` was not the product version.
- The current generated dashboard index had 14 projects, 240 sessions, 61 capability parents, and no harness runs at audit time. These counts are local snapshot evidence, not fixtures or product assumptions.

## Documentation drift

Fix these in the first documentation-only implementation commit:

- README's supported-source table says Cursor local token telemetry is unavailable, but code/tests/docs now support experimental Exact/Estimated/Mixed local token telemetry. Use the precise `docs/TELEMETRY.md` wording.
- README limitation can still say Cursor telemetry is undocumented/experimental and may degrade; that is not a contradiction once the table is corrected.
- README must stop implying that clone/install/start/manual URL is the intended polished lifecycle after lifecycle commands ship.
- Privacy/security text must be revised **before** enabling OpenRouter, update checks, or capability mutation; current no-network promises remain true until then.
- If index `generatedAt` may legitimately be null while summary `lastScanAt` exists, document the distinction; otherwise add a test and fix in the schema-foundation unit.

## Target architecture

```text
                      explicit permissions
                local read | network | local write | external modify
                                  |
local files/DBs ---> adapter registry ----> observation envelopes ----┐
connected APIs ---> adapter registry ----> observation envelopes ----┤
optional bridges --> adapter registry ----> observation envelopes ----┤
                                                                      v
 identity/model registry --> normalized index + source health + user metadata
                                      |                 |
                                      v                 v
                               localhost API       metric engine
                                      |                 |
                                      +------ browser UI+

native capability managers <--- preview/journal/policy boundary (later; never implicit)
```

### Ownership boundaries

- Adapters parse and report observations; they do not render UI or mutate other tools.
- Identity registry normalizes while preserving raw values.
- Metric engine owns definitions, evidence eligibility, and cost semantics.
- Lifecycle owns process/port/runtime state and localhost security.
- Permissions are centralized and checked server-side.
- User metadata (project classification, cycle grouping, outcomes, connection settings) remains outside scanner-derived output.
- External capability changes pass through policy, preview, journal, native manager, verification, and optional rollback.

## Adapter system

Create `src/adapters/registry.js`, `contract.js`, `context.js`, and one directory per source. Migrate current sources without changing normalized output before adding new records. Each manifest declares discovery/history/live/tokens/cost/capacity/models/projects/health semantics, adapter version, risk class, and compatibility. Missing functions are supported behavior, not errors.

Every result carries source/adapter/schema version, event and observation timestamps, stable ID/fingerprint, evidence/derivation, freshness, identity, project confidence, and cost semantic. Forbidden content never enters the envelope. One adapter can fail or reject a future schema while the rest of the dashboard remains healthy.

See `docs/ADAPTER-EXPANSION-PLAN.md` for the contract and source matrix.

## Auto-detection

Closed applications are detectable through executable/version evidence, OS install metadata, standard config/data roots, extension/plugin inventory, and retained safe session metadata. No application is launched. No entire home-directory scan is needed. No browser cookie/credential store is touched.

UI states are: Detected, Used before, Installed/no history yet, Needs one session, History unavailable, Not detected, Connect, Disabled, Stale, and Error. Installed/history/live/connected do not imply one another.

Model discovery creates a row only from an observed record or connected account/catalog result. Exact raw ID is permanent evidence; aliases and families are versioned enrichment. Host/harness/agent/provider/model/quota bucket stay separate.

## Install/start/stop/update UX

Near-term user path:

```sh
npx @ai-development-dashboard/cli setup
ai-dashboard open
ai-dashboard status
ai-dashboard stop
```

`open` starts if necessary and opens the browser; `stop` stops only the owned process. Start at Login is opt-in and platform-native. npm CLI comes first; signed Node SEA executables follow after lifecycle hardening. Browser UI remains primary. Details and uninstall/doctor/migration policy are in `docs/INSTALL-EXPERIENCE-PLAN.md`.

The npm scope/name shown is proposed and must be verified/frozen before any publication.

## OpenRouter

Connect with a Management API key stored in the OS credential store or supplied via environment; persist only a credential reference. Management keys cannot infer and can access administration endpoints, which creates a useful least-purpose boundary. Allowlist only Analytics meta/query, credits, model catalog, and optional generation lookup; never key mutation endpoints. [OpenRouter management keys](https://openrouter.ai/docs/guides/overview/auth/management-api-keys)

Always discover the beta Analytics schema via `/api/v1/analytics/meta`, query only advertised fields, handle string counts/truncation/dimension limits, cache aggregates, back off, and show freshness. Never request prompt detail. Project attribution is exact only through explicit key/workspace mapping or a shared session/request ID with confirmed local cwd; time correlation stays weak.

Default UI: credits/key limit, current-period exact spend/tokens/requests, cache when available, top model, last refresh. Drill down by model/provider/key/time and advertised dimensions. Link to OpenRouter's native Activity dashboard rather than cloning it. [Analytics API](https://openrouter.ai/docs/cookbook/administration/analytics-cost-control)

## Antigravity

Detect IDE/app/CLI/config roots while closed. Do not infer history from opaque storage. The documented CLI status-line JSON is the safe structured source for workspace/cwd, exact model, context token categories, plan tier, agent state, and quota buckets. Enabling capture is an explicit local-integration write with preview, chaining/preservation, disable, and rollback. Quota remains a bucket and may cover model groups. A real future CLI session supplies the record; the dashboard never invokes interactive `/usage` as a prompt. [Antigravity status line](https://antigravity.google/docs/cli/statusline/)

The capture allowlist excludes the documented `email` field and never opens the advertised transcript path. Ship app detection even if IDE history remains unavailable. That truthful partial state is preferable to reverse engineering Electron/protobuf/account storage.

## Cursor usage

Keep current experimental local token telemetry and evidence labels. Add **View Cursor Usage** to the stable dashboard root. Do not iframe. Research and fixture-test user-selected CSV exports by account/plan before import; schema sniff, preview, store only allowlisted fields, and keep project mapping unknown when the export lacks it. Do not add a file watcher initially.

## DeepSeek Harness

No automatic detection exists today. Add Experimental detection for binary/package/`DSH_HOME`/settings, then feature-probe its pluggable JSONL/SQLite session backend/root. Parse structural header/request/usage/error fields only; never prompt/message/tool bodies. Identity retains harness, surface, provider, model, and cwd project. Exact tokens require explicit usage events; provider cost requires explicit cost fields. OTel is neither enabled nor consumed. Breaking versions degrade per capability. [Harness session system](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/session.md)

## OpenBot lessons

Adopt explicit external registration, separate health/capability states, write-only credential semantics, fail-closed policy, pre-action audit records, and startup health/migration messages. Do not adopt containers/computers per agent, browser/shell execution, Postgres/pgvector, enterprise auth, or gateway scope. [OpenBot](https://github.com/CopilotKit/OpenBot)

## Capability updates

First add source-aware provenance: source kind/repository/package, installed version authority/commit/hash, baseline hash, latest authority, native update method, modification/update state, check timestamp, and component license. Unknown remains unknown; mtime is never version/modification proof.

Permissions remain Observe only, Check for updates, and Allow capability modifications. The eventual flow is re-scan/lock, explain source/change/hosts/licenses, verify local modifications, exact command preview, native dry-run if available, confirm, journal, native update, verify, and capability-specific rollback. Caveman must remain componentized across Claude/Gemini/Skills CLI/CLI/runtime, with MIT and BSL components clearly separated. See `docs/CAPABILITY-UPDATES-PLAN.md`.

## Model efficiency

Begin with normalized UsageObservation, WorkCycle, Attempt, and OutcomeEvidence. Descriptive usage is available first. Model comparisons require equivalent task/outcome definitions and show medians/distributions, exact sample counts, missingness, project concentration, evidence mix, and cost semantic. Provider-billed, list-price equivalent, subscription credit, and capacity never share an unlabeled total.

No universal winner or productivity score. Frontier review freezes boundary/metric semantics before a lower-cost implementation model writes comparison code.

## Skill efficiency

Three evidence levels: Confirmed invocation, Enabled/present, and Controlled assignment. Presence cannot become use. Observational with/without distributions are explicitly confounded; causal language requires a controlled trial and adequate pairs. Capability version/commit is part of the cohort. See `docs/EFFICIENCY-ANALYTICS-PLAN.md`.

## Privacy/security changes

Add a centralized permission model and redaction utility before any network or mutation feature. Credentials use OS credential stores/environment and opaque references. Endpoint/method/domain allowlists, timeouts, response-size limits, backoff, origin/control tokens, restrictive files, and audit journals are testable contracts.

Update privacy/security/contributing documentation in the same commit that introduces a disabled network capability, and again before mutation. No feature may silently inherit permission from a different feature class.

## Phase 1 — Foundation and lifecycle

**User value:** truthful detection, extensible sources, clear health, and a normal on/off experience.

**Dependencies:** none beyond current Node baseline.

**Schema:** adapter/source health/lifecycle, raw+normalized identities, freshness, permission config; no new usage claims.

**Likely modules:** `src/core.js`, `src/cli.js`, `src/config.js`, `src/identity.js`, `src/brands.js`, `src/telemetry-contract.js`, `src/live-files.js`, new `src/adapters/`, `src/lifecycle/`, `src/http/`, `src/permissions.js`; `public/app.js`, `brands.js`, onboarding/settings modules.

**Privacy/security:** preserves local default; adds localhost lifecycle hardening; optional integrations remain off.

**Acceptance:** existing normalized fixtures unchanged after adapter migration; all current tests pass; closed detection reports audited states without launching apps/network; `open/status/stop` is idempotent; onboarding completes without JSON editing.

**Complexity:** Large, but decomposable. Terra is appropriate for units 1–7 after frontier approval of identity/permission/lifecycle contracts.

## Phase 2 — Connected and high-confidence telemetry

**User value:** exact OpenRouter spend/tokens and more local tools; Antigravity quota when explicitly enabled; clear Cursor account path.

**Dependencies:** Phase 1 registry, identity, permissions, credential reference, source-health UI.

**Schema:** connected aggregate buckets, cost semantic/provenance, capacity bucket, API schema cache, adapter cursors.

**Likely modules:** new OpenRouter/Gemini/OpenCode/Antigravity adapters, `src/capacity.js`, token/usage modules, settings/usage UI, credential-store abstraction.

**Privacy/security:** first network and credential boundary; optional Antigravity local config write; docs update required.

**Acceptance:** no network disabled; OpenRouter fixture/server tests cover auth/schema/rate limits/redaction; local adapters exclude sensitive bodies; Antigravity existing status line preserved and quota not duplicated; Cursor opens external dashboard.

**Complexity:** Large. Terra can implement source parsers/UI after frontier credential and status-line review. DeepSeek Harness is the last Phase 2 experimental unit, not a blocker.

## Phase 3 — Capability lifecycle and efficiency foundation

**User value:** trustworthy update visibility, then evidence-ready model/capability comparisons.

**Dependencies:** permission/redaction/source-health foundation; adapter identities; connected cost semantics.

**Schema:** capability provenance/check state; later journals; UsageObservation/WorkCycle/Attempt/Outcome/CapabilityEvidence and metric definition version.

**Likely modules:** `src/capabilities/`, local user-metadata store, metric engine, Maintenance/Efficiency UI.

**Privacy/security:** opt-in network check, then separately reviewed external mutation; task/outcome metadata privacy.

**Acceptance:** no update claim from timestamp; Observe mode makes zero network calls; Caveman component versions/licenses resolve correctly; user cycles/outcomes survive rescans; comparisons suppress under-evidenced claims.

**Complexity:** Very large, split into provenance/checks, one reviewed native updater pilot, event/cycle foundation, then observational UI. Terra implements after multiple frontier checkpoints.

## Later / explicitly deferred

- dozens of shallow installed-tool adapters;
- Antigravity IDE token parsing from opaque stores;
- Cursor authenticated API, iframe, browser cookie/JWT extraction, or automatic export watcher;
- OpenRouter request instrumentation/injection or automatic per-project key creation;
- general provider proxy or OTel collector;
- capability Update all, scheduled mutation, or generic package manager;
- Caveman vendoring or BSL engine integration;
- dashboard-run A/B harness/orchestration;
- productivity/quality/employee ranking;
- Electron/tray app, mobile app, cloud sync, shared account service;
- OpenBot execution/gateway/container infrastructure;
- public GitHub/release/publishing action until explicitly requested.

## Tests

Keep the current Node test style and add fixture builders per adapter. Required cross-cutting suites:

- adapter contract/compatibility/isolation and sensitive-field exclusion;
- identity normalization/fallback branding/raw-ID preservation;
- source lifecycle/freshness/health state derivation;
- permission matrix proving no network/write/mutation leakage;
- lifecycle PID/port/control/origin/migration behavior;
- exact/estimated/mixed/unavailable and all cost semantics;
- project confidence and unknown retention;
- API endpoint/method/domain allowlists and redaction;
- settings preview/chaining/rollback;
- provenance/version/hash/symlink/ownership conflicts;
- cycle/outcome/evidence eligibility and minimum sample suppression;
- browser acceptance at desktop/mobile/200% zoom, keyboard, disabled/stale/error states;
- privacy audit of index, logs, journals, support bundle, and share/export.

Each adapter fixture corpus must contain valid, missing-field, malformed, future-version, duplicate, prompt-bearing, secret-bearing, and oversized records. Tests assert that only allowlisted structural/numeric fields survive.

## Migration concerns

- Current schema is version 8 and metric definitions 2.2; increment only when normalized contracts change.
- First extract adapter modules with byte-for-byte/deep-equal current normalized fixture output.
- Store source health/API caches/adapter cursors separately or under explicitly versioned index sections; do not overload session records.
- Preserve project metadata store and capability parent IDs across source-registry changes.
- Raw source IDs and exact model IDs must make renormalization possible.
- WorkCycle/outcomes are user metadata and never overwritten by scans.
- Connected aggregate deduplication needs stable query-window/source IDs and overlap-safe upserts.
- Package/config/index migrations are atomic with preflight and bounded backup; source records remain untouched.
- UI supports previous index version during one rolling release where practical, or presents a clear rescan/migration state.

## Frontier-review checkpoints

Mandatory before implementation/merge:

1. identity axes, alias lifecycle, and adapter envelope;
2. permission model and localhost control-token/origin design;
3. OpenRouter credential storage, endpoint allowlist, and project-attribution claims;
4. Antigravity settings chaining/rollback and allowed captured fields;
5. DeepSeek/Kimi/Gemini sensitive-event parsers;
6. capability provenance/hash/symlink and command-execution policy;
7. first updater and rollback wording;
8. WorkCycle/outcome/rework semantics and comparison thresholds;
9. privacy/security promise changes;
10. final release checklist and migration/downgrade behavior.

Routine module extraction, fixtures, parsers, forms, tables, CSS, and command plumbing are appropriate for Terra/lower-cost implementation after the relevant checkpoint is frozen.

## Exact implementation handoff sequence

Every unit is one independently reviewable commit unless noted. Terra should read this master plan plus the named companion document, inspect the exact modules, and stop at the commit boundary.

### Unit 1 — Documentation drift and characterization

**Goal:** Correct README Cursor wording and lock existing normalized behavior before refactoring.

**Existing code to reuse:** current tests and telemetry definitions.

**Exact modules to inspect:** `README.md`, `docs/TELEMETRY.md`, `docs/METRICS.md`, `src/core.js`, `src/cursor-tokens.js`, `test/core.test.js`, `test/tokens.test.js`.

**Required changes:** update docs; add characterization fixtures/assertions for current Claude/Codex/Cursor/source/capability output and generated timestamps.

**Must-not-change invariants:** no production behavior or schema change.

**Tests:** full `npm test`; deep-equal fixture snapshots with stable dynamic fields normalized.

**Browser acceptance:** current Overview/Live/Usage-relevant copy unchanged except corrected Cursor description.

**Commit boundary:** docs plus characterization tests only. **Complexity:** S. **Model:** Terra.

### Unit 2 — Adapter contract and registry shell

**Goal:** Make the runtime contract executable without moving source logic yet.

**Existing code to reuse:** `src/telemetry-contract.js`, scanner context/helpers in `src/core.js`.

**Exact modules to inspect:** `src/telemetry-contract.js`, `src/core.js`, `src/config.js`, all source parsers, `test/core.test.js`.

**Required changes:** add `src/adapters/contract.js`, `registry.js`, `context.js`; manifest validation, capability semantics, adapter isolation/health; register wrappers around current paths.

**Must-not-change invariants:** normalized sessions/index and scan I/O remain identical; no network/write authority in adapter context.

**Tests:** manifest validation, missing functions, timeout/abort, one-adapter failure isolation, forbidden context surface.

**Browser acceptance:** none beyond regression.

**Commit boundary:** registry shell + tests, no parser moves. **Complexity:** M. **Model:** Terra after frontier contract review.

### Unit 3 — Migrate Claude, Codex, Cursor, inventory adapters

**Goal:** Move existing source-specific orchestration behind the registry.

**Existing code to reuse:** all current parser/token/live/capacity modules.

**Exact modules to inspect:** `src/core.js`, `src/activity.js`, `src/jsonl.js`, `src/live-files.js`, `src/cursor-usage.js`, `src/cursor-tokens.js`, `src/capacity.js`, `src/claude-capacity.js`, `src/open-agent.js`.

**Required changes:** source directories/manifests, shared helpers; shrink `core.js` to discovery/aggregation orchestration.

**Must-not-change invariants:** fixture-equivalent output, incremental fingerprints, read-only behavior, live exclusions, capacity semantics.

**Tests:** full characterization plus per-adapter partial/malformed fixtures and isolation.

**Browser acceptance:** exact current agent/session/token/capacity displays.

**Commit boundary:** only current adapters; no new source. **Complexity:** L. **Model:** Terra.

### Unit 4 — Identity/model registry

**Goal:** Separate host/harness/agent/provider/model/quota identities and make fallback discovery safe.

**Existing code to reuse:** current identity regexes and brands.

**Exact modules to inspect:** `src/identity.js`, `src/brands.js`, `public/brands.js`, `src/core-tokens.js`, `src/tokens.js`, UI contribution/grouping code.

**Required changes:** versioned identity registry, raw ID retention, alias/family enrichment, generated public brand subset, unknown fallback.

**Must-not-change invariants:** existing known models aggregate identically; observed unknowns remain visible; provider is not inferred from host when contradicted.

**Tests:** cross-host Kimi/DeepSeek/OpenRouter examples, alias ambiguity, future IDs, fallback branding, renormalization.

**Browser acceptance:** unknown source/model renders legibly without missing logo/layout failure.

**Commit boundary:** identity only; no catalog network. **Complexity:** L. **Model:** Terra after frontier identity review.

### Unit 5 — Source lifecycle, health, and permissions

**Goal:** Normalize Installed/History/Live/Connected and independent permission states.

**Existing code to reuse:** current diagnostics, capacity availability, config validation.

**Exact modules to inspect:** `src/config.js`, `src/core.js`, `src/privacy-audit.js`, `src/live-attention.js`, server settings routes, `public/app.js`.

**Required changes:** source state/health schema, permission store (`localRead`, `networkConnected`, `updateCheckNetwork`, `localIntegrationWrite`, `externalModification`), UI derivation.

**Must-not-change invariants:** all new risky permissions default off; config cannot grant one from another.

**Tests:** state cartesian cases, freshness, permission denial server-side, config migration.

**Browser acceptance:** all lifecycle states readable and actionable without false zero/failure.

**Commit boundary:** schema/store/UI primitives, no risky operation. **Complexity:** L. **Model:** Terra after frontier permission review.

### Unit 6 — Closed-tool discovery

**Goal:** Detect installed/history evidence without opening apps.

**Existing code to reuse:** platform path helpers and extension inventory.

**Exact modules to inspect:** `src/config.js`, `src/core.js`, `src/open-agent.js`, editor/capability discovery portions, new registry.

**Required changes:** allowlisted executable/app/root/plugin/history probes; version command policy; Antigravity/OpenCode/Gemini/Kimi/DeepSeek/VS Code presence manifests.

**Must-not-change invariants:** no network, app launch, broad home scan, credential store read, or history claim from root existence alone.

**Tests:** platform fixtures, command timeout, missing CLI with app present, installed/no-history, unsupported-history.

**Browser acceptance:** onboarding discovery results explain evidence and next step.

**Commit boundary:** discovery only, no new history parsing. **Complexity:** M. **Model:** Terra.

### Unit 7 — Lifecycle CLI and server hardening

**Goal:** Implement trustworthy `open/start/stop/status/doctor` from the repository.

**Existing code to reuse:** `src/cli.js` server/scanner and loopback defaults.

**Exact modules to inspect:** `src/cli.js`, `package.json`, scanner start/watch code, all routes.

**Required changes:** split lifecycle/http; atomic runtime record; control/origin tokens; process identity; graceful shutdown; port selection; CLI commands.

**Must-not-change invariants:** loopback only, no admin, no source mutation, one owned service, existing `scan/start` compatibility until documented migration.

**Tests:** PID reuse/stale record, port collision, repeated commands, signal/crash, route authorization, log redaction.

**Browser acceptance:** `open` reaches healthy UI; Stop dashboard confirms and closes service; browser close alone does not claim service stopped.

**Commit boundary:** repository lifecycle only; no npm publish/autostart. **Complexity:** L. **Model:** Terra after frontier security review.

### Unit 8 — First-run onboarding

**Goal:** Complete setup without editing JSON or opening IDEs.

**Existing code to reuse:** project discovery/classification, current config, source lifecycle UI.

**Exact modules to inspect:** `src/config.js`, project discovery in `src/core.js`, metadata store routes, `public/index.html`, `public/app.js`, CSS.

**Required changes:** versioned resumable onboarding, project-folder validation/preview, discovery results, optional integration/connected placeholders, lifecycle finish.

**Must-not-change invariants:** optional steps skippable; broad roots warned; no hidden network/write.

**Tests:** resume/migrate, duplicate/symlink/broad roots, skip paths, validation errors.

**Browser acceptance:** clean-profile walkthrough under five minutes, keyboard and 200% zoom.

**Commit boundary:** local onboarding, risky actions still disabled/placeholders. **Complexity:** L. **Model:** Terra.

### Unit 9 — npm packaging and start at login

**Goal:** Install/use lifecycle commands from a published-style package; add opt-in per-user autostart.

**Existing code to reuse:** Unit 7 CLI.

**Exact modules to inspect:** `package.json`, release scripts/docs, lifecycle paths, `docs/RELEASE-CHECKLIST.md`.

**Required changes:** package `bin`, setup/update/uninstall contract, platform paths, LaunchAgent/Task Scheduler/systemd-user adapters, dry-run/ownership verification.

**Must-not-change invariants:** no actual publish without explicit request; no root/admin; autostart off; jobs never point to npx cache.

**Tests:** package tarball install, three-platform fixture commands, uninstall retention, update failure.

**Browser acceptance:** installed `open` launches same UI and onboarding; Settings reflects autostart.

**Commit boundary:** package-ready artifacts only; publishing is separate user action. **Complexity:** L. **Model:** Terra, frontier release review.

### Unit 10 — Usage workspace and cost semantics

**Goal:** Add the UX shell and normalized cost/freshness types before OpenRouter.

**Existing code to reuse:** token range/report/evidence modules and current UI components.

**Exact modules to inspect:** `src/tokens.js`, `src/usage-events.js`, `src/token-evidence.js`, `src/capacity.js`, `public/app.js`, `public/live-ui.js`, `public/overview-copy.js`, CSS.

**Required changes:** cost semantic/provenance, capacity bucket, source freshness; Usage now strip; Usage page with range, cards, breakdown, Explain.

**Must-not-change invariants:** capacity/token/cost separation; unavailable is not zero; existing token totals unchanged.

**Tests:** semantic aggregation refusal, pricing coverage, stale states, range consistency.

**Browser acceptance:** information hierarchy/accessibility in `USAGE-UX-RESEARCH.md`; no unsupported empty charts.

**Commit boundary:** local existing data only. **Complexity:** L. **Model:** Terra.

### Unit 11 — Credential store and connected HTTP client

**Goal:** Build the reusable boundary without a provider connector.

**Existing code to reuse:** permissions/config/HTTP redaction.

**Exact modules to inspect:** `src/config.js`, `src/permissions.js`, HTTP/security modules, platform lifecycle paths.

**Required changes:** opaque credential references, Keychain/Credential Manager/Secret Service abstraction with env fallback, allowlisted client, timeout/size/backoff/cache/redaction, connection health.

**Must-not-change invariants:** no key in config/index/log/status/query string; no network without exact permission.

**Tests:** fake credential backends, redaction variants, redirect/domain/method rejection, 401/403/429, revocation.

**Browser acceptance:** credential input is write-only; connection state/error does not echo it.

**Commit boundary:** generic disabled infrastructure only. **Complexity:** L. **Model:** Terra after frontier credential review.

### Unit 12 — OpenRouter connector

**Goal:** Deliver exact connected spend/token/request/credit analytics.

**Existing code to reuse:** Units 2, 5, 10, 11.

**Exact modules to inspect:** adapter contract, connected client, usage/cost/capacity stores/UI.

**Required changes:** management-key connection; endpoint allowlist; `/meta` schema discovery; aggregate queries/cache; credits/catalog/generation numeric fields; explicit project mappings.

**Must-not-change invariants:** never prompt detail/key mutation; no automatic project key/header/user/session injection; no fake local project attribution.

**Tests:** recorded fake API schemas and all edge cases in adapter plan; dedupe overlapping windows; model/catalog drift.

**Browser acceptance:** connect/disable/replace, exact/stale/error cards, Explain, project Unknown handling, native dashboard link.

**Commit boundary:** OpenRouter only plus privacy/security docs. **Complexity:** L. **Model:** Terra after frontier connector review.

### Unit 13 — Gemini CLI and OpenCode local adapters

**Goal:** Add two documented high-confidence closed-history sources.

**Existing code to reuse:** JSONL/SQLite helpers, identity/project/token normalization.

**Exact modules to inspect:** `src/jsonl.js`, adapter context, token/usage/project modules, official schemas linked in adapter plan.

**Required changes:** strict allowlist parsers; version/feature detection; live file growth; exact usage/model/cwd fields; OpenCode stats/session store without full export.

**Must-not-change invariants:** never `auth.json`, prompts, response/tool content; do not launch server/CLI interactive sessions.

**Tests:** real-shape sanitized fixtures, retention gaps, malformed/future versions, sensitive exclusion.

**Browser acceptance:** closed tools appear with correct history/evidence/project confidence.

**Commit boundary:** one commit per adapter. **Complexity:** M each. **Model:** Terra after parser privacy review.

### Unit 14 — Antigravity discovery and status-line capture

**Goal:** Add truthful app/CLI state and opt-in quota/model capture.

**Existing code to reuse:** Claude capacity bridge patterns, source lifecycle/capacity bucket.

**Exact modules to inspect:** `src/claude-capacity.js`, `scripts/claude-capacity-capture.mjs`, settings routes, capacity UI, Antigravity adapter.

**Required changes:** app/CLI discovery; documented JSON allowlist; helper; settings preview/preserve/disable/rollback; stale quota snapshots.

**Must-not-change invariants:** no `/usage` prompt invocation, opaque IDE parsing, quota cloning, unapproved settings write, or overwrite of existing status line.

**Tests:** schema fields, shared quota buckets, absent CLI, first-session waiting, chaining/rollback, forbidden transcript paths/content.

**Browser acceptance:** installed/no-history and bridge disabled/waiting/current/stale/error states.

**Commit boundary:** discovery first; bridge second after frontier review. **Complexity:** M+L. **Model:** Terra.

### Unit 15 — Cursor native usage link and export importer

**Goal:** Make authoritative Cursor usage reachable, then import user-selected exports safely.

**Existing code to reuse:** current `CURSOR_USAGE_URL`, token evidence, file upload/route patterns if any.

**Exact modules to inspect:** `src/cursor-usage.js`, `src/cursor-tokens.js`, `docs/TELEMETRY.md`, settings/Usage UI.

**Required changes:** external-link action first; separate fixture-driven CSV schema sniffer/preview/import store later.

**Must-not-change invariants:** no iframe, cookie/JWT/private API, auto watcher, or project guessing.

**Tests:** safe URL, CSV formulas/oversize/encoding/schema drift/dedup, unknown columns/projects.

**Browser acceptance:** one click opens native dashboard; import explains supported/ignored fields before commit.

**Commit boundary:** link and importer are separate commits. **Complexity:** S then M. **Model:** Terra.

### Unit 16 — DeepSeek Harness experimental adapter

**Goal:** Detect and parse supported structural session usage without coupling to unstable internals.

**Existing code to reuse:** adapter feature probing, JSONL/SQLite helpers, harness identity.

**Exact modules to inspect:** adapter contract/context, settings parser, `src/jsonl.js`, token/project/live modules.

**Required changes:** version/compatibility; session backend/root discovery; JSONL/SQLite readers; structural usage/errors; file-growth live; degraded health.

**Must-not-change invariants:** no OTel enable/read, prompt/tool bodies, assumed default root, server/process start, or provider-cost guess.

**Tests:** backend variants, future versions, failed-attempt usage, sensitive records, partial capabilities.

**Browser acceptance:** Experimental label, capability matrix/health, unsupported format keeps Installed visible.

**Commit boundary:** experimental adapter only. **Complexity:** L. **Model:** Terra after frontier parser review.

### Unit 17 — Capability provenance and update checks

**Goal:** Show trustworthy installed/latest/modification state without mutation.

**Existing code to reuse:** current capability parent grouping, ownership, completeness, hashes.

**Exact modules to inspect:** capability portions of `src/core.js`, architecture docs, config/permissions/connected client, host inventories.

**Required changes:** provenance registry/version authorities/baselines/checkers; Maintenance review UI; Caveman component fixture.

**Must-not-change invariants:** Observe is no-network; timestamp is not version; unknown stays unknown; no update command execution.

**Tests:** authority precedence, hash/symlink/overlap, checker allowlists/redaction, Caveman licenses/components.

**Browser acceptance:** Current/Available/Unknown/Modified/Conflict/disabled/error explanations.

**Commit boundary:** discovery/check only plus privacy docs. **Complexity:** L. **Model:** Terra after frontier provenance review.

### Unit 18 — One native updater pilot

**Goal:** Validate preview/journal/verification/rollback with one low-ambiguity manager; Claude plugin or Skills CLI chosen after fixtures.

**Existing code to reuse:** provenance/check state, permissions, command redaction, lifecycle journal patterns.

**Exact modules to inspect:** new capability modules, selected manager docs/CLI output, privacy/security docs.

**Required changes:** exact command builder, dry-run handling, target lock, confirmation, bounded journal, verification, truthful rollback.

**Must-not-change invariants:** no modified/conflicted target; no Update all/schedule; native manager only; explicit external-modification permission plus per-action consent.

**Tests:** command equality, TOCTOU change, partial update, malicious output/secrets, timeout, verification/rollback failure.

**Browser acceptance:** full ten-step flow and recovery states.

**Commit boundary:** one manager, one capability at a time. **Complexity:** L/high risk. **Model:** implementation Terra, mandatory frontier/security merge review.

### Unit 19 — Efficiency event/cycle foundation

**Goal:** Store evidence needed for future comparison without emitting rankings.

**Existing code to reuse:** usage events, timing store pattern, project metadata/user store, metrics definitions.

**Exact modules to inspect:** `src/usage-events.js`, `src/tokens.js`, `src/token-evidence.js`, `src/telemetry-contract.js`, metadata routes, `docs/METRICS.md`.

**Required changes:** UsageObservation/WorkCycle/Attempt/Outcome/CapabilityEvidence; user join/split/outcome UI; metric definition version.

**Must-not-change invariants:** no transcript classification/backfill; scans do not overwrite user evidence; presence != invocation.

**Tests:** IDs/dedup/timezones/multi-session/retries/reversible edits/privacy.

**Browser acceptance:** evidence-readiness and cycle review only; no winner language.

**Commit boundary:** foundation, no comparative headline. **Complexity:** L. **Model:** Terra after frontier semantic review.

### Unit 20 — Observational and controlled comparison UI

**Goal:** Deliver model/capability cohort distributions with guardrails.

**Existing code to reuse:** Unit 10 Usage UX and Unit 19 metric engine.

**Exact modules to inspect:** new efficiency modules/UI, `docs/EFFICIENCY-ANALYTICS-PLAN.md`, share/export boundary.

**Required changes:** cohort filters/eligibility, medians/IQR/intervals, sample/missingness/exclusion/project-concentration gates, controlled-trial import/report.

**Must-not-change invariants:** cost meanings separate; observational != causal; under-threshold claims suppressed; private labels not shared.

**Tests:** all threshold/coverage/zero/imbalance/protocol-deviation cases and deterministic statistics.

**Browser acceptance:** prominent evidence class, distributions and Explain; no universal score or automatic winner.

**Commit boundary:** observational first, controlled reports second. **Complexity:** L. **Model:** Terra after frontier metric review and again before merge.

### Unit 21 — Standalone distribution

**Goal:** Remove Node prerequisite while preserving the same CLI/service/UI.

**Existing code to reuse:** npm lifecycle and release checklist.

**Exact modules to inspect:** package/release scripts, asset paths, lifecycle update, CI/signing docs.

**Required changes:** per-platform Node SEA build, embedded public assets, native CI, signing/notarization, checksums/SBOM, signed updater/installer documentation.

**Must-not-change invariants:** same data/config and command semantics; loopback/private; verified artifacts; npm path remains supported.

**Tests:** clean VM install/update/downgrade/uninstall on supported architectures and previous two versions.

**Browser acceptance:** identical onboarding and UI from standalone binary.

**Commit boundary:** build/release artifacts; actual release requires explicit user authorization. **Complexity:** L. **Model:** Terra with frontier release/security review.
