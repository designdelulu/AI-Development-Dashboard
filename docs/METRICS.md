# Metrics

Metric definitions version: 2.0.

## Token fields

| Display field | Meaning | Never interpreted as |
| --- | --- | --- |
| Fresh input | Provider `input_tokens` excluding cache fields. | Subscription quota or billed tokens. |
| Output tokens | Provider `output_tokens`. | Completed work or quality. |
| Cache read | Provider `cache_read_input_tokens`; previously processed context reused by the provider. | Fresh user input. |
| Cache creation | Provider `cache_creation_input_tokens`; context written to cache where exposed. | Fresh user input. |
| Reasoning / other | Provider-specific explicit fields, if supplied. | A comparable cross-provider measure unless documented by that provider. |
| Total observed token activity | Sum of the above observed categories. Useful for describing model work; deliberately not called “tokens used.” | Subscription billing, plan allowance, or API cost. |

Missing fields remain unavailable/zero in their category. A zero never means a provider used no tokens; it may mean the local source does not expose that field.

## Attribution and efficiency

**Confirmed** project attribution uses a recorded session `cwd` that falls inside a discovered Git root. **Strongly inferred** attribution uses a deterministic encoded Cursor/Claude project folder. Weak/Unknown sessions remain visible in global counts but do not affect project headlines or comparable efficiency.

Tokens per session, cache-read ratio and tools per session compare rolling 30-day periods only when both periods have at least three eligible observations and identical definitions. Git branch, HEAD subject, dirty state and commit count are captured on each scan. LOC walks are not part of the scan path; they remain an optional descriptive helper, never a productivity score.

## Live activity monitor and system resources

**Activity** is a visualisation of timestamped local session events—not model compute, effort, token throughput, or user presence. Each event retains its deterministic observed weight. For presentation, that real event becomes a short signal envelope with a 180 ms attack and 7.5-second exponential decay. Envelopes from repeated events add together, so sustained real updates create denser regions. The Canvas samples those envelopes across a rolling 45-second field as closely spaced vertical micro-bars; one telemetry event can therefore produce many visual bars without becoming many analytics events.

The bar field has two explicitly separate inputs. **Activity modulation** uses only the real event envelopes and a bounded display gain of `tanh(0.52 × envelope energy)`. **Baseline carrier** is a low-amplitude deterministic sine carrier that only indicates the display is alive. It never changes state, intensity, or timing. There are no random activity bursts. Claude, Codex and Cursor occupy separate vertical lanes so their traces do not hide each other. Age-based opacity and envelope decay create the trailing wake. Reduced-motion mode replaces the moving carrier with a constant low baseline while retaining real-event bars and text state.

The resource strip is intentionally separate from agent activity. On macOS it reports working RAM from `vm_stat` active + wired + compressed pages, host CPU utilisation derived from deltas in Node's `os.cpus()` time counters, and this dashboard server's RSS/process CPU. These are host/system values, not attributable AI consumption. The backend samples every two seconds; working RAM refreshes every five seconds. A single cache-disabled `/api/live-state` poll delivers system resources and the compact agent-event ring to the browser every two seconds. Historical scanner state is not involved. Missing telemetry displays as unavailable.

The canvas redraw is capped at 12.5 frames per second (8 in reduced-motion mode), uses three-pixel desktop/five-pixel mobile bar spacing, and retains at most 512 compact recent events. Rendering pauses while the tab is hidden. Source watching remains incremental: it waits for 7.5 seconds of local source quiet before a heavier index refresh, ignores the dashboard's own derived data, and falls back to a five-minute checkpoint refresh. It never continuously rescans session histories to animate the monitor.

### Live agent states and timing

All three adapters use the same conservative state rules over their validated local event sources:

- **Working** — a real local event was observed within the previous 12 seconds. This is observed local busy activity, not remote model inference.
- **Waiting for You** — the most recent event is 12 seconds to five minutes old. This is a strong interaction hint but remains explicitly **Inferred**: Claude, Codex and Cursor do not expose a reliable native “waiting for user” marker in the available local records.
- **Idle** — no relevant event is available, or the most recent event is older than five minutes.
- **Unknown** — the normalized index does not establish a supported local source for that agent.

Browser-local timing begins only when this state tracker first runs. A versioned fixed-size record in local storage accumulates `observedWorkingMs`, `waitingForUserMs`, `observedIdleMs`, `unknownMs`, and `unobservedMs`, plus at most 96 recent state transitions. It never backfills historical durations. Tick gaps over five seconds—such as a suspended or closed tab—go to `unobservedMs` rather than being credited to a state. These measurements describe what the open dashboard observed and form a conservative foundation for future project/cycle attribution; they are not exact provider response or compute times.

### Live signal sources

The backend checks the known live files every 1.5 seconds and the browser requests the compact live snapshot every two seconds. Claude activity comes from modified `.claude/projects/**/*.jsonl` session files; Codex from modified `.codex/sessions/**/*.jsonl` files. Cursor activity is taken from **mtime/size only** on:

- `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb-wal` (and `state.vscdb`)
- `~/.cursor/projects/**/agent-tools/*`
- `~/.cursor/projects/**/agent-transcripts/*.{json,jsonl}` when those files exist

Cursor agent-transcripts are often empty while a current agent is working, so transcripts are not required. A WAL mtime change with unchanged size still counts as one event. The dashboard never parses SQLite, WAL payloads, or transcript bodies. `canvases/`, `mcps/`, and `node_modules` are ignored. A file update has a deterministic base weight plus a capped log-scale byte-growth contribution. It is evidence of local session output/activity, not remote compute.

The live field draws **separate lanes** for Claude, Codex and Cursor instead of overlapping 3px traces, and Cursor uses a higher-contrast teal so it does not disappear into Claude’s idle carrier.

The live-pipeline repair also corrected the Canvas clock: `requestAnimationFrame` supplies a page-relative timestamp, while agent events use Unix epoch timestamps. The monitor now uses `Date.now()` when computing event age. Comparing those two clock domains previously made every genuine live event appear impossibly old and forced traces to baseline.

The frozen resource strip had a separate frontend failure: the first Overview render asked the contextual-copy selector to inspect `resources.ram` while the initial live resource state was still `null`. That exception stopped startup before the live polling timers were registered. The selector now treats the pre-sample state as unavailable, and startup fetches one live snapshot before rendering. System values and agent activity then continue through the same bounded transport without reloading.

## Plan capacity

Plan capacity remains separate from local token analytics. Codex session records currently expose native structured `rate_limits` metadata including used percentage, window length, reset timestamp, and plan type; the dashboard normalizes this into percent remaining and refreshes its read-only local snapshot once per minute. Claude and Cursor expose no supported structured local remaining-plan source in the bounded audit, so they explicitly show `Plan usage unavailable through a supported local source.` No cookies, credentials, browser DOM, or unofficial provider endpoints are used.

## Share recap periods

Share Stats filters public-safe metrics to **Today**, **This Month**, or **Since tracking began**. “Since tracking began” starts at the earliest timestamp in the dashboard’s available local session records; it does not claim complete pre-dashboard history. Each frozen `ShareSnapshot` records its period boundaries and title. A metric is omitted when it has no evidence in the selected period.

The social renderer uses period-specific emphasis rather than one fixed number grid: Today leads with current observed agent/session activity, This Month is a recap composition, and Since Tracking Began is framed as a developer profile with its tracking date. Agent mark size uses `min + (max − min) × sqrt(agent sessions / largest agent sessions)` for non-zero agents; a zero-session agent receives no data-sized mark and a faint labelled placeholder. This visual scaling never changes the frozen snapshot values.

Token share options traverse the same session-period filter as the recap. Fresh Input, Output, Cache Read and Cache Creation remain distinct metric IDs through eligibility, `ShareSnapshot`, and SVG rendering. If a category is supported in the available history but not observed in the chosen period, the option carries an explicit unavailable explanation instead of a blank value or zero.
