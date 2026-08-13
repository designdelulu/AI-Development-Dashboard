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

## Future directions

Phase 2 adds normalized token categories, structured Claude `attributionSkill` events, rolling comparable efficiency components, and a centralized sharing/export boundary. `ShareSnapshot` records only selected public-safe values and metric definitions before rendering a card. A future `New Project` feature should create a folder/Git root plus agent instruction stubs only through documented agent integrations. Workflow continuation/routing should consume personal historical evidence and never attempt subscription pooling or unsupported authentication flows.
