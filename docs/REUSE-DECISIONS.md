# Reuse decisions

Audit date: 2026-08-13. This document separates design research from copied code.

## Decision summary

This V1 independently implements a deliberately smaller, project-first local index. It does **not** embed, invoke, or require another telemetry product. It reads only the local source formats observed on this machine, keeps raw files in place, and stores derived metadata in `.dashboard-data/index.json` (gitignored).

| Project | What it offers | Decision |
| --- | --- | --- |
| [CodeBurn](https://github.com/getagentseal/codeburn) | MIT-licensed local-first token/session parser for ~40 tools, project/task attribution, context and Git-yield heuristics. Active and substantially broader than V1. | Studied as the strongest parser/analytics reference. Not bundled because its Node requirement is newer than the local Node 20, it targets a broader cost/waste product, and importing a fast-moving full CLI would make this project depend on an overlapping telemetry system. Its public data-source/adaptor approach informed the adapter boundaries. Future: evaluate extracting a narrow MIT parser with pinned revision and attribution tests. |
| [AIUsage](https://github.com/juliantanx/aiusage) | Local parser/cache/database plus CLI/web/widget; supports Claude Code, Codex and other agents; optional sync is separate. | Not reused. It is closest in scope for usage aggregation, but the V1 needs a project/capability registry rather than another usage dashboard/cache. Its local-first and normalized-schema separation informed this design. |
| [Skiller](https://github.com/beautyfree/skiller) | Desktop skills manager for Claude Code, Cursor, Codex and more; installation/sync/management. | Not reused. The dashboard observes capability inventory and health but must not modify or synchronize existing skills. Skiller is a complementary future integration candidate. |
| [Tokscale](https://github.com/junhoyeo/tokscale) | Terminal token tracker and public leaderboard/sync-oriented product. | Not reused. V1 intentionally avoids network accounts/leaderboards and focuses on local projects/capabilities. It remains a useful source-format comparison during future adapter work. |

## Licensing and privacy

No code, bundled asset, parser, database, or license-controlled content from the above projects is included in this repository. Their README/documentation claims were used for evaluation only. A future reuse must pin the upstream commit, preserve its license/notice, assess transitive dependencies, and add source-format fixtures.

The evaluated projects highlight a key distinction retained here: API-equivalent estimates and subscription usage are not the same thing. This dashboard does not calculate subscription cost or quota utilization.

## Alternatives noticed

CodeBurn is the current broadest direct alternative found. It may be the right standalone choice for a user who primarily needs usage/cost/waste analysis. This project exists because the target question is wider: canonical projects linked to agents, sessions, capability inventory and conservative maintenance evidence.
