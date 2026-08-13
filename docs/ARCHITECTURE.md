# Architecture

`src/core.js` owns adapters and normalization. `src/cli.js` is the tiny local HTTP/scan boundary. `public/` is a dependency-free UI.

```text
filesystem/Git ─┐
Claude records ─┼─ adapters ─→ normalized JSON index ─→ localhost UI
Codex records ──┤                     ↑
Cursor records ─┤                     └─ source paths + compact metadata only
capability files ┘
```

## Canonical identity and confidence

Git root under the configured projects root is the canonical project identity. A session is **Confirmed** only when its recorded working directory resolves below that root. Cursor folders are matched from their encoded project path and are **Strongly inferred**; unmapped records remain Unknown/Weakly inferred rather than being silently assigned.

## Data retention

The index records file paths, file fingerprints, timestamps, compact counters and metadata. It does not copy SKILL.md/CLAUDE.md/AGENTS.md content, prompt bodies, code, tool output or raw transcripts. Delete `.dashboard-data/` to reset local derived analytics; originals remain untouched.

## Live refresh

The local server scans once at startup, watches the configured local source roots with a 7.5-second debounce, and performs a five-minute fallback incremental check. Session files retain their source fingerprint, so unchanged transcripts are reused rather than reparsed. The browser checks the normalized index every 15 seconds and redraws only after a new index timestamp. A mostly idle dashboard performs no repeated transcript parsing; a watcher event triggers an incremental scan. Git-derived project metrics are refreshed only with that scan.

## Interface rationale

The interface follows an **editorial operations desk** direction: a dark Design Delulu identity with information hierarchy carried primarily by typography, rhythm and a few pink anchors rather than a field of equal cards. Overview remains project-first; visual agent geometry is an internal, labeled system whose relative size maps to observed session share. Utility tasks live in narrow, toggleable drawers so users return to their current view naturally. Share begins with a meaningful public-safe result, then exposes optional controls.

## Capability hierarchy and ownership

Raw discovered files remain auditable as components. The normal interface groups only deterministic roots: plugin cache/marketplace identity, a shared skill directory, or an individual command. A parent capability aggregates components, usage, agents, known owned artifact paths, and maintenance state. Grouping never uses fuzzy display-name matching. Ownership is inventory-only in this release: future Disable/Update/Remove actions must enumerate known artifacts, show a preview, require confirmation, journal a reversible change where possible, and never infer deletion targets.

### Taxonomy, installation and maintenance

The user-facing registry classifies a parent capability by **type** (Skills, Tools, Integrations, Automations or Instructions) and orthogonal **scope** (Shared, User / Global, Custom or Project-specific). Instructions and native automatic behaviors are deliberately not presented as interchangeable with portable procedural skills. These labels derive from deterministic artifact location/type evidence; unknown categories remain conservative.

Artifact completeness and agent coverage are distinct. `Complete` is emitted only when a known simple structure is present (for example, a skill directory contains `SKILL.md`); `Broken` only when a known expected artifact is absent; otherwise the artifact state is `Unknown`. Agent coverage states are Installed, Not installed, Unsupported, or Compatibility unknown. This release only emits “Not installed” when reliable compatibility evidence exists, never merely because another agent lacks the item.

Maintenance aggregates reasons at the recognizable parent capability. It separates Needs Action (broken/partial/conflicting), Updates, Installation Coverage, and Usage Review. Usage absence is deliberately an optional review signal—not a defect or removal recommendation. Parent details carry a compact observed history (modified/used) distinct from maintenance.

### Local project working memory

Pins, status and note live in `.dashboard-data/project-metadata.json`, keyed by stable canonical project ID. The scanner never writes that store, and the scanner output never overwrites it. The HTTP boundary reapplies it after every scan/startup. Notes are private metadata: shareable stacks, manifests, snapshots and cards do not receive project notes or project names.

## Agents and editors

An agent/provider and its host are separate fields: e.g. Claude in Claude Code, Codex in Codex CLI, and Cursor in Cursor. VS Code is recorded as an editor host inventory only unless a future adapter finds a stable AI-session transcript format; ordinary editor state is never counted as AI activity.

Native agent behaviors are represented as `Automation` capabilities, distinct from procedural Skills and from Hooks/Integrations. The first native automation adapter reads Claude Code's user-level `autoCompactEnabled` and `autoCompactWindow` settings without modifying them. Its normalized record retains agent, trigger, behavior, implementation, scope, active state, portability and a safe setup recipe; it is intentionally not a general rule engine.

Live state has its own bounded transport. The scanner persists historical normalized data, while an in-memory resource sampler and 60-second agent-event ring are delivered through a cache-disabled `/api/live-state` endpoint. The browser polls that endpoint every two seconds. This keeps live UI updates independent of session-history rescans and provider authentication.

The browser derives a conservative live state and timing record without changing that transport. `public/agent-state.js` classifies the current normalized events; `public/signal-field.js` turns the same bounded evidence into deterministic display envelopes. The versioned local timing record stores only aggregate observed durations and a bounded transition list. It begins at first use, treats suspended gaps as unobserved, contains no prompts or transcript content, and is kept outside scanner output so rescans cannot overwrite it. The schema leaves project ID and handoff-cycle attribution as future additions rather than guessing them now.

## Future directions

Phase 2 adds normalized token categories, structured Claude `attributionSkill` events, rolling comparable efficiency components, and a centralized sharing/export boundary. `ShareSnapshot` records only selected public-safe values and metric definitions before rendering a card. A future `New Project` feature should create a folder/Git root plus agent instruction stubs only through documented agent integrations. Workflow continuation/routing should consume personal historical evidence and never attempt subscription pooling or unsupported authentication flows.

Future capability installation/import follows: audit target → compare current coverage and ownership → detect conflicts → preview exact artifacts/config changes → explicit approval → apply → validate → retain rollback information. It must use the same ownership boundary as future removal and never treat an inferred path as removable.
