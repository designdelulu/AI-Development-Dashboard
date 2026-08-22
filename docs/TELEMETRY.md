# Telemetry sources

## OpenRouter connected telemetry (optional)

Disabled by default. After explicit connection and manual sync, a supplied OpenRouter Management API key is used only for `GET /api/v1/analytics/meta`, `POST /api/v1/analytics/query`, and `GET /api/v1/credits`. Metadata is fetched first; only metrics/dimensions the response advertises are queried, queries use at most two dimensions, and `metadata.truncated` remains visible. The normalized cache stores aggregate values only (cost, request count, advertised token fields, models/providers, credits, period and sync time), and preserves OpenRouter-reported cost/token evidence as **Exact**.

OpenRouter gateway/account is distinct from the observed underlying provider/model. Agent, host, harness, and project are Unknown unless separately proven. Timestamp proximity is never project attribution. Analytics history is usage telemetry, not live activity. Errors are surfaced as invalid credential, insufficient permission, rate limit, service unavailable, malformed response, offline, or stale cached data without blocking local scanning.

## Claude plan capacity

Official Claude Code statusline JSON (v2.1.80+) may include `rate_limits.five_hour` and `rate_limits.seven_day` with `used_percentage` (0–100) and `resets_at` (Unix epoch seconds). Present for Claude.ai Pro/Max after the first API response. This installation was verified at Claude Code 2.1.198 against [statusline docs](https://code.claude.com/docs/en/statusline).

An optional helper exists for a future explicit local-integration flow: it would copy `scripts/claude-capacity-capture.mjs` to `~/.claude/ai-dashboard/` and set `statusLine.command`, **chaining any existing statusline command**. Phase 1 scanning never invokes that helper or changes Claude settings. If explicitly enabled in a later reviewed flow, only rate-limit metadata is written to `~/.claude/usage_state.json`; remaining percent is `100 - used`. These dashboard-generated files are never live-activity sources.

## Cursor tokens

Read-only SQLite: `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` (`file:...?mode=ro`, `PRAGMA query_only`). Queries `cursorDiskKV` keys `composerData:` and `bubbleId:` only. Never ItemTable credentials, JWTs, cookies, or prompt bodies.

Classification: **YELLOW** undocumented local application storage. Experimental; degrades on schema change. The SQLite helper opens `mode=ro&immutable=1` so a live Cursor process cannot be write-locked.

Provenance: ideas from [CodeBurn’s MIT Cursor provider](https://github.com/getagentseal/codeburn) (bubble vs composer meter vs char estimate). Not a vendored copy.

Priority per conversation: explicit bubble `tokenCount` → `composerData.promptTokenBreakdown.totalUsedTokens` / `contextTokensUsed` (context meter, credited once at composer `createdAt`) → documented `round(chars / 4)` estimate when tokenCount is `{0,0}` with text (known current-Cursor storage bug) → unavailable. A genuine `{0,0}` with no text is skipped, not estimated. File mtime is never a usage date. `agentKv` rows without timestamps are skipped. Cached `cursorDiskKV` sessions keep Exact/Estimated/Mixed status so a fingerprint hit cannot display Cursor as unavailable.

## Rejected

Cursor JWT extraction, browser cookies, private authenticated APIs, credential interception, unofficial provider endpoint reverse engineering.
