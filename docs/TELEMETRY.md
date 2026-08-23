# Telemetry sources

## Local rediscovery and observed identities

Every `ai-dashboard open` performs a local adapter discovery pass; known adapter roots are watched with a debounce and a five-minute local fallback detects supported tools installed while the service is already running. Discovery probes only allowlisted executable/application/root evidence and does not launch applications, parse prompt bodies, or make network requests. A model ID observed from a supported source keeps its raw ID and is normalized into the local identity registry with first/last-seen timestamps. A previously unseen model therefore appears in supported usage/identity surfaces without a dashboard release. This does not make a gateway, an installed application, or historical usage into Live Agent Activity.

The loopback server binds and completes its liveness handshake before the initial scan. The first discovery pass runs in an owned child process so a slow project/Git scan cannot block `/api/health`, `stop`, or the browser shell. Capacity refreshes and process-presence enumeration also run outside request handling; `/api/status` and `/api/live-state` use compact cached metadata rather than hydrating the full historical index. Known adapter-root watchers live in a small child process, while the five-minute scheduler remains the fallback. A timed-out or failed startup terminates the child it spawned and cancels its helpers, so a failed `open` cannot leave orphan indexing work behind. A bounded `.dashboard-data/lifecycle.jsonl` records sanitized startup/listening/discovery/error stages; it contains no raw process output, prompts, transcripts, code, credentials, or environment values.

## Runtime presence versus AI work

Live Agent Activity keeps process/runtime presence separate from validated AI work. An asynchronous local process check runs at most every five seconds and reads only `ps comm` executable paths, never command arguments, prompts, source code, terminal output, or tool input. A recent good snapshot is retained for a bounded stale window when one poll fails; only after that window does the adapter surface **Presence Unknown**. An adapter may declare an executable-name/path hint when that is safe and reliable. That signal can render **Idle** (runtime present, no validated AI work), **Closed** (runtime absent), or **Presence Unknown**; it never emits an activity event, waveform pulse, token observation, Needs You state, or global live indicator.

**Working** and **Recently Active** still require validated local work evidence. Cursor opening, Cursor project/window startup, generic process presence, Claude statusline helpers, quota refreshes, and dashboard-generated files remain non-work signals. A structurally observed Cursor turn can hold Working through sparse planning/tool intervals until its structural completion row or bounded expiry. A Closed lane remains visible for an observed live-capable runtime and says `Last AI activity … ago` rather than implying it has been closed for that interval.

The shared header label **Dashboard live** describes the localhost service/data refresh, not current AI work. Agent activity is reported separately by the Live Agent Activity lanes and the sidebar signal.

### Attention is a current state

`Needs You` is reserved for an allowlisted, structured request that is still unresolved—such as an approval, permission, or explicit input request. A normal turn-completion record (including Codex `event_msg.payload.type: task_complete`) means the runtime finished that turn; it does not mean the user must respond. Attention clears on a structured resolution or subsequent work, and a bounded safety expiry prevents an undetectable stale marker from becoming a day-old current state. When the runtime exits, presence state takes precedence and the lane is **Closed**. Historical attention timestamps, when retained for diagnostics, must be presented as history (for example, `Last needed attention … ago`) rather than as the current state.

## Token Activity display scale

Token Activity totals remain the normalized local calendar totals described in `METRICS.md`. Contributor bars are selected-range **observed-token shares** and use the same denominator as their printed percentage; the adaptive intensity display is a separate surface. The Live Feed’s adaptive intensity display separately stores a versioned local numeric scale: current-day Fresh + Output, a 30-completed-day recent P95 summary, and a completed-day lifetime high. It reads no raw transcript content and makes no network request. Cache reads/creation remain part of observed totals but do not set the primary intensity bar.

## OpenRouter connected telemetry (optional)

Disabled by default. After explicit connection and manual sync, a supplied OpenRouter Management API key is used only for `GET /api/v1/analytics/meta`, `POST /api/v1/analytics/query`, and `GET /api/v1/credits`. Metadata is fetched first; only metrics/dimensions the response advertises are queried, queries use at most two dimensions, and `metadata.truncated` remains visible. The normalized cache stores aggregate values only (cost, request count, advertised token fields, models/providers, credits, period and sync time), and preserves OpenRouter-reported cost/token evidence as **Exact**.

OpenRouter gateway/account is distinct from the observed underlying provider/model. Agent, host, harness, and project are Unknown unless separately proven. Timestamp proximity is never project attribution. Analytics history is usage telemetry, not live activity. Errors are surfaced as invalid credential, insufficient permission, rate limit, service unavailable, malformed response, offline, or stale cached data without blocking local scanning.

## Antigravity CLI status-line capture (optional local integration)

Closed Antigravity discovery supports application/CLI/root presence only; retained IDE/conversation storage is not parsed. When explicitly enabled, the documented `statusLine` JSON bridge captures model ID/display name, current workspace/cwd, current context token categories, quota bucket `remaining_fraction`/`reset_time`, plan tier, and CLI version. The snapshot is exact for those documented fields but is not an accumulated usage history and never feeds token-period totals.

`quota` keys remain named buckets, separate from model identity. A bucket may cover multiple models, so its remaining percentage is rendered only as a capacity bucket. The snapshot becomes stale after 15 minutes. Agent state, an open app, a status update, and quota refresh do not constitute Live Agent Activity. The helper excludes `email`, `transcript_path`, transcripts, VCS, sandbox, and all unlisted fields; it never invokes interactive `/usage` or `/quota`.

## Claude plan capacity

Official Claude Code statusline JSON (v2.1.80+) may include `rate_limits.five_hour` and `rate_limits.seven_day` with `used_percentage` (0–100) and `resets_at` (Unix epoch seconds). Present for Claude.ai Pro/Max after the first API response. This installation was verified at Claude Code 2.1.198 against [statusline docs](https://code.claude.com/docs/en/statusline).

An optional helper exists for a future explicit local-integration flow: it would copy `scripts/claude-capacity-capture.mjs` to `~/.claude/ai-dashboard/` and set `statusLine.command`, **chaining any existing statusline command**. Phase 1 scanning never invokes that helper or changes Claude settings. If explicitly enabled in a later reviewed flow, only rate-limit metadata is written to `~/.claude/usage_state.json`; remaining percent is `100 - used`. These dashboard-generated files are never live-activity sources.

## Capacity actions

Plan Capacity actions are registry metadata on a discovered capacity source, not Live Agent controls. A discovered Claude source exposes **View Claude Usage** (`https://claude.ai/settings/usage`) and a discovered Cursor source exposes **View Cursor Usage** (`https://cursor.com/dashboard`) even when their applications are Closed or capacity telemetry is unavailable. These are user-initiated normal-browser links only: the dashboard does not embed, authenticate to, scrape, or make background requests to either account page.

## Cursor tokens

Read-only SQLite: `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` (`file:...?mode=ro`, `PRAGMA query_only`). Queries `cursorDiskKV` keys `composerData:` and `bubbleId:` only. Never ItemTable credentials, JWTs, cookies, or prompt bodies.

Classification: **YELLOW** undocumented local application storage. Experimental; degrades on schema change. The SQLite helper opens `mode=ro&immutable=1` so a live Cursor process cannot be write-locked.

Provenance: ideas from [CodeBurn’s MIT Cursor provider](https://github.com/getagentseal/codeburn) (bubble vs composer meter vs char estimate). Not a vendored copy.

Priority per conversation: explicit bubble `tokenCount` → `composerData.promptTokenBreakdown.totalUsedTokens` / `contextTokensUsed` (context meter, credited once at composer `createdAt`) → documented `round(chars / 4)` estimate when tokenCount is `{0,0}` with text (known current-Cursor storage bug) → unavailable. A genuine `{0,0}` with no text is skipped, not estimated. File mtime is never a usage date. `agentKv` rows without timestamps are skipped. Cached `cursorDiskKV` sessions keep Exact/Estimated/Mixed status so a fingerprint hit cannot display Cursor as unavailable.

## Rejected

Cursor JWT extraction, browser cookies, private authenticated APIs, credential interception, unofficial provider endpoint reverse engineering.
