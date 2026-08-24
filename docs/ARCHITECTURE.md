# Architecture

`src/core.js` owns adapters and normalization. `src/cli.js` is the tiny local HTTP/scan boundary. `public/` is a dependency-free UI.

## Local appearance preference

`settings.json` version 4 stores a single sanitized `appearance.accent` hexadecimal value. The browser applies it through shared `--accent` derived CSS variables and mirrors it in local storage early enough to avoid a visible default-color flash. Saving appearance does not refresh projects, reindex telemetry, restart the service, or call a network endpoint. Semantic state colors remain independent, and Share Stats keeps its existing fixed public card design.

```text
filesystem/Git ─┐
Claude records ─┼─ adapter registry ─→ normalized JSON index ─→ localhost UI
Codex records ──┤         ↑                   ↑
Cursor records ─┤         └─ capability manifest + read-only context
Cline records ──┤                              └─ source lifecycle state
capability files ┘
```

## Connected-service boundary

OpenRouter is a registry-backed `connected-service` adapter, not a local scanner special case. Its service boundary is constructed without I/O and makes a request only after explicit Connect or manual Sync, a distinct `networkConnected` permission, and an externally supplied management credential. Phase 2A allowlists only analytics metadata, aggregate analytics query, and credits. The service caches normalized aggregates locally with source and sync timestamps; raw responses, request IDs, key metadata, prompts, and credentials are not retained.

OpenRouter is the gateway/account source. Underlying provider and model identities remain separate, and agent/host are null unless independent local evidence identifies them. Aggregate remote history is never placed in Live Agent Activity. Projects remain Unknown unless an explicit deterministic mapping is introduced.

The Cline adapter is a local-read, feature-probed source. It detects the Cline extension in Cursor or VS Code separately from a Cline CLI and reads only bounded structural session metadata from supported JSON/JSONL artifacts under `~/.cline/data/sessions/`; `*.messages.json` bodies are excluded before opening. A discovered SQLite session index is health/discovery evidence until a reviewed read-only schema adapter exists. Cline remains the agent while its host is recorded independently (`Cursor` for the validated extension installation, `VS Code` or `Cline CLI` only when evidenced). A route can independently retain `gateway: OpenRouter`, underlying provider, exact model, workspace/project, and session. This permits Claude Code, Codex, Cline, or another supported host to use the same OpenRouter account without host reassignment or timestamp correlation. Cline has no capacity card: credits belong to the OpenRouter account.

## Antigravity local adapter

Antigravity discovery reads only app/CLI/root presence while closed. Opaque IDE/conversation stores are not history. The optional CLI status-line bridge is an explicit `localIntegrationWrite`: preview → user confirmation → backup/preserve existing `statusLine` → install dashboard-owned helper → write allowlisted local snapshot. Restore returns the pre-dashboard settings and removes only dashboard-owned helper/state files.

Snapshots retain host `Antigravity`, raw/normalized model, independently inferred underlying provider, local workspace/cwd, current context categories, CLI version, plan tier, and quota buckets. They do not create historical sessions or Live Agent Activity. Quota buckets are independent capacity sources and are never copied to individual models.

## Efficiency instrumentation foundation

`src/efficiency.js` derives private structural observations from the normalized index during a normal scan; it does not reread transcripts on Efficiency-page navigation. `src/efficiency-store.js` keeps user-confirmed outcomes, private cycle descriptors, and the prospective comparison tracking boundary separately from scanner output, so rescans cannot overwrite them. `src/efficiency-comparison.js` calculates deterministic cohort eligibility and distributions from those normalized records only. The API composes those records with an already-cached OpenRouter aggregate only; it never triggers a remote sync.

The first boundary is deliberately conservative: one indexed session becomes one `session-proxy` Work Block. Structured validator/tool/provider fields can form measured events. Prospective attempts require an explicit private cycle, named validation contract, and exact model segment; historical sessions stay descriptive. Retry and possible-rework inference remains separately labelled; model switches require an explicit continuation relationship and are not inferred from timestamp proximity. Tasks and semantic completion remain Unknown without a harness ID or user confirmation.

## Canonical identity and confidence

Git root under the configured projects root is the canonical project identity. A session is **Confirmed** only when its recorded working directory resolves below that root. Cursor folders are matched from their encoded project path and are **Strongly inferred**; unmapped records remain Unknown/Weakly inferred rather than being silently assigned.

## Data retention

The index records file paths, file fingerprints, timestamps, compact counters and metadata. It does not copy SKILL.md/CLAUDE.md/AGENTS.md content, prompt bodies, code, tool output or raw transcripts. Delete `.dashboard-data/` to reset local derived analytics; originals remain untouched.

## Adapter and discovery foundation

The adapter registry is versioned and capability-declared. An adapter can provide only the evidence it safely has (for example history, file-growth live activity, exact or estimated tokens, models, projects, capability inventory, or health); unsupported and unknown stay distinct. Its context intentionally omits shell, browser, credential, network, and write authority. Local read access can be independently disabled.

Source lifecycle records keep **Installed**, **Historically observed**, **Live**, **Connected**, and health independent. Closed-tool discovery uses only allowlisted application, executable, and local-root probes; a root alone never claims past usage and no app is opened. Each normal service start performs an incremental local discovery pass. Known adapter roots are watched with a debounce, and a bounded five-minute local fallback catches installations that happen outside a watcher. No discovery path calls a provider, GitHub, or browser API.

Identity records retain agent, host, harness, gateway/account, provider, raw model ID, normalized model ID, and role as separate values. A provider explicitly observed by a future adapter takes precedence over a host default. The normalized index also retains observed model identities with raw ID plus first/last-seen timestamps; a new model from a supported adapter or the explicitly synced OpenRouter aggregate cache is registered from observation, not from a bundled catalog. Connected aggregate identities retain `gateway: OpenRouter` and no inferred agent/host/project. Unknown identities use a provider/letter fallback rather than blocking telemetry.

Runtime presentation is derived from adapter manifests and normalized sessions. A manifest may declare a runtime/source key, validated live capability, and an optional executable-only process-presence hint. An asynchronous presence sampler refreshes at most every five seconds, reads `ps comm` paths only, and retains a bounded stale-good result after a transient poll failure; it can distinguish present/Closed/unknown presence but cannot create AI-work events. The UI renders only installed or historically observed local runtimes with live capability. Connected gateways such as OpenRouter are not runtimes and never become a live lane merely because their aggregate history changes. Capacity cards are rendered from returned account/capacity sources, not model names. Optional source actions (for example an official provider usage page) belong to capacity-source registry metadata and appear whenever the source is discovered, independent of runtime presence or live activity.

## Local service lifecycle

`ai-dashboard` is exposed through the package `bin` and provides `setup`, `open`, `start`, `stop`, `status`, `update`, and `doctor` from either the repository or an installed package. The server is loopback-only, records an atomic owned runtime record after binding, and verifies a random instance/control token before status or shutdown. Browser state-changing routes require a same-origin, HttpOnly local session cookie. A closed browser does not stop the service.

`update` is manual and limited to dashboard software. The current linked Git-checkout mode resolves the actual checkout, refuses dirty/detached/diverged histories, fetches only after the explicit command, and uses `git merge --ff-only`; it never resets, stashes, force-checks out, or touches dashboard data. If its deterministic lockfile workflow changes, it runs only the committed lockfile install. It restarts only a previously running owned service after a successful update. Other install modes are intentionally non-mutating until their package/standalone updater is reviewed.

Startup separates process spawn, loopback bind/liveness, and background discovery. `open` refuses an occupied port before spawning a second service, returns child bind/exit categories when startup fails, terminates a child that times out before becoming healthy, and never removes another instance's runtime record. A bind failure also cancels any owned background helpers. The initial scan is delegated to an owned child process after the listener is ready; capacity collection is delegated separately, and a newer normalized index is picked up through a compact view cache. Stopping the owned service also stops its owned scan, watcher, capacity, and presence helpers. Lifecycle events are bounded and sanitized for optional local bug-report diagnostics. `status` and `doctor` distinguish stopped, stale, unhealthy, healthy, and live-state-degraded conditions without treating a slow scan as a dead loopback service.

Autostart is off. Phase 1 generates per-user LaunchAgent, Task Scheduler, or systemd-user plans only; it neither creates a job nor publishes a package. The foundation does not yet expose an enable toggle because it has no owned install/remove implementation.

## Runtime & Resources operating console

Maintenance includes a private **Runtime & Resources** console backed by the
same lifecycle and adapter registries as the rest of the product. The compact
`/api/runtime-status`, `/api/system-resources`, and `/api/diagnostics` views do
not hydrate the historical index or read transcripts. They expose the owned
Dashboard service, observed live-capable runtimes, local CPU/memory/disk
metadata, honest hardware-unavailability states, and a bounded sanitized
lifecycle-event window. Service presence and AI activity remain separate
dimensions: an open runtime can be Idle, a closed runtime is Closed, and only
validated adapter evidence can be Working.

Only the Dashboard service has controls in this phase. Restart and Stop are
same-origin loopback actions protected by the per-instance session/control
boundary and reuse the owned runtime record, graceful shutdown, bounded
fallback, and ownership verification. External runtimes are observe-only until
an adapter can prove lifecycle ownership; no generic process manager, shell
input, sudo, or PID-only signal is exposed. Apple Silicon reports unified
memory and does not invent dedicated VRAM. NVIDIA parsing is feature-probed and
fixture-tested, but an unavailable GPU is shown as unavailable rather than
zero. Resource sampling is cached and lightweight; it never enters Share
Stats.

## Live refresh

An owned startup scan worker performs the initial discovery after the listener is ready. A separate child owns known adapter-root filesystem watchers; the server receives metadata-only file events while a five-minute fallback incremental check covers missed changes. Session files retain their source fingerprint, so unchanged transcripts are reused rather than reparsed. The browser checks the compact normalized view every 15 seconds and redraws only after a new index timestamp. A mostly idle dashboard performs no repeated transcript parsing; a watcher event triggers one coalesced incremental scan. Git-derived project metrics are refreshed only with that scan.

## Interface rationale

The interface follows an **editorial operations desk** direction: a dark Design Delulu identity with information hierarchy carried primarily by typography, rhythm and a few pink anchors rather than a field of equal cards. The shared type scale and control rhythm are tuned for comfortable laptop/desktop reading, with responsive fallbacks for mobile. **Overview** is the resume surface (Today, Start Here, Needs You, Continue Working). **Live Feed** holds live agent signal, current states, resources, plan capacity, and token activity. Utility tasks live in toggleable drawers so users return to their current view naturally.

Share Stats is a local Share Story builder. A frozen public-safe snapshot is re-rendered as only the cards its evidence supports: intro, agent ranking, projects/sessions, normalized token profile, capability use, and achievements. Navigation and slideshow state live only in the browser. “Export all” produces one appropriately named PNG per slide without uploading anything. Agent logos have a fixed readable minimum; their session rank, exact count, percentage, and proportional bar provide the truthful visual encoding.

## Capability hierarchy and ownership

Raw discovered files remain auditable as components. The normal interface groups only deterministic roots: plugin cache/marketplace identity, a shared skill directory, or an individual command. A parent capability aggregates components, usage, agents, known owned artifact paths, and maintenance state. Grouping never uses fuzzy display-name matching. Ownership is inventory-only in this release: future Disable/Update/Remove actions must enumerate known artifacts, show a preview, require confirmation, journal a reversible change where possible, and never infer deletion targets.

### Taxonomy, installation and maintenance

The user-facing registry classifies a parent capability by **type** (Skills, Tools, Integrations, Automations or Instructions) and orthogonal **scope** (Shared, User / Global, Custom or Project-specific). Instructions and native automatic behaviors are deliberately not presented as interchangeable with portable procedural skills. These labels derive from deterministic artifact location/type evidence; unknown categories remain conservative.

Artifact completeness and agent coverage are distinct. `Complete` is emitted only when a known simple structure is present (for example, a skill directory contains `SKILL.md`); `Broken` only when a known expected artifact is absent; otherwise the artifact state is `Unknown`. Agent coverage states are Installed, Not installed, Unsupported, or Compatibility unknown. This release only emits “Not installed” when reliable compatibility evidence exists, never merely because another agent lacks the item.

Maintenance aggregates reasons at the recognizable parent capability. It separates Needs Action (broken/partial/conflicting), Updates, Installation Coverage, and Usage Review. Usage absence is deliberately an optional review signal—not a defect or removal recommendation. Parent details carry a compact observed history (modified/used) distinct from maintenance.

### Local project working memory

Pins, status and note live in `.dashboard-data/project-metadata.json`, keyed by stable canonical project ID. The scanner never writes that store, and the scanner output never overwrites it. The HTTP boundary reapplies it after every scan/startup. Notes are private metadata: shareable stacks, manifests, snapshots and cards do not receive project notes or project names.

## Agents and editors

An agent/provider and its host are separate fields: e.g. Claude in Claude Code, Codex in Codex CLI, and Cursor in Cursor. A Moonshot or DeepSeek model observed inside Claude Code is recorded as a different agent/provider/model with host still Claude Code. VS Code is recorded as an editor host inventory only unless a future adapter finds a stable AI-session transcript format; ordinary editor state is never counted as AI activity. Optional task roles (Planning, Architecture, Implementation, QA, Debugging, Audit) are stored only when recorded. `harnessRuns` can represent a multi-worker run from an external harness without turning this dashboard into an orchestrator.

Native agent behaviors are represented as `Automation` capabilities, distinct from procedural Skills and from Hooks/Integrations. The first native automation adapter reads Claude Code's user-level `autoCompactEnabled` and `autoCompactWindow` settings without modifying them. Its normalized record retains agent, trigger, behavior, implementation, scope, active state, portability and a safe setup recipe; it is intentionally not a general rule engine.

Live state has its own bounded transport. The scanner persists historical normalized data, while an in-memory resource sampler and 60-second agent-event ring are delivered through a cache-disabled `/api/live-state` endpoint. The browser polls that endpoint every two seconds. This keeps live UI updates independent of session-history rescans and provider authentication.

Validated live evidence may arrive while the historical catalog is still loading. The endpoint therefore includes a compact runtime-catalog overlay for currently evidenced live agents; the browser merges it into the registry-driven lane renderer and can show Working even when the event ring has no waveform sample yet. Presence remains a separate process signal, and repeated unchanged lifecycle snapshots are not treated as new activity.

The browser derives a conservative live state and timing record without changing that transport. `public/agent-state.js` classifies the current normalized events; `public/signal-field.js` turns the same bounded evidence into deterministic display envelopes. The versioned local timing record stores only aggregate observed durations and a bounded transition list. It begins at first use, treats suspended gaps as unobserved, contains no prompts or transcript content, and is kept outside scanner output so rescans cannot overwrite it. The schema leaves project ID and handoff-cycle attribution as future additions rather than guessing them now.

## Future directions

Phase 2 adds normalized token categories, structured Claude `attributionSkill` events, rolling comparable efficiency components, and a centralized sharing/export boundary. `ShareSnapshot` records only selected public-safe values, public capability ranking, deterministic achievement metadata, metric definitions, and visual slide choice before rendering a card. Achievement badges use tier metadata plus replaceable asset slots; fallback vectors are used until purpose-designed artwork is added. A future `New Project` feature should create a folder/Git root plus agent instruction stubs only through documented agent integrations. Workflow continuation/routing should consume personal historical evidence and never attempt subscription pooling or unsupported authentication flows. Token period reports are derived from the normalized session calendar. A future Agent Team mode may recommend cost-aware roles; it must not become an inference proxy. See `docs/ORCHESTRATION.md`.

Future capability installation/import follows: audit target → compare current coverage and ownership → detect conflicts → preview exact artifacts/config changes → explicit approval → apply → validate → retain rollback information. It must use the same ownership boundary as future removal and never treat an inferred path as removable.
## Repository and capability presentation

Git discovery produces a repository inventory, not an automatic project list. Each root is classified as **Project**, **Tool**, **Reference**, **Unknown**, or **Hidden** from deterministic path/ownership evidence, with a dashboard-local override. Only Projects feed the primary Projects and Resume views; all discovered repositories remain available for attribution and review.

The default capability registry surfaces reusable functionality (Skills, Tools, Integrations, and Automations). Instructions have their own scope-organized mode. Parent capability details aggregate raw artifacts into component summaries and keep observed invocation evidence separate from installation contents. Duplicate maintenance findings are read-only comparisons until the dashboard has a deterministic ownership and rollback plan. Bounded content hashes (or an explicitly weaker source fingerprint) are retained for comparison; only matching content hashes qualify as an exact duplicate.
