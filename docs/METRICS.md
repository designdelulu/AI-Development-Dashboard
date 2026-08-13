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

Tokens per session, cache-read ratio and tools per session compare rolling 30-day periods only when both periods have at least three eligible observations and identical definitions. Git changes and LOC are descriptive context, never productivity scores.

## Live activity monitor and system resources

**Activity** is a visualisation of timestamped local session events—not model compute, effort, token throughput, or user presence. Every event contributes a deterministic weight of `1 + min(2, log2(tool calls + 1))` at its observed timestamp. The monitor samples a rolling 45-second window and decays each contribution exponentially with a 9-second decay constant. With no observed events, an agent trace settles to its baseline. The browser interpolates/decays these compact timestamps between index refreshes; it never creates random spikes or asks the scanner to reparse history for animation.

The Canvas applies a display-only gain `tanh(0.82 × raw intensity)` before mapping each agent onto one shared plotting field. Zero maps to exactly zero, the transform is deterministic and monotonic, and the normalized values are never stored or fed back into analytics. The shared baseline sits at 82% of plot height and the display range spans 68%, so modest real events are visible while larger bursts remain bounded. Because every agent uses the same field and transform, traces can overlap and cross without implying comparability beyond the observed activity definition.

The resource strip is intentionally separate from agent activity. On macOS it reports working RAM from `vm_stat` active + wired + compressed pages, host CPU utilisation derived from deltas in Node's `os.cpus()` time counters, and this dashboard server's RSS/process CPU. These are host/system values, not attributable AI consumption. The backend samples every two seconds; working RAM refreshes every five seconds. A single cache-disabled `/api/live-state` poll delivers system resources and the compact agent-event ring to the browser every two seconds. Historical scanner state is not involved. Missing telemetry displays as unavailable.

The canvas redraw is capped at roughly 10 frames per second and retains only compact recent timestamps in the browser. Source watching remains incremental: it waits for 7.5 seconds of local source quiet before a heavier index refresh, ignores the dashboard's own derived data, and falls back to a five-minute checkpoint refresh. It never continuously rescans session histories to animate the monitor.

### Live signal sources

The initial monitor used only session-summary timestamps, which could arrive too late to indicate a currently active response. It now also holds a 60-second in-memory ring of actual filesystem watch events. The backend checks the known live files every 1.5 seconds and the browser requests the compact live snapshot every two seconds. Claude activity comes from modified `.claude/projects/**/*.jsonl` session files; Codex from modified `.codex/sessions/**/*.jsonl` files; Cursor from modified `.cursor/projects/**/agent-transcripts/*.{json,jsonl}` files. A file update has a deterministic base weight plus a capped log-scale byte-growth contribution. It is evidence of local session output/activity, not remote compute. If a provider does not write one of these sources while it is working, its trace remains idle rather than being fabricated.

The live-pipeline repair also corrected the Canvas clock: `requestAnimationFrame` supplies a page-relative timestamp, while agent events use Unix epoch timestamps. The monitor now uses `Date.now()` when computing event age. Comparing those two clock domains previously made every genuine live event appear impossibly old and forced traces to baseline.

The frozen resource strip had a separate frontend failure: the first Overview render asked the contextual-copy selector to inspect `resources.ram` while the initial live resource state was still `null`. That exception stopped startup before the live polling timers were registered. The selector now treats the pre-sample state as unavailable, and startup fetches one live snapshot before rendering. System values and agent activity then continue through the same bounded transport without reloading.

## Plan capacity

Plan capacity remains separate from local token analytics. Codex session records currently expose native structured `rate_limits` metadata including used percentage, window length, reset timestamp, and plan type; the dashboard normalizes this into percent remaining and refreshes its read-only local snapshot once per minute. Claude and Cursor expose no supported structured local remaining-plan source in the bounded audit, so they explicitly show `Plan usage unavailable through a supported local source.` No cookies, credentials, browser DOM, or unofficial provider endpoints are used.

## Share recap periods

Share Stats filters public-safe metrics to **Today**, **This Month**, or **Since tracking began**. “Since tracking began” starts at the earliest timestamp in the dashboard’s available local session records; it does not claim complete pre-dashboard history. Each frozen `ShareSnapshot` records its period boundaries and title. A metric is omitted when it has no evidence in the selected period.
