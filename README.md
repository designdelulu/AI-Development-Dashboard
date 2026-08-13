# AI Development Dashboard

A local-first, project-first dashboard for understanding what AI resources contributed to a codebase: Git projects, Claude/Codex/Cursor sessions, observable consumption, installed capabilities, and conservative maintenance signals.

## Start

Requires Node 20+ and Git.

```bash
npm run scan
npm start
```

Open `http://127.0.0.1:4177`. The server binds only to loopback. Press **Rescan** to rebuild its private derived index.

## What V1 supports

- Finds Git repositories below `~/Dropbox/Projects` as canonical projects.
- Reads observed metadata from `~/.claude/projects`, `~/.codex/sessions`, and `~/.cursor/projects` through isolated adapters.
- Attributes sessions to a project from recorded working directory, with visible confidence.
- Separates fresh input, output, cache-read and cache-creation token fields; it never labels their sum as subscription “tokens used.”
- Confirms capability use only from structured metadata and supports local-safe stack/manifest/private-inventory exports plus frozen share-card snapshots.
- Reuses unchanged session summaries using source size + modification-time checkpoints; large transcripts are read only as bounded metadata prefixes.
- Discovers skills and instructions across user/project Claude, Codex and Cursor locations as capability references.
- Calculates descriptive Git changes, commit counts and measured text-line counts.
- Presents Overview, Projects/detail, Capabilities/detail and Maintenance views; supports search and responsive layout.

## Truth model

**Measured** means direct filesystem/Git/transcript metadata. **Confirmed** session attribution uses a recorded working directory below a discovered Git root. **Strongly inferred** identifies Cursor project folders with an encoded project path. **Unknown** stays unknown.

The dashboard never shows subscription quota/percentage, subscription billing, or invented productivity/cost. Token values are observable usage fields, not subscription charges. LOC and Git churn are descriptive—not measures of developer value.

## Privacy

No network request is made by the scanner or server. The generated `.dashboard-data/index.json` is local and gitignored. It contains source references, file fingerprints and derived counters only; raw conversations, prompt content, credentials and source code are not copied. Existing configurations/repositories are read-only.

## Metrics and limitations

Reliable now: session count, available usage fields, model if exposed, tool-call/context signals if exposed, Git metadata, capability installation/configuration references, and session/project confidence. Context signals are observations of `compact`/summary events, not a universal compaction metric.

Not reliable yet: Cursor token usage in this local record format, completed-task attribution, accepted changes, rework/reverts, subscription quotas, capability-use proof, and cross-period efficiency comparison. The UI intentionally labels these gaps instead of manufacturing a score.

## Development

```bash
npm test
npm run scan
```

The tests use sanitized generated fixtures. See [environment audit](docs/ENVIRONMENT-AUDIT.md), [architecture](docs/ARCHITECTURE.md), [metrics](docs/METRICS.md), [sharing privacy](docs/SHARING-PRIVACY.md), [future benchmarks](docs/FUTURE-BENCHMARKS.md) and [reuse decisions](docs/REUSE-DECISIONS.md).
