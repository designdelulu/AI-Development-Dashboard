# Orchestration foundation

Decision date: 2026-08-15.

## Sidebar

Do **not** add an Orchestrate / Agent Team mode to the normal operator dashboard in this pass. Overview remains “pick up where you left off.” Live Feed remains ambient telemetry.

A future mode, if built, should be a separate navigation item with a name like **Agent Team**. Suggested flow: Project → Task → Plan → Roles → Handoff / Review. Frontier models for architecture/audit; efficient coding models for implementation/QA — as recommendations, not a hidden proxy.

## Schema (implemented)

Normalized records can already represent:

```text
Project → Harness run → Worker agent → Provider → Model → Role → Session → Consumption → Outcome
```

- Sessions carry `agent`, `host`, `provider`, `model`, `role` (role is null unless recorded), and `harness` (`standalone` today).
- `harnessRuns` is present on the index and empty until an adapter or the operator records a run.
- VS Code remains an editor host inventory, not an AI agent.

This is enough for a later OpenCode / Kimi Code / custom-harness adapter to attach workers without rewriting Overview.

## What is not implemented

- Orchestrator UI
- Mailboxes, blackboard, worktrees, circuit breaker, scheduled missions
- Inference proxy or BYOK request forwarding
- Automatic role labels on old transcripts
