# Environment audit — 2026-08-13

Read-only audit scope: `~/Dropbox/Projects`, `~/.claude`, `~/.codex`, `~/.cursor`, and the local Cursor/Claude application-support directories. No existing configuration or repository was changed.

## Detected agent data sources

| Agent | V1 source | What was observed | V1 treatment |
| --- | --- | --- | --- |
| Claude Code | `~/.claude/projects` | Project-encoded folders, JSONL sessions, subagent/session folders, user settings/plugins/scheduled tasks | Parse bounded JSONL metadata. Select the most-specific discovered Git root found in recorded `cwd`; use deterministic encoded folder mapping only when cwd is unavailable. |
| Codex | `~/.codex/sessions`, `~/.codex/session_index.jsonl`, `~/.codex` skills/plugins/config | Dated JSONL rollouts and a session index; system and user capability locations | Parse bounded JSONL metadata; project identity comes from session metadata working directory when present. |
| Cursor | `~/.cursor/projects`, `~/.cursor/skills-cursor`, `~/.cursor/agents`, `~/.cursor/plugins`; application support had VS Code-style workspace/IndexedDB storage | Encoded project folders, agent-transcript folders, plans, skills and extensions | Treat transcript presence as a session. Project folder matching is Strongly inferred. No token counter is shown unless a stable local field is identified. |

## Project landscape

The configured root contains a mix of standalone Git repositories, nested repositories, non-Git containers, tools, archives, private-labelled folders, research/knowledge vaults and design/agency groupings. The initial registry found 15 Git roots. Examples of nested/reality-based organization include `ericbarker-co` with nested labs, and `Design Delulu Labs` with separate private/public projects.

## Normalization implications

- A folder name is insufficient as identity. Git root plus canonical absolute path is the dashboard identity.
- Claude's records expose `cwd`, `gitBranch`, `compactMetadata` and structured `attributionSkill` fields. The scanner does not read prompt text: it selects the deepest Git root in observed cwd values and turns only `attributionSkill` into compact confirmed capability-use events.
- Cursor has encoded project paths, `empty-window`/temporary entries, and separate plan/history-style artifacts; those are not assumed to be usage sessions.
- Project instructions are inconsistent by design: root/project `CLAUDE.md`, individual `AGENTS.md`, `.claude` folders, `.agents/skills`, and Cursor `.cursor/rules` coexist. The capability registry classifies them but never consolidates or changes them.
- User-level Claude, Codex and Cursor skills/plugins are intentionally separate from project-local capability references. “Installed/configured” is not treated as “used.”

## CLI availability

Node 20.19.5, npm, Git, SQLite CLI, Claude, Codex and Cursor CLIs were present. The dashboard has no runtime dependency beyond Node/Git and does not require global installation or database server.

## VS Code historical AI data

VS Code is installed. Safe inventory found installed AI-related extensions including Claude Code, OpenAI ChatGPT and Continue, plus VS Code global/workspace SQLite state. A second bounded extension-specific inspection found no versioned, privacy-safe session/log format with reliable agent, timestamp and workspace attribution. Opaque extension storage and ordinary editing history are not parsed. **Historical VS Code AI usage unavailable.** Consequently VS Code is represented as an editor host with detected AI extensions, not as an AI agent and not as historical AI activity. Future adapters should ingest only structured, versioned extension telemetry with explicit agent, timestamp and workspace evidence.

## Design-skill audit — 2026-08-13

The project-local Impeccable installation at `Design-Delulu/.claude/skills/impeccable/SKILL.md` is portable Markdown Agent Skill material and was read-only design-review input for the dashboard refinement. It informed an `Operate`-mode direction: compact hierarchy, precise controls, visual feedback tied to real measurements, and bounded desktop/mobile validation. No Impeccable source was changed.

A bounded read-only search of user/project Claude, Codex, Cursor and shared Agent Skills locations found no installed portable Taste/Taste Skill source suitable for Codex consumption. The auditable outcome is **installation failed / no valid installed skill found** rather than a discovery-grouping defect. No duplicate installation was created. The dashboard design rationale therefore uses Impeccable guidance plus the existing Design Delulu system, not invented Taste instructions.
