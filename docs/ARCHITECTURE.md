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

The local server scans once at startup, watches the configured local source roots with a 1.8-second debounce, and performs a five-minute fallback incremental check. Session files retain their source fingerprint, so unchanged transcripts are reused rather than reparsed. The browser checks the normalized index every 15 seconds and redraws only after a new index timestamp. A mostly idle dashboard performs no repeated transcript parsing; a watcher event triggers an incremental scan. Git-derived project metrics are refreshed only with that scan.

## Capability hierarchy and ownership

Raw discovered files remain auditable as components. The normal interface groups only deterministic roots: plugin cache/marketplace identity, a shared skill directory, or an individual command. A parent capability aggregates components, usage, agents, known owned artifact paths, and maintenance state. Grouping never uses fuzzy display-name matching. Ownership is inventory-only in this release: future Disable/Update/Remove actions must enumerate known artifacts, show a preview, require confirmation, journal a reversible change where possible, and never infer deletion targets.

## Agents and editors

An agent/provider and its host are separate fields: e.g. Claude in Claude Code, Codex in Codex CLI, and Cursor in Cursor. VS Code is recorded as an editor host inventory only unless a future adapter finds a stable AI-session transcript format; ordinary editor state is never counted as AI activity.

## Future directions

Phase 2 adds normalized token categories, structured Claude `attributionSkill` events, rolling comparable efficiency components, and a centralized sharing/export boundary. `ShareSnapshot` records only selected public-safe values and metric definitions before rendering a card. A future `New Project` feature should create a folder/Git root plus agent instruction stubs only through documented agent integrations. Workflow continuation/routing should consume personal historical evidence and never attempt subscription pooling or unsupported authentication flows.
