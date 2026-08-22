# AI Development Dashboard

AI Development Dashboard is a **local-first, project-first operating and analytics layer** for developers who use more than one AI coding tool. It observes supported local and explicitly connected sources, then organizes activity around projects, agents, hosts, providers, models, capabilities, capacity, usage, and defensible efficiency evidence.

It is not an AI model, orchestration runtime, model router, generic token counter, or skill marketplace.

![Live Agent Activity — observed runtime signal field](docs/assets/ai-development-dashboard-live-activity.png)

## Why use it?

- Resume project work with local handoff context instead of starting in a provider dashboard.
- See validated local runtime activity, plan capacity, and adaptive token activity without confusing installation with active work.
- Keep models, providers, hosts, gateways, and accounts distinct—even when a new model appears through an existing supported tool.
- Understand private efficiency evidence without a made-up “best model” score.
- Keep local scanning offline; connect OpenRouter only if you explicitly want its account telemetry.

![Overview — pick up where you left off](docs/assets/ai-development-dashboard-overview.png)

## Get running in a few minutes

**Requirements:** Node.js 20+, Git, and macOS for the currently validated experience. The local server binds to loopback only. Windows and Linux have not yet received the same end-to-end validation.

```bash
git clone <repository-url>
cd AI-Development-Dashboard
npm run setup
ai-dashboard open
```

`npm run setup` checks Node, runs `npm install`, links the local `ai-dashboard` command for the current user, and checks lifecycle status. It does not use `sudo`, edit your shell profile, start a background service, or contact a provider.

When the dashboard opens, it starts a localhost service, opens the browser, scans configured project roots, detects supported local tools and retained evidence, registers observed providers/models, and updates source lifecycle state. No provider account or sign-up is required for Local Core.

If `~/Dropbox/Projects` or `~/Projects` exists it is discovered; otherwise first run asks you to choose a project root. You can also set `AI_DASHBOARD_PROJECTS_ROOT` (one path) or `AI_DASHBOARD_PROJECTS_ROOTS` (colon- or comma-separated paths).

### Manual fallback

If setup cannot link the command, the equivalent manual path is:

```bash
npm install
npm link
ai-dashboard doctor
ai-dashboard open
```

## Everyday commands

```bash
ai-dashboard open      # start the owned local service and open the dashboard
ai-dashboard status    # inspect the owned service
ai-dashboard stop      # stop only the owned dashboard service
ai-dashboard update    # update AI Development Dashboard itself
```

Run `ai-dashboard --help` for the complete lifecycle command list.

`update` updates the **dashboard only**. It does not update Claude, Codex, Cursor, Antigravity, OpenRouter models, skills, plugins, or capabilities. For a linked Git checkout it refuses dirty or diverged work, fetches only when you explicitly request it, fast-forwards only, and restarts only the dashboard service it owns.

## Discovery that keeps up

Every `ai-dashboard open` performs local discovery. While it is running, the dashboard watches known adapter roots and uses a bounded five-minute local fallback check. You do not normally need a rescan or restart.

| Situation | What happens |
| --- | --- |
| A new model appears through a supported tool | Its raw ID is preserved, normalized into the local identity registry, and appears in relevant usage surfaces automatically. |
| A supported tool is installed after startup | Local rediscovery notices it and updates its Installed/Historical/Active/Connected state when its adapter supports that evidence. |
| A completely unsupported tool or harness appears | It may need a future adapter before the dashboard can truthfully read sessions, tokens, or live work. No telemetry is guessed. |

Installation, historical use, active work, and connected status remain separate. An installed or open application is never treated as live agent activity without validated work evidence.

![Live Feed — plan capacity and observed token activity](docs/assets/ai-development-dashboard-live-feed.png)

## Current support

| Source | Installed / historical discovery | Live work | Tokens / models | Capacity / cost | Notes |
| --- | --- | --- | --- | --- | --- |
| Claude Code | Supported | Validated JSONL growth | Supported where local fields exist | Optional documented local capacity status | Status/config touches never create live activity. |
| Codex CLI | Supported | Supported local session activity | Supported where local fields exist | Native local plan windows where exposed | Host and model remain separate. |
| Cursor | Supported | Supported structural agent-tool/transcript growth | Exact, Estimated, Mixed, or Unavailable local evidence | Capacity unavailable | App startup, editor storage, and WAL housekeeping are not AI activity; no browser/account scraping. |
| Antigravity | Closed-app/CLI/root detection | Unavailable without validated work evidence | Optional documented local status-line snapshot | Optional quota bucket snapshot | Presence is not history or live work. |
| OpenRouter | Explicit Connected Service | Not a live agent | Provider-reported aggregate usage/models | Exact reported cost/credits where exposed | Disabled by default; project attribution stays Unknown without deterministic linkage. |
| Git | Project discovery | — | Descriptive repository activity | — | Not a productivity score. |
| VS Code | Extension/host discovery | — | — | — | Editor presence is not AI activity. |

### OpenRouter (optional)

OpenRouter is a connected **gateway/account telemetry source**, not a Live Agent. After explicit connection and manual sync, the dashboard uses `OPENROUTER_MANAGEMENT_KEY` from the dashboard process to request allowed analytics metadata, aggregate usage, and credits. It stores an opaque credential reference, never the key. Provider-reported cost is Exact only at the level OpenRouter reports and can be deterministically correlated; timestamp proximity never assigns remote requests to a project or local agent.

### Antigravity (local foundation)

Antigravity can be found while closed from safe local installation evidence. Its optional documented status-line bridge requires a preview and explicit confirmation before changing its configuration. It can retain observed host, provider, model, workspace, context fields, and quota buckets when that source exposes them. Historical IDE telemetry is not fabricated, and an open app or refreshed quota does not create a live waveform.

## What the dashboard shows

- **Overview** — project-first resume context, handoff, and active work.
- **Live Feed** — dynamic 0…N local runtime lanes, token activity, capacity sources, and secondary system telemetry.
- **Projects** — canonical Git project inventory and private working memory.
- **Capabilities & Maintenance** — evidence-based inventory and review signals; no automatic skill installation or mutation.
- **Efficiency** — private work-block/model/validator evidence and comparison cycles only when observations form defensible cohorts. No universal productivity score, leaderboard, or historical task fabrication.
- **Share Stats** — an allowlisted local share-story builder that excludes private project data, credentials, raw request IDs, and efficiency data.

### Token Activity

The Token Activity meter is an adaptive **visual aid**. Its intensity uses Fresh + Output, while Cache Read, Cache Creation, and Observed token activity remain visible separately. Contributor bars are true selected-range observed-token shares, not intensity bars. Comparable completed local-day windows establish a recent P95 heavy range and a retained lifetime high, so ordinary activity does not permanently look maxed out. It never changes underlying totals, evidence labels, billing, or subscription usage. See [metrics](docs/METRICS.md#adaptive-token-activity-intensity).

### Appearance

The dashboard keeps its dark Design Delulu visual system and hot-pink default accent. In **Maintenance → Appearance**, choose one of ten presets or enter a validated custom hex color. The setting previews immediately, persists locally, and does not affect semantic success, warning, or error colors. It is not included in Share Stats.

## Privacy and security

**Local Core** (scanning, the localhost UI, local rediscovery, and local views) makes no network requests. It derives metadata locally and does not retain prompt bodies, source code, transcript bodies, terminal/test output, tool arguments, browser credentials, or provider keys.

**Connected Services** are disabled by default. They make explicitly authorized requests only to the selected provider. OpenRouter is the current connected integration; it never receives prompts, code, or transcripts from the dashboard.

See [Privacy](PRIVACY.md), [Security](SECURITY.md), and [sharing privacy](docs/SHARING-PRIVACY.md).

## Troubleshooting

| Problem | What to do |
| --- | --- |
| `ai-dashboard: command not found` | Run `npm run setup`, or use the [manual fallback](#manual-fallback). |
| Dashboard may already be running | Run `ai-dashboard status`. |
| Stop the owned service | Run `ai-dashboard stop`. |
| Update refused because the Git tree is dirty | Commit or stash your own changes, then retry. The updater never overwrites them. |
| Port or lifecycle issue | Run `ai-dashboard status`, then `ai-dashboard doctor`. |

## Documentation

Start with the [documentation index](docs/README.md). It links the current architecture, telemetry, metrics, adapters/integrations, privacy, security, efficiency semantics, contributing guidance, and release checklist. Planning documents are retained as planning context, not a promise that every planned integration is implemented.

## Development

```bash
npm test
npm run scan
npm start
```

The repository is currently private beta. It is MIT licensed ([LICENSE](LICENSE)); a public release still requires the [release checklist](docs/RELEASE-CHECKLIST.md).
