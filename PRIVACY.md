# Privacy

AI Development Dashboard is local-first. The Local Core—the scanner, localhost server, and local views—does not make network requests. It reads supported local metadata and writes derived analytics only under `.dashboard-data/`, which is gitignored.

Every `ai-dashboard open` performs bounded local discovery, and the running dashboard debounces known adapter-root changes with a five-minute fallback check. These probes use allowlisted executable/application/local-root metadata only: they do not launch tools, read prompt/transcript bodies, inspect browser data, or contact provider/GitHub services. New observed model IDs are normalized and retained locally with first/last-seen metadata. This is separate from optional Connected Services.

## Runtime and machine resources

The private Maintenance Runtime & Resources console stores and displays only
normalized local metadata: Dashboard lifecycle identity, adapter/runtime
presence and health, sampled CPU/memory/disk values, and bounded sanitized
lifecycle events. Apple Silicon is labelled as unified memory and no dedicated
VRAM is fabricated. Runtime/resource data is not added to Share Stats. Dashboard
Restart/Stop controls are same-origin local actions for the verified owned
Dashboard process; no generic process-manager controls, shell commands, sudo,
or PID-only kills are exposed. External runtimes remain observe-only unless a
future adapter can prove ownership.

## Explicit bug reporting

Bug reporting is opt-in. A lower-left **Report a bug** action is available when the dashboard is running, and `ai-dashboard report-bug` is available when it is not. Nothing is transmitted when an error occurs or when the dashboard starts. Reports are first written locally as a small bundle under `.dashboard-data/bug-reports/` so the user can review and attach them manually. Diagnostics are built from an allowlist of dashboard version/commit, schema version, OS/Node summary, lifecycle state/stage, boolean permission state, adapter lifecycle summaries, aggregate counts, and bounded sanitized lifecycle events. Prompt bodies, responses, transcript text, source code, terminal/test output, tool arguments, credentials, cookies/JWTs, environment values, private notes, project names, and full absolute paths are excluded. The description and context are user-authored fields and should be reviewed before sharing. A screenshot is included only when the user explicitly selects one and confirms it in the report; the UI warns that images may contain private project information.

## Optional Connected Services

Connected Services are disabled by default. When you explicitly connect OpenRouter and manually sync, the dashboard contacts only OpenRouter's analytics metadata/query and credits endpoints using a management key supplied to the dashboard process through `OPENROUTER_MANAGEMENT_KEY`. The key is not written to disk: settings retain only the opaque `env:OPENROUTER_MANAGEMENT_KEY` reference. The connector stores normalized aggregate model/provider, token, request, cost, and credit data with sync timestamps; it does not send or retain prompts, transcript bodies, source code, raw request IDs, account IDs, or API-key metadata. Disconnect disables future OpenRouter calls and forgets the reference while preserving already-normalized local aggregates.

Cline's inference credential is owned by Cline and is never read, copied, or placed in dashboard settings. The local Cline adapter detects Cline inside Cursor through the extension installation (or another explicitly supported host) and may inspect bounded structural session JSON/JSONL metadata and numeric usage fields under `~/.cline/data/sessions/`, plus a narrow read-only query of the validated 4.1.14 `~/.cline/data/db/sessions.db` lifecycle columns (session ID, status, timestamps, process ID, route, workspace, and status lock). It excludes `*.messages.json` bodies before opening them and never selects prompt/message/metadata content from SQLite; provider settings, secret stores, prompt/response content, tool arguments, and authentication material remain outside the read boundary. A Cline route may retain `agent: Cline`, `host: Cursor`, `gateway: OpenRouter`, and an underlying provider/model without implying that the dashboard can correlate it to account-level OpenRouter rows.

Antigravity is a local adapter, not a Connected Service. Closed discovery reads only application/CLI/root presence. Its optional CLI status-line capture is off by default and requires a preview plus explicit local confirmation before it changes the documented `~/.gemini/antigravity-cli/settings.json` `statusLine` command. The bridge writes only model identity, workspace/cwd for local attribution, current context token categories, quota bucket remaining/reset data, plan tier, and CLI version. It excludes email, transcript paths/content, VCS, sandbox, prompts, and account credentials; it never invokes `/usage` or `/quota`.

Efficiency instrumentation stores only normalized IDs, timestamps, identity, token categories, bounded event classes, numeric exit status, and user-confirmed outcome/cycle metadata. Comparable observations additionally store opaque task keys, private local labels, bounded validation-contract IDs/strengths, capability configuration IDs, and model-segment/cycle linkage. It never stores prompts, responses, source code, test/terminal output, tool arguments, or secrets. A command may be classified in memory as a known test/validator, but its text is discarded. Efficiency data is private and is not included in Share Stats.

## What is stored locally

- source file paths and fingerprints
- timestamps, compact counters, Git snapshot metadata
- normalized token category totals when a local record exposes them, dated by usage-event timestamps
- project pins, statuses, and private notes in `project-metadata.json`
- local appearance preference (a validated accent hex value) in `settings.json` and browser local storage
- frozen public-safe share snapshots when you export a recap
- explicitly saved local bug-report bundles, containing only report text, an optional selected screenshot, and optional allowlisted diagnostics

## What is never copied

- prompt bodies, transcript text, tool arguments
- credentials, cookies, API keys, environment values
- source code from observed projects
- Claude/Cursor subscription account data
- OpenRouter management credentials, raw request identifiers, account identifiers, or API-key metadata
- Cline inference keys, provider settings, VS Code secret storage, or Cline transcript/message bodies

Cursor itself can show token usage in the Cursor account dashboard. This product does not scrape that dashboard. The local adapter may read `state.vscdb` **read-only** for `cursorDiskKV` token/context-meter metadata and text lengths. It never reads ItemTable auth keys, cookies, JWTs, or prompt bodies. Results are labelled Exact, Estimated, Mixed, or Unavailable. Official Usage CSV import remains a planned fallback.

## Sharing

Share Stack, Manifest, Setup Prompt, and Share Story cards use an allowlisted public-safe snapshot. They exclude project names, notes, paths, prompts, credentials, raw OpenRouter request/key/account identifiers, and private capabilities. Aggregate OpenRouter values are not exported by Phase 2A. See [docs/SHARING-PRIVACY.md](docs/SHARING-PRIVACY.md).

## Public GitHub

The repository is private until an explicit visibility change. The in-app Source code footer link stays off until `repositoryPublic` is enabled in `.dashboard-data/settings.json` after that change. A public release still requires the history audit in [docs/RELEASE-CHECKLIST.md](docs/RELEASE-CHECKLIST.md).
