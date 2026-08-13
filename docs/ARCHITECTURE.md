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

Adapters can add task classification, explicit capability-use evidence and historical comparisons without changing the project identity model. A future `New Project` feature should create a folder/Git root plus agent instruction stubs only through documented agent integrations. Workflow continuation/routing should consume personal historical evidence and never attempt subscription pooling or unsupported authentication flows.
