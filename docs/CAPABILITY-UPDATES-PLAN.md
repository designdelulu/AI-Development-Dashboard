# Capability Updates Plan

Research date: 2026-08-22. This plan extends the current read-only capability inventory without weakening its default. No update, install, configuration edit, or network check was performed during planning.

## Decision

Capability maintenance is a three-permission system:

1. **Observe only** — default; local read-only discovery, provenance, version evidence, and modification status where a trustworthy baseline exists.
2. **Check for updates** — explicit network permission; query only known upstream/package-manager metadata and record the result.
3. **Allow capability modifications** — separate explicit permission; every operation still requires a per-action preview and confirmation.

The dashboard delegates changes to the capability's native installer/updater whenever possible. It does not become another package manager, silently synchronize artifacts, or infer that every `SKILL.md` has the same lifecycle.

## Current-state finding

`src/core.js` already inventories capability components and groups deterministic roots. The normalized records carry type, scope, host coverage, completeness, usage, and maintenance concepts, but update status is intentionally unknown and source/version ownership is incomplete. This is the right safety posture; the next phase should add provenance before adding buttons.

The machine audit found Caveman through Claude's marketplace checkout/cache. Its plugin manifests did not expose a semantic version, while the checkout and cache did expose a Git commit identity. A nearby package manifest reported `0.1.0`, but that version belongs to an installer package, not necessarily the Caveman product. This demonstrates why path proximity and timestamps cannot establish a capability version.

## Source-aware registry

Extend the recognizable parent capability with an optional `provenance` object. Unknown data remains absent or explicitly unknown.

```text
CapabilityProvenance
  sourceKind: claude-marketplace | claude-plugin | skills-cli | gemini-extension |
              npm | git | mcp-config | local | unknown
  sourceRepository?: canonical URL
  sourcePackage?: { ecosystem, name, registry? }
  sourceEntry?: marketplace/extension identifier
  installedVersion?: { value, authority, observedAt }
  installedCommit?: { sha, repository }
  installedArtifactHash?: { algorithm, value, coverage }
  baselineArtifactHash?: { algorithm, value, recordedAt, coverage }
  latestVersion?: { value, authority, publishedAt? }
  latestCommit?: { sha, repository }
  updateMethod?: { kind, previewTemplate, supportsDryRun, scope }
  modificationState: clean | modified | unknown | not-applicable
  updateState: current | available | ahead | source-missing | unknown | error
  lastCheckedAt?: timestamp
  license?: { expression, source, component }
```

`installedVersion.authority` is required. Examples: `plugin-manifest`, `marketplace-manifest`, `git-commit`, `npm-lock`, or `skills-cli-state`. A display may prefer `2.2.0`, but Explain must reveal the authority.

### Version precedence

Use host-native precedence, not one universal rule:

- Claude plugin: plugin manifest version, then marketplace entry version, then Git commit SHA, otherwise unknown. Claude's own reference documents that precedence and native `claude plugin update`. [Claude plugin reference](https://code.claude.com/docs/en/plugins-reference)
- npm tool: installed package manager metadata and lock/inventory, not a neighboring package.
- Git install: exact commit SHA; a tag is shown only if that commit is unambiguously tagged.
- Skills CLI install: its own recorded source/inventory and update/check result where available.
- Gemini extension: extension metadata/update type and the native Gemini extension command.
- local/manual artifact: no fabricated version. Record a content hash as current observation; modification status remains unknown until the dashboard has an install-time baseline or explicit upstream match.

mtime is never a version and never proves a local modification.

## Discovery before update checks

The Observe-only pass should identify:

- parent capability and its exact component paths;
- hosts/scopes that own or reference each component;
- manifest/package/Git evidence already on disk;
- the native manager and source identity, if deterministic;
- content hash over a bounded allowlist of capability artifacts;
- conflicts: two managers claiming the same destination, a broken symlink, or overlapping files;
- whether a trustworthy baseline exists.

Do not follow arbitrary symlinks outside the declared artifact root. Do not read secret-bearing host config values; parse only the fields required to establish plugin/extension/source identity.

## Update-check workflow

1. User enables **Check for updates** globally or for one source.
2. UI previews domains, package registries, and metadata that will be requested.
3. Checker invokes the native read-only check where it has one; otherwise it queries the canonical repository/package registry through an allowlisted client.
4. Result records latest authority, timestamp, compatibility information, and failure code.
5. UI says Current, Update available, Ahead of upstream, Source unavailable, Check failed, or Unknown.
6. Network permission can be revoked without affecting local inventory.

Checks use caching, conditional requests where supported, bounded concurrency, and backoff. They send no project names, capability contents, host credentials, or usage history. Generic repository URLs must pass scheme/host validation; local Git remotes with embedded credentials are redacted and not requested.

## Review and update workflow

Every mutation follows one transaction-like journal:

1. re-scan and lock the exact target ownership set;
2. compare current hashes to the baseline;
3. show installed/latest authority, changelog/source link, licenses, affected hosts/scopes, and conflicts;
4. show exact command and file/config effects that the native manager is expected to make;
5. run native dry-run when supported, or explicitly say Dry run unavailable;
6. require confirmation for this capability and scope;
7. save a journal with pre-state metadata and bounded backups of dashboard-owned edits only;
8. run the native updater with redacted output and timeout;
9. re-scan ownership, version, integrity, and host coverage;
10. report success/partial/failure and offer the safest available rollback.

No “Update all” exists in the first release. No scheduled mutation exists. A locally modified or ownership-conflicted target blocks one-click update until the user reviews a diff/manager-specific alternative.

## Native updater matrix

| Capability source | Observe/version source | Check | Update | Dry run / rollback stance |
| --- | --- | --- | --- | --- |
| Claude plugin | `claude plugin list --json`, plugin/marketplace manifest, Git SHA | marketplace metadata/native list refresh | `claude plugin update <plugin>` | Preview command; preserve manager cache; reinstall exact prior ref only if Claude supports it |
| Claude marketplace | local marketplace manifest/Git ref | native marketplace update or fetch metadata | native marketplace update, then plugin update | Never edit cache directly. [Marketplace docs](https://code.claude.com/docs/en/discover-plugins) |
| Claude/Codex/Cursor skill installed by Skills CLI | Skills CLI source state + artifact hash | `npx skills check` where supported | `npx skills update [skill]` | Preview scopes/targets; manager behavior governs backup. [Skills CLI](https://github.com/vercel-labs/skills/blob/main/README.md) |
| Manually copied skill | content hash; source only if explicitly recorded | canonical source comparison | no automatic update initially | Export diff and instructions; never overwrite |
| Gemini extension | extension metadata and install type | native extension list/update metadata | native `gemini extensions update` path appropriate to install type | Local extensions may not be remotely updatable; preserve type semantics. [Gemini extension reference](https://geminicli.com/docs/extensions/reference/) |
| npm capability tool | installed package metadata/lock | `npm outdated` equivalent scoped to exact package or registry metadata | native npm update/install of exact package/scope | Package scripts are code execution; show that risk and command before consent |
| Git-installed capability | repository + exact commit + clean-state check | remote refs/tags after opt-in | fast-forward or documented installer; never arbitrary reset | Block if dirty; tag/commit pin enables manual rollback |
| MCP server | manager/package metadata plus host config reference | source-specific | update package only; do not rewrite server config unless required and previewed | Never expose env/secret values; validate server health afterward |
| Local/custom | bounded hash only | none unless user supplies canonical source | no one-click update | Unknown is the truthful state |

Native CLIs are not automatically “safe”: an update may run package lifecycle scripts or edit several hosts. The preview must name that consequence.

## Local modifications

Modification status requires a baseline:

- **Clean:** current bounded artifact hash equals the install-time or exact-upstream baseline.
- **Modified:** it differs from that baseline.
- **Unknown:** no trustworthy baseline exists or the manager's generated files are not stable.
- **Not applicable:** remote-only capability or versioned immutable cache.

When Modified:

- show the changed file list, not secret/config contents by default;
- offer export of a local patch when text-safe;
- block automatic overwrite;
- allow a manager-supported merge/reinstall only after a second explicit decision;
- never infer that modification is damage.

Record a new baseline only after verified install/update or an explicit “adopt current state” action.

## Rollback model

Rollback is capability-specific and never promised universally:

- package/plugin manager: reinstall exact prior version/ref if supported;
- Git: return to recorded commit only if worktree was clean and native workflow supports it;
- dashboard-owned host integration snippet: restore the exact pre-edit settings fragment from the journal;
- manually copied files: restore only from a backup created immediately before the approved change;
- multi-host installer: rely on its documented rollback/uninstall, otherwise provide recovery instructions.

The journal stores no secrets and has bounded retention. A failed rollback is reported as failed; it is not hidden behind “restored.”

## Caveman case study

Current upstream Caveman documents multiple products and install paths rather than one generic file. [Caveman repository](https://github.com/JuliusBrussee/caveman)

### Current source facts

- The README's current installer examples pin `v2.2.0` at the research date. Treat that as the advertised installer release, not proof of every installed component's version.
- Claude uses a native marketplace/plugin installation.
- Gemini uses its native extension mechanism.
- Codex, Cursor, and other supported hosts may use the Skills CLI path.
- The unified installer advertises safe re-run and `--dry-run`, but it can affect multiple hosts and therefore still needs target preview and confirmation.
- The skill/adoption/CLI portions are MIT; the engine/proxy/runtime portion is BSL-1.1 with a later conversion. The dashboard must not vendor the BSL engine into this MIT repository.
- Caveman's current documentation says the CLI sends anonymous command/token-count telemetry by default and provides `caveman telemetry off` / Do Not Track controls. An older locally cached installation document said no telemetry, demonstrating why the Maintenance screen must cite the exact installed/upstream source and never reuse stale privacy copy.

### Dashboard presentation

Group Caveman as one recognizable capability with per-host components:

```text
Caveman
  Claude plugin       Installed commit <short-sha>   Update via Claude
  Gemini extension    Not detected                   Install path available
  Codex skill         Installed version/source ...   Update via Skills CLI
  Caveman CLI/runtime Installed ...                  Update via its installer/npm
  Engine component    Not detected / license BSL-1.1
```

If Claude manifests lack a semantic version, display “Installed commit abc1234,” not the unrelated `0.1.0` installer-package version. The updater chooses per component. The unified installer is offered only when the user deliberately wants multi-host reconciliation; first show its dry-run and the hosts/configuration it will touch.

Caveman's `learn`, `stats`, and `trial` concepts can later supply controlled-experiment evidence, but marketing benchmark results or inferred historical adoption are not proof that it improved this user's work.

## Security and privacy changes required before implementation

Update `README.md`, `docs/SHARING-PRIVACY.md`, `SECURITY.md` if present/created, and `CONTRIBUTING.md` before enabling network checks or mutation. State plainly:

- local observation remains network-free by default;
- update checks contact named external sources only after opt-in;
- update execution changes external tool configuration and may execute third-party installer code;
- credentials and capability contents are not uploaded by the dashboard;
- command/output logs are redacted and local;
- users can revoke each permission independently;
- mutation audit journals and backups have explicit locations/retention;
- the dashboard does not endorse third-party licenses or security.

Connected telemetry permission must remain separate from update-check network permission. Enabling OpenRouter does not authorize GitHub/npm checks; enabling checks does not authorize updates.

## Implementation modules

Recommended new modules:

- `src/capabilities/registry.js` — grouping plus provenance schema;
- `src/capabilities/provenance.js` — version authority and bounded hashes;
- `src/capabilities/checkers/` — source-specific read-only update checks;
- `src/capabilities/updaters/` — native command builders and validators, added only after review;
- `src/capabilities/journal.js` — pre/post state and rollback metadata;
- `src/permissions.js` — independent permission states;
- `src/redaction.js` — centralized command/error/log redaction;
- `public/maintenance-ui.js` — discovery and review first; mutation later.

Do not put command templates or source-specific precedence back into `src/core.js`.

## Tests and acceptance

- fixture tests for each version authority and conflicting metadata;
- no version inferred from mtime or adjacent package metadata;
- hash coverage is deterministic and rejects symlink escapes/oversized files;
- no network under Observe only;
- every checker has an endpoint/domain/method allowlist and redaction tests;
- modified/unknown/conflicted artifacts cannot reach execution;
- command preview exactly matches the approved command;
- secrets in env/config/CLI output never enter logs/journals/UI;
- timeout, partial manager change, verification failure, and rollback failure are first-class states;
- browser acceptance covers Current, Available, Unknown, Modified, Conflict, Check disabled, Check failed, Dry run unavailable, and Partial update;
- Caveman fixture proves Git SHA wins over an unrelated package version and preserves component-level licenses.

## Frontier review checkpoints

Require high-reasoning/security review before merging:

- permission and command-execution boundary;
- provenance/version precedence and symlink/hash behavior;
- redaction and journal contents;
- rollback claims;
- first native updater of each manager class;
- Caveman multi-host dry-run/update behavior;
- privacy/security documentation change.
