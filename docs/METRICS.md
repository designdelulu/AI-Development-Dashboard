# Metrics

Metric definitions version: 2.2.

## Token fields

| Display field | Meaning | Never interpreted as |
| --- | --- | --- |
| Fresh input | Provider `input_tokens` excluding cache fields. | Subscription quota or billed tokens. |
| Output tokens | Provider `output_tokens`. | Completed work or quality. |
| Cache read | Provider `cache_read_input_tokens`; previously processed context reused by the provider. | Fresh user input. |
| Cache creation | Provider `cache_creation_input_tokens`; context written to cache where exposed. | Fresh user input. |
| Reasoning / other | Provider-specific explicit fields, if supplied. | A comparable cross-provider measure unless documented by that provider. |
| Total observed token activity | Sum of the above observed categories. Useful for describing model work; deliberately not called “tokens used.” | Subscription billing, plan allowance, or API cost. |
| Fresh + Output | Fresh input plus output only. | Cache activity or billed subscription usage. |

Period reports use the operator’s **local timezone**: Today, Yesterday, Last 7 days, This month, and Since tracking began. Calendar days come from **usage-event timestamps**, not scan time, index update time, file mtime, or session end time. A session that spans midnight is split across local calendar days. Identity backfill (`recordedAt`) does not move historical usage into today.

Token evidence is explicit: **Exact** (provider/local numeric fields), **Estimated** (documented derivation, currently Cursor character/4 when current Cursor builds store `{0,0}` token counts), **Mixed** (an aggregate containing both), or **Unavailable**. Unavailable is never shown as zero. Cursor may show **Local token telemetry**, **Estimated local token telemetry**, or **Local token telemetry unavailable**. Cursor itself still exposes usage in the Cursor account dashboard. Official Usage CSV import remains a planned fallback.

Every token card inherits the selected range. Fresh + Output is labelled with that range (for example `Fresh + Output · Today`). Observed token activity includes cache reads/writes and is not billed usage. **Explain this number** shows range, timezone, exact vs estimated totals, category/agent/provider/model breakdown, source event counts, and contributing sessions without prompt bodies.

### Adaptive Token Activity intensity

The Live Feed intensity meter is a **visualization aid**, not a token metric or quota meter. It uses **Fresh + Output** so cache/context processing cannot make ordinary new work look artificially maxed out. The normalized history currently retains comparable **one local calendar-day** usage buckets, so the meter compares the current local day with completed local calendar days; it does not pretend a selected 7-day/month report is a same-size live bucket.

The meter learns from the 30 most recent completed observed day buckets. After seven samples, its recent-heavy reference is the nearest-rank P95 of those Fresh + Output values. Its visual ceiling is `max(100,000, ceil(recent P95 × 1.25))`; before seven samples it uses the same 1.25 headroom over the largest completed sample, with the 100,000-token floor. The lifetime high is stored locally from completed valid buckets and shown separately, so an old outlier cannot flatten the recent display. A newly closed current-day bucket is marked **New activity high** only when it exceeds the previous high; historical/backfilled buckets update history silently. Non-finite numeric input is ignored for scaling only.

Exact, Estimated, and Mixed values participate consistently with the selected token report and keep their evidence label. The adaptive state stores only numeric day-scale metadata (bucket definition, recent summary, high-water mark, timestamp); it is recomputable from the normalized calendar and never requires transcript rereads, network calls, prompts, code, or cache/output bodies. Cache Read and Cache Creation remain visible in the existing detail and explanation surfaces. Restarting preserves the learned high-water state.

Missing fields remain unavailable/zero in their category. A zero never means a provider used no tokens; it may mean the local source does not expose that field. Agent, host, provider and model contribution are reported separately when those fields exist.

## Attribution and efficiency

**Confirmed** project attribution uses a recorded session `cwd` that falls inside a discovered Git root. **Strongly inferred** attribution uses a deterministic encoded Cursor/Claude project folder. Weak/Unknown sessions remain visible in global counts but do not affect project headlines or comparable efficiency.

### Efficiency instrumentation foundation

Metric-definition version 3.0 adds private, structural-only `UsageObservation`, `WorkBlock`, `Attempt`, `OutcomeEvidence`, `CapabilityEvidence`, and prospective `ModelSegment` records. Evidence is independently labelled **Measured**, **Inferred**, **User-confirmed**, or **Unknown**. Prompt/response bodies, source code, terminal/test output, and tool arguments are never persisted. Command text may be inspected in memory only to recognize a bounded known validator; the stored record retains only its validator contract class/strength and numeric exit status.

A Work Block is currently a **session proxy** with an explicit `session-proxy` boundary method. It is descriptive—not a Task—and is never silently promoted to a completed task. Comparison attempts are prospective only: after the local instrumentation boundary, they require an explicit private cycle, named validator contract, and attributable model segment. A validator recheck with no observed intervening work stays attached to the prior attempt. Passing validation is recorded as validation evidence, not proof that a task is correct or accepted. User-confirmed outcomes are reversible local metadata and survive rescans.

No universal efficiency/productivity score or model winner exists. The Efficiency workspace shows descriptive evidence plus private Comparable observations only for strongly matched/controlled cohorts with documented sample gates, coverage, and exclusions. Provider-billed OpenRouter aggregates remain Exact, but are not assigned to a work block/project without deterministic correlation. Subscription usage/capacity is never converted to dollars. Capability presence is not invocation; only structured confirmed invocation supports an observational capability row. Efficiency is private and excluded from Share Stats.

Tokens per session, cache-read ratio and tools per session compare rolling 30-day periods only when both periods have at least three eligible observations and identical definitions. Git branch, HEAD subject, dirty state and commit count are captured on each scan. LOC walks are not part of the scan path; they remain an optional descriptive helper, never a productivity score.

## Live activity monitor and system resources

**Activity** is a visualisation of timestamped local session events—not model compute, effort, token throughput, or user presence. Each event retains its deterministic observed weight. For presentation, that real event becomes a short signal envelope with a 180 ms attack and 7.5-second exponential decay. Envelopes from repeated events add together, so sustained real updates create denser regions. The Canvas samples those envelopes across a rolling 45-second field as closely spaced vertical micro-bars; one telemetry event can therefore produce many visual bars without becoming many analytics events.

The bar field has two explicitly separate inputs. **Activity modulation** uses only the real event envelopes and a bounded display gain of `tanh(0.52 × envelope energy)`. **Baseline carrier** is a low-amplitude deterministic sine carrier that only indicates the display is alive. It never changes state, intensity, or timing. There are no random activity bursts. Claude, Codex and Cursor occupy separate vertical lanes so their traces do not hide each other. Age-based opacity and envelope decay create the trailing wake. Reduced-motion mode replaces the moving carrier with a constant low baseline while retaining real-event bars and text state.

The resource strip is intentionally separate from agent activity. On macOS it reports working RAM from `vm_stat` active + wired + compressed pages, host CPU utilisation derived from deltas in Node's `os.cpus()` time counters, and this dashboard server's RSS/process CPU. These are host/system values, not attributable AI consumption. The backend samples every two seconds; working RAM refreshes every five seconds. A single cache-disabled `/api/live-state` poll delivers system resources and the compact agent-event ring to the browser every two seconds. Historical scanner state is not involved. Missing telemetry displays as unavailable.

The canvas redraw is capped at 12.5 frames per second (8 in reduced-motion mode), uses three-pixel desktop/five-pixel mobile bar spacing, and retains at most 512 compact recent events. Rendering pauses while the tab is hidden. Source watching remains incremental: it waits for 7.5 seconds of local source quiet before a heavier index refresh, ignores the dashboard's own derived data, and falls back to a five-minute checkpoint refresh. It never continuously rescans session histories to animate the monitor.

### Live agent states and timing

The operator deliberately separates current work, recent work, and a genuine request for attention:

- **Working** — a real local event was observed within the previous 12 seconds. This is observed local busy activity, not remote model inference.
- **Needs You** — only a positive, structured attention marker can produce this state. It is never inferred from silence. Today, a newly observed Codex `event_msg` with `payload.type: task_complete` qualifies while no later Codex task start/user message has been recorded; the marker is held for up to 15 minutes or until later local agent activity clears it. This describes a local task-complete handoff, not remote model state.
- **Recently Active** — the last observed local event is 12 seconds to five minutes old, with no qualifying attention marker. This is the normal state after an agent stops producing local activity.
- **Idle** — no relevant event is available, or the most recent event is older than five minutes.
- **Unknown** — the normalized index does not establish a supported local source for that agent.

Claude's structured `assistant/end_turn` and Cursor's `turn_ended/success` records show that a turn ended, but neither safely proves a user action is required, so they remain Recently Active/Idle. Cursor's editor/WAL activity is never used for Needs You. The dashboard reads only bounded structural JSONL fields for the Codex marker—event type and payload type—not prompt, message, transcript, or tool-argument bodies.

Browser-local timing begins only when this state tracker first runs. A versioned fixed-size record in local storage accumulates `observedWorkingMs`, `waitingForUserMs`, `recentlyActiveMs`, `observedIdleMs`, `unknownMs`, and `unobservedMs`, plus at most 96 recent state transitions. It never backfills historical durations. Tick gaps over five seconds—such as a suspended or closed tab—go to `unobservedMs` rather than being credited to a state. These measurements describe what the open dashboard observed and form a conservative foundation for future project/cycle attribution; they are not exact provider response or compute times.

### Live signal sources

The backend checks the known live files every 1.5 seconds and the browser requests the compact live snapshot every two seconds. Claude activity comes only from **size growth** of `.claude/projects/**/*.jsonl` session transcripts (including subagent JSONL). mtime-only touches, missing files, directory watches, and dashboard/statusline/config files (`~/.claude/ai-dashboard/**`, `usage_state.json`, settings backups) never generate Claude pulses. Codex from modified `.codex/sessions/**/*.jsonl` files. Cursor activity is taken from **mtime/size only** on:

- `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb-wal` (and `state.vscdb`)
- `~/.cursor/projects/**/agent-tools/*`
- `~/.cursor/projects/**/agent-transcripts/*.{json,jsonl}` when those files exist

Cursor agent-transcripts are often empty while a current agent is working, so transcripts are not required. A WAL mtime change with unchanged size still counts as one event. The **live activity** path never parses SQLite, WAL payloads, or transcript bodies. Token analytics may read `state.vscdb` **read-only** (YELLOW undocumented local storage) for `cursorDiskKV` `bubbleId:` / `composerData:` metadata only: token counts, context-meter totals, timestamps, model ids, and text lengths. It does not read ItemTable auth keys, cookies, JWTs, or prompt bodies. `canvases/`, `mcps/`, and `node_modules` are ignored. A file update has a deterministic base weight plus a capped log-scale byte-growth contribution. It is evidence of local session output/activity, not remote compute.

The live field draws **separate lanes** for observed runtimes instead of overlapping traces. A Kimi model running through Claude Code appears as Kimi via Claude Code, not as a Claude model. Plan capacity stays on account/subscription sources and is not cloned onto every model lane.

The live-pipeline repair also corrected the Canvas clock: `requestAnimationFrame` supplies a page-relative timestamp, while agent events use Unix epoch timestamps. The monitor now uses `Date.now()` when computing event age. Comparing those two clock domains previously made every genuine live event appear impossibly old and forced traces to baseline.

The frozen resource strip had a separate frontend failure: the first Overview render asked the contextual-copy selector to inspect `resources.ram` while the initial live resource state was still `null`. That exception stopped startup before the live polling timers were registered. The selector now treats the pre-sample state as unavailable, and startup fetches one live snapshot before rendering. System values and agent activity then continue through the same bounded transport without reloading.

## Plan capacity

Plan capacity remains separate from local token analytics. Codex session records currently expose native structured `rate_limits` metadata including used percentage, window length, reset timestamp, and plan type; the dashboard normalizes this into percent remaining and refreshes its read-only local snapshot once per minute. Claude Code 2.1.80+ can expose official statusline `rate_limits.five_hour` / `seven_day` `used_percentage` and `resets_at` after the first API response for Claude.ai Pro/Max. The dashboard captures only those fields into `~/.claude/usage_state.json` via a statusline helper that **preserves any existing statusline command**. Remaining percent is `100 - used`. Missing fields are Waiting / Unsupported / Unavailable — never a fake 0%. Cursor still has no supported local plan-capacity source. No cookies, credentials, browser DOM, or unofficial provider endpoints are used.

## Share recap periods

Share Stats filters public-safe metrics to **Today**, **This Month**, or **Since tracking began**. “Since tracking began” starts at the earliest timestamp in the dashboard’s available local session records; it does not claim complete pre-dashboard history. Each frozen `ShareSnapshot` records its period boundaries and title. A metric is omitted when it has no evidence in the selected period.

The social renderer uses period-specific emphasis rather than one fixed number grid: Today leads with current observed agent/session activity, This Month is a recap composition, and Since Tracking Began is framed as a developer profile with its tracking date. Agent mark size uses `min + (max − min) × sqrt(agent sessions / largest agent sessions)` for non-zero agents; a zero-session agent receives no data-sized mark and a faint labelled placeholder. This visual scaling never changes the frozen snapshot values.

Token share options traverse the same session-period filter as the recap. Fresh Input, Output, Cache Read and Cache Creation remain distinct metric IDs through eligibility, `ShareSnapshot`, and SVG rendering. If a category is supported in the available history but not observed in the chosen period, the option carries an explicit unavailable explanation instead of a blank value or zero.
