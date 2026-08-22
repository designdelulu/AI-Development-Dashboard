# Install and Lifecycle Experience Plan

Research date: 2026-08-22.

## Recommendation

Ship a first-class npm CLI now, then add signed standalone executables after the lifecycle contract is stable. Do not build an Electron app or menu-bar wrapper for the next phase.

Conceptual normal-user flow:

```sh
npx @ai-development-dashboard/cli setup
ai-dashboard open
ai-dashboard stop
```

`setup` installs or links the persistent `ai-dashboard` command using an explicit, documented npm path; during repository development the same lifecycle commands run from the checked-out package. npm's `bin` field is the standard way to expose a command, and global packages link it into the user's executable path. [npm package executables](https://docs.npmjs.com/cli/v7/configuring-npm/package-json/), [global installation](https://docs.npmjs.com/downloading-and-installing-packages-globally/)

`@ai-development-dashboard/cli` is a proposed package identifier, not a claim that the name is registered. Verify package ownership/availability and freeze the public command name during release review.

For a normal user, turning the dashboard **on** means `ai-dashboard open`: it starts the private local service if needed, waits for health, and opens the browser. Turning it **off** means `ai-dashboard stop`: it asks the recorded service to shut down and confirms that the owned process stopped. Closing the browser does not ambiguously stop a background service. The UI also offers **Stop dashboard** with confirmation.

## Why this direction

The repository is already a dependency-free Node application with a browser UI and Node 20 baseline. A CLI therefore adds little runtime or maintenance weight and preserves macOS/Windows/Linux viability. A desktop shell would duplicate browser/runtime/update concerns without improving the core workflow yet. A macOS-only LaunchAgent would make one platform polished and the others second-class.

The later distribution target is a small standalone executable built from the same lifecycle CLI and web assets. Node supports Single Executable Applications on Windows, macOS, and Linux and can embed assets, but its SEA facility is still marked active development and has platform build/signing constraints. It should be a packaging phase, not a prerequisite for fixing lifecycle UX. [Node SEA](https://nodejs.org/download/release/v25.6.0/docs/api/single-executable-applications.html)

## Command contract

### `ai-dashboard setup`

- checks supported OS and Node version for npm distribution;
- selects a data/config directory using platform conventions;
- launches browser onboarding on an ephemeral loopback setup token;
- creates no auto-start job until the user opts in;
- records package/version, service identity, and an uninstall manifest;
- can be safely re-run; it reports existing configuration and offers repair/migrate.

### `ai-dashboard open`

- checks the owned service through its health endpoint;
- if stopped, starts it detached with an explicit data/config path;
- waits with a bounded timeout;
- opens the exact loopback URL in the default browser;
- prints the URL if browser launch is unavailable;
- is idempotent when already running.

### `ai-dashboard start [--no-open]`

Starts the service but does not require a browser. It writes an atomic runtime record only after binding succeeds.

### `ai-dashboard stop`

- requests graceful shutdown using a per-install local control token;
- validates process identity and start time before any fallback signal;
- never kills a process based only on a stale PID;
- removes the runtime record only after confirmed exit;
- is a successful no-op when already stopped.

### `ai-dashboard status [--json]`

Shows version, service state, URL/port, process age, scan state, configured roots, data location, start-at-login state, adapter health counts, and last error. It never prints credentials or private project names in default text output.

### `ai-dashboard update [--check]`

- `--check` performs a package-release metadata check only after confirmation/permission;
- update previews current/latest version, source, release link, expected restart, and command;
- npm distribution delegates to npm; standalone distribution uses signed release artifacts;
- service stops gracefully, package updates, migration dry-check runs, service returns only if it was previously running;
- failed verification leaves the previous version or clear recovery instructions.

Dashboard updates are separate from capability/skill updates.

### `ai-dashboard doctor [--json]`

Runs non-mutating checks: version, directories/permissions, port binding, health, runtime-record integrity, adapter roots, config/schema validity, and redacted recent errors. `--fix` is a separate future command with previews.

### `ai-dashboard uninstall`

- previews package, auto-start job, config, derived data, and optional retained user metadata;
- stops the owned service and removes start-at-login first;
- delegates package removal to the installed package method;
- asks separately whether to remove derived dashboard data/config;
- never removes source tool histories or capabilities;
- prints what remains and how to remove it.

## Service ownership and localhost security

- bind only to `127.0.0.1` and `::1`; never `0.0.0.0` by default;
- choose a configured or available high port and record the actual URL;
- set restrictive permissions on config/data/runtime files;
- use an atomic runtime record containing PID, process start identity, port, version, data root, and random control token reference;
- require the control token for shutdown and configuration-changing routes;
- use SameSite/Origin checks and a per-install browser session token for state-changing UI requests;
- no secret in a query string, process title, log, or normal status output;
- health has a public minimal loopback response and a detailed authenticated local response;
- stale runtime records are diagnosed, never trusted blindly.

The current server boundary in `src/cli.js` should be split into lifecycle/process ownership, HTTP routes, and scanning. Product behavior remains dependency-light.

## Start at login

Start at login is off by default and offered at the end of onboarding.

| Platform | Method | Behavior |
| --- | --- | --- |
| macOS | Per-user LaunchAgent for the CLI/executable; a later signed app can use `SMAppService` | Start service without opening browser; visible/revocable in Login Items. Apple recommends user-context agents for per-user processes and modern app-associated login items. [Apple service management](https://developer.apple.com/documentation/servicemanagement/updating-helper-executables-from-earlier-versions-of-macos) |
| Windows | Per-user Task Scheduler entry at logon | No admin requirement; start hidden service, no browser; exact executable path/version-safe launcher |
| Linux | systemd user unit where available; documented desktop autostart fallback | No root; start in user session; no browser |

`ai-dashboard autostart enable|disable|status` previews the exact job and verifies ownership. Updating the package must not leave an auto-start job pointing at an ephemeral npm cache path; the job targets the persistent command/standalone executable.

## First-run onboarding

Onboarding is a resumable state machine, not a JSON editor.

### 1. Welcome and privacy boundary

- “Runs on this device and reads metadata from selected projects and supported tools.”
- Local Core is network-free by default.
- Connected Services and update checks are optional and separate.
- Link to exact collected/excluded fields.

### 2. Project folders

- suggest the repository/current folder and common developer roots only when locally evident;
- use an OS folder chooser or pasted path;
- preview discovered Git roots and allow Project/Tool/Reference/Hidden classification;
- do not scan the entire home directory by default;
- validate symlinks, permissions, duplicates, and overly broad roots.

### 3. Detect tools

Run the closed-app discovery registry and show:

- **Detected** — installed evidence exists;
- **Used before** — supported retained history exists;
- **Installed but no history yet** — no supported records found;
- **Needs one session** — adapter requires the host to emit one record;
- **Not detected** — no evidence after a supported probe;
- **History unavailable** — version/format unsupported;
- **Connect** — optional service such as OpenRouter.

No IDE needs to be open. Do not launch one. The user can rescan later.

### 4. Optional local integrations

Offer Claude and Antigravity status-line capture separately, only where applicable. Explain the exact settings/file change, fields captured, existing integration chaining, disable/rollback path, and need for a future real session. Default is off.

### 5. Connected Services

Offer OpenRouter as optional. Explain network endpoints, credential type, credential-store location, refresh schedule, and that prompt bodies are never requested. “Skip” is a normal path.

### 6. Lifecycle

Offer Start at Login (off), show `open/status/stop`, data location, and a desktop shortcut/bookmark option. Do not make auto-start a condition of a useful dashboard.

### 7. Finish

Run first scan, present adapter health and documentation drift warnings, then open Overview. Onboarding remains accessible under Settings and can be resumed after interruption.

Advanced users retain a documented config file and environment overrides, but the UI owns validation and never requires hand-editing JSON for ordinary setup.

## Data and configuration locations

Use platform conventions and separate durable/ephemeral state:

```text
config/       selected roots, permissions, adapter settings, credential references
data/         normalized index, user metadata, adapter cursors, pricing/schema cache
runtime/      PID/control/port record and bounded current logs
backups/      migration and approved integration journals, bounded retention
```

The repository's `.dashboard-data/` remains a development/portable override, not the default for an installed global utility. Add an explicit `--data-dir` for development and backup workflows.

## Update and migration policy

- package version, index schema, metric definition, adapter contract, and config schema are independently versioned;
- startup performs a read-only compatibility check before migration;
- migration backs up only dashboard-owned data, writes atomically, and leaves source histories untouched;
- downgrade detects newer schemas and refuses unsafe writes while still offering export/recovery guidance;
- update checks are opt-in network actions and can be disabled;
- show release channel (stable only initially) and signed artifact/package source;
- no self-update while a scan or capability modification transaction is active.

## Troubleshooting design

Each failure state includes one next action:

- **Port unavailable:** automatically try allowed alternatives or show `--port`; never bind broadly.
- **Stale service record:** verify process identity, repair record, preserve logs.
- **Permission denied:** identify exact path and offer reselect/exclude; do not suggest broad home permissions.
- **Unsupported source version:** show adapter/source versions, retain other sources, link to report template.
- **Corrupt index:** quarantine derived index and rebuild; never touch originals.
- **Connected auth failure:** mark disconnected/stale, retain prior aggregate data, offer replace credential.
- **Integration capture absent:** distinguish Disabled, Waiting for first session, and Broken.
- **Browser did not open:** print clickable loopback URL.
- **Update failed:** show installed state, rollback/reinstall command, redacted diagnostic bundle.

`doctor` can create an opt-in support bundle containing versions, schemas, health codes, redacted paths, and logs. It excludes project names, prompt/code/tool bodies, credentials, raw transcripts, and capability contents.

## Packaging phases

### Phase A — repository lifecycle parity

Implement `open/start/stop/status/doctor` and service ownership while still running from the repository. This tests semantics before publication.

### Phase B — npm CLI

Add package `bin`, publish from a release workflow, document `npx ... setup`, validate macOS/Windows/Linux, and add update/uninstall. Keep zero mandatory production dependencies if practical.

### Phase C — standalone executables

Build per-platform Node SEA artifacts in native CI, embed public assets, sign/notarize where required, generate checksums/SBOM, and test upgrades from the prior two releases. This removes the Node prerequisite for ordinary users without adding a desktop framework.

### Deferred — native tray/menu bar

Consider only after evidence that browser+CLI lifecycle is a recurring usability problem. A tray shell must reuse the same service/control API and remain optional; it is not a reason to adopt Electron.

## Implementation modules and tests

Recommended modules:

- `src/lifecycle/paths.js`, `runtime-record.js`, `service.js`, `autostart/`, `update.js`, `doctor.js`;
- `src/http/server.js`, `routes.js`, `security.js` split from `src/cli.js`;
- `src/onboarding.js` and a versioned onboarding/config schema;
- `public/onboarding-ui.js`, `public/settings-ui.js`;
- package `bin/ai-dashboard.js`.

Required tests:

- repeated open/start/stop and already-running/stopped behavior;
- stale/reused PID and unrelated-process protection;
- port collision, IPv4/IPv6 loopback, graceful timeout, crash recovery;
- state-changing route token/origin checks;
- path permissions and atomic records/migrations;
- onboarding resume, broad-root warning, symlink/duplicate roots;
- no app launch or network during detection;
- optional integrations preview/rollback;
- autostart install/status/remove per OS in isolated fixtures;
- update success/failure/rollback and schema downgrade refusal;
- uninstall keeps source histories and asks separately about dashboard data;
- end-to-end acceptance from clean install to Overview in under five minutes on supported baseline machines.

## Must-not-change invariants

- local and private by default;
- explicit off switch and unambiguous service state;
- no admin/root requirement;
- no IDE launch requirement;
- no network or config modification hidden inside setup;
- connected/update/mutation permissions remain separate;
- source histories are read-only and never removed by uninstall;
- startup remains lightweight and the browser UI remains the primary interface.
