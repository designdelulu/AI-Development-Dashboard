# Environment audit — 2026-08-13

Read-only audit scope: `~/Dropbox/Projects`, `~/.claude`, `~/.codex`, `~/.cursor`, and the local Cursor/Claude application-support directories. No existing configuration or repository was changed.

## Detected agent data sources

| Agent | V1 source | What was observed | V1 treatment |
| --- | --- | --- | --- |
| Claude Code | `~/.claude/projects` | Project-encoded folders, JSONL sessions, subagent/session folders, user settings/plugins/scheduled tasks | Parse bounded JSONL metadata; use recorded `cwd` as canonical attribution evidence. |
| Codex | `~/.codex/sessions`, `~/.codex/session_index.jsonl`, `~/.codex` skills/plugins/config | Dated JSONL rollouts and a session index; system and user capability locations | Parse bounded JSONL metadata; project identity comes from session metadata working directory when present. |
| Cursor | `~/.cursor/projects`, `~/.cursor/skills-cursor`, `~/.cursor/agents`, `~/.cursor/plugins`; application support had VS Code-style workspace/IndexedDB storage | Encoded project folders, agent-transcript folders, plans, skills and extensions | Treat transcript presence as a session. Project folder matching is Strongly inferred. No token counter is shown unless a stable local field is identified. |

## Project landscape

The configured root contains a mix of standalone Git repositories, nested repositories, non-Git containers, tools, archives, private-labelled folders, research/knowledge vaults and design/agency groupings. The initial registry found 15 Git roots. Examples of nested/reality-based organization include `ericbarker-co` with nested labs, and `Design Delulu Labs` with separate private/public projects.

## Normalization implications

- A folder name is insufficient as identity. Git root plus canonical absolute path is the dashboard identity.
- Claude's project-folder slug is an encoded path and often represents parent containers as well as individual repositories.
- Cursor has encoded project paths, `empty-window`/temporary entries, and separate plan/history-style artifacts; those are not assumed to be usage sessions.
- Project instructions are inconsistent by design: root/project `CLAUDE.md`, individual `AGENTS.md`, `.claude` folders, `.agents/skills`, and Cursor `.cursor/rules` coexist. The capability registry classifies them but never consolidates or changes them.
- User-level Claude, Codex and Cursor skills/plugins are intentionally separate from project-local capability references. “Installed/configured” is not treated as “used.”

## CLI availability

Node 20.19.5, npm, Git, SQLite CLI, Claude, Codex and Cursor CLIs were present. The dashboard has no runtime dependency beyond Node/Git and does not require global installation or database server.
