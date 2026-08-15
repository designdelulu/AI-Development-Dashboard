# Munder Difflin comparison

Audit date: 2026-08-15. Source: the current public repository [chaitanyagiri/munder-difflin](https://github.com/chaitanyagiri/munder-difflin) (README, HIVE.md, SPEC.md, LICENSE, v0.4.3 status). No Munder code is copied into this dashboard.

## Product shapes

| | AI Development Dashboard | Munder Difflin |
| --- | --- | --- |
| Job | Project-first operating and analytics layer | Local-first multi-agent execution / orchestration harness |
| User question | What did it take to build this project, and where do I continue? | How do I run a coordinated office of terminal agents on this machine? |
| Runtime | Reads local records; opens an installed agent | Spawns/wraps real CLIs in `node-pty` and coordinates them |
| UI | Dark Design Delulu editorial operations desk | Pixel-art office floor (Animal Crossing × *The Office* parody) |

Munder wraps Claude Code, Antigravity, Codex, Grok, Kimi Code, Qwen, OpenCode, Crush, pi.dev, and GitHub Copilot CLI, plus BYOK and local LLMs. It adds a GOD orchestrator (Michael), mailboxes, shared memory, a blackboard, a task ledger, live terminals, and visual coordination. Code is MIT; bundled LimeZu pixel art is non-commercial.

This dashboard indexes Git projects, Claude/Codex/Cursor session metadata, capabilities, conservative live state, and privacy-safe recaps. It does not spawn a hive of workers.

## Overlap

| Concern | Dashboard | Munder | Notes |
| --- | --- | --- | --- |
| Multi-agent support | Observe/resume across agents | Execute and coordinate them | Complementary |
| Model/provider support | Normalized identity from local records | Engine roster + BYOK | Dashboard should remain provider-neutral in records, not clone engines |
| Project resume | Primary job | Session cwd / spawn, not a project operating desk | Keep ours |
| Project handoff | Metadata-only markdown | Mailboxes / task specs between agents | Different artifacts |
| Memory | Private project notes | Per-agent `memory.md` + semantic palace | Do not clone |
| Orchestration | Schema only in this pass | Core product | Prefer reuse |
| Routing | Recommendation + launch | GOD assigns work | Keep three levels: recommend / handoff / orchestrate |
| Role assignment | Optional field; never invented | Roster + task ledger | Record when evidence exists |
| Agent messaging | No | Atomic inbox/outbox | Do not clone |
| Task dependencies | No | Kanban + `tasks.json` | Future adapter, not a clone |
| Worktrees | No | Optional per-agent worktrees | Munder is better |
| Approvals | No capability mutation | Spend / destructive / scope gates | Useful idea if we ever orchestrate |
| Budget / circuit breaker | Codex remaining % only | Per-agent budgets + steer/constrain/stop | Do not fake Claude/Cursor quotas |
| Token telemetry | Honest local categories | Transcript cost + OTel | Keep ours; later adapter could ingest Munder ledger |
| Cost telemetry | Not subscription billing | Real cost from transcripts | Only where API billing is known |
| Capability management | Inventory, not installer | Skills/MCP toggles over settings.json | Keep Skiller as installer |
| Operator UI | Overview resume desk | Command Center + floor | Distinct |
| Git integration | Snapshot + handoff | Brokered fs/git + worktrees | Complementary |
| Schedules | No | Scheduled missions + heartbeat | Optional later |
| Notifications | Optional Needs You | Slack / webhooks / remote control | Keep local-first |
| Safety | Read-only observation | Circuit breaker + HITL | Do not copy execution safety into an observer |
| Local-first / privacy | No network; gitignored index | Local hive git repo; official builds have opt-out telemetry | Dashboard should stay stricter |
| Public release / licensing | License undecided; private repo | MIT code + non-commercial art | Do not vendor Munder assets |

## What Munder does better

- Actually running several terminal agents as one team
- Mailboxes, blackboard, task ledger, and a supervisor loop
- Per-agent worktrees, budgets, circuit breaker, live PTY
- Broad official CLI coverage including Kimi Code and OpenCode
- Visual “what is each worker doing” while work is in flight

## What this dashboard does better

- Project as the canonical identity, not a session pane
- Conservative attribution and honest token language
- Capability registry and maintenance without mutating agent config
- Resume / Needs You / Start Here / handoff for a human operator
- Privacy-safe recap export
- Live local telemetry that does not require wrapping the CLI

## Useful ideas we should not clone as a product

Do not rebuild the office floor, GOD agent, mailboxes, pixel-art cast, Slack-spawned workers, or auto-install of missing CLIs. Those are Munder’s job. Cloning them would create a worse harness and a confused dashboard.

Ideas worth remembering:

- Keep orchestration as a **separate mode**, never mixed into Overview
- Record harness runs as Project → Harness run → Worker → Provider → Model → Role → Session
- If Munder is present later, **adapt** its hive `log.jsonl` / `tasks.json` rather than reimplementing them
- Human gates and circuit-breaking belong to execution, not to observation

## Integration decision (this pass)

**D, with an adapter-shaped schema: no orchestration UI yet.**

- **A. Integration** — later, optional “Open in Munder Difflin” if the binary exists
- **B. Adapter** — preferred path for telemetry reuse; do not copy code
- **C. Inspired lightweight mode** — only if a tiny recommend → role → handoff flow is still missing after adapters
- **D. No engine now** — chosen, because Munder already does execution better

License implication: MIT source may be studied and later wrapped; LimeZu assets must not be copied. Any future adapter must pin a revision, preserve MIT notices, and ingest files Munder already writes rather than vendoring the Electron app.
