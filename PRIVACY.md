# Privacy

AI Development Dashboard is local-first. The Local Core—the scanner, localhost server, and local views—does not make network requests. It reads supported local metadata and writes derived analytics only under `.dashboard-data/`, which is gitignored.

## Optional Connected Services

Connected Services are disabled by default. When you explicitly connect OpenRouter and manually sync, the dashboard contacts only OpenRouter's analytics metadata/query and credits endpoints using a management key supplied to the dashboard process through `OPENROUTER_MANAGEMENT_KEY`. The key is not written to disk: settings retain only the opaque `env:OPENROUTER_MANAGEMENT_KEY` reference. The connector stores normalized aggregate model/provider, token, request, cost, and credit data with sync timestamps; it does not send or retain prompts, transcript bodies, source code, raw request IDs, account IDs, or API-key metadata. Disconnect disables future OpenRouter calls and forgets the reference while preserving already-normalized local aggregates.

Antigravity is a local adapter, not a Connected Service. Closed discovery reads only application/CLI/root presence. Its optional CLI status-line capture is off by default and requires a preview plus explicit local confirmation before it changes the documented `~/.gemini/antigravity-cli/settings.json` `statusLine` command. The bridge writes only model identity, workspace/cwd for local attribution, current context token categories, quota bucket remaining/reset data, plan tier, and CLI version. It excludes email, transcript paths/content, VCS, sandbox, prompts, and account credentials; it never invokes `/usage` or `/quota`.

Efficiency instrumentation stores only normalized IDs, timestamps, identity, token categories, bounded event classes, numeric exit status, and user-confirmed outcome/cycle metadata. It never stores prompts, responses, source code, test/terminal output, tool arguments, or secrets. A command may be classified in memory as a known test/validator, but its text is discarded. Efficiency data is private and is not included in Share Stats.

## What is stored locally

- source file paths and fingerprints
- timestamps, compact counters, Git snapshot metadata
- normalized token category totals when a local record exposes them, dated by usage-event timestamps
- project pins, statuses, and private notes in `project-metadata.json`
- frozen public-safe share snapshots when you export a recap

## What is never copied

- prompt bodies, transcript text, tool arguments
- credentials, cookies, API keys, environment values
- source code from observed projects
- Claude/Cursor subscription account data
- OpenRouter management credentials, raw request identifiers, account identifiers, or API-key metadata

Cursor itself can show token usage in the Cursor account dashboard. This product does not scrape that dashboard. The local adapter may read `state.vscdb` **read-only** for `cursorDiskKV` token/context-meter metadata and text lengths. It never reads ItemTable auth keys, cookies, JWTs, or prompt bodies. Results are labelled Exact, Estimated, Mixed, or Unavailable. Official Usage CSV import remains a planned fallback.

## Sharing

Share Stack, Manifest, Setup Prompt, and Share Story cards use an allowlisted public-safe snapshot. They exclude project names, notes, paths, prompts, credentials, raw OpenRouter request/key/account identifiers, and private capabilities. Aggregate OpenRouter values are not exported by Phase 2A. See [docs/SHARING-PRIVACY.md](docs/SHARING-PRIVACY.md).

## Public GitHub

The repository is private until an explicit visibility change. The in-app Source code footer link stays off until `repositoryPublic` is enabled in `.dashboard-data/settings.json` after that change. A public release still requires the history audit in [docs/RELEASE-CHECKLIST.md](docs/RELEASE-CHECKLIST.md).
