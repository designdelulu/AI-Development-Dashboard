# Model economics and cost-aware roles

Research date: 2026-08-15. This is an evidence file for later routing recommendations. It is not a hidden proxy and not a hardcoded “cheap model always codes” rule.

## Dimensions

Keep these separate in records and UI:

| Dimension | Meaning | Example |
| --- | --- | --- |
| Agent | Product identity the operator talks to | Claude, Codex, Kimi, DeepSeek |
| Host | Harness or editor | Claude Code, Codex CLI, Cursor, Kimi Code, OpenCode, VS Code |
| Provider | Model vendor | Anthropic, OpenAI, Moonshot, DeepSeek, xAI |
| Model | Exact observed ID | `kimi-k3`, `deepseek-v4-flash` |
| Role | Task role only when recorded | Architecture, Implementation, QA, Audit |

VS Code is a host, not an agent. Historical VS Code AI usage stays unknown without a trustworthy transcript format.

## Frontier vs execution (current public mechanisms)

**Frontier work** (architecture, planning, critical judgment) currently points at high-capability models the operator already pays for or can call via official APIs: Claude Opus-class models in Claude Code, GPT-5.6-class models in Codex, Grok 4.6 where the Grok CLI is installed. Use the last observed capable agent unless a structured attention or capacity signal says otherwise.

**Execution labor** (implementation, QA, tests, repetitive refactors) can use official lower-cost coding APIs and CLIs. Do not scrape consumer subscriptions or disguise clients.

### Kimi / Moonshot (checked 2026-08-15)

- Flagship: `kimi-k3` (2.8T, 1M context, OpenAI- and Anthropic-compatible API at `https://api.moonshot.ai/v1` and `https://api.moonshot.ai/anthropic`)
- Coding-specific: `kimi-k2.7-code` and `kimi-k2.7-code-highspeed` (256k)
- Native host: [Kimi Code CLI](https://www.kimi.com/code)
- Official third-party: Claude Code can be pointed at Kimi’s Anthropic-compatible coding endpoint with a Kimi API key (`https://api.kimi.com/coding/` for membership keys, or Moonshot platform keys). That is a documented vendor integration, not a dashboard proxy.
- Local telemetry: only if the host writes session files this dashboard already knows how to parse. Kimi-through-Claude-Code should appear as Host `Claude Code`, Provider `Moonshot`, Model `kimi-k3` when the model ID is present.

### DeepSeek (checked 2026-08-15)

- Current API IDs: `deepseek-v4-flash` (DeepSeek-V4-Flash-0731) and `deepseek-v4-pro` (DeepSeek-V4-Pro-0813)
- OpenAI-compatible: `https://api.deepseek.com`
- Anthropic-compatible: `https://api.deepseek.com/anthropic`
- Flash is the cost-efficient coding/agent path; Pro is the heavier flagship. Flash also exposes a Responses API intended for Codex-compatible hosts.
- Official 2026 Flash list pricing (before the 16 Aug 2026 peak/off-peak change): cache-hit input $0.0028 / 1M, cache-miss $0.14 / 1M, output $0.28 / 1M. Do not present this as Claude/Cursor subscription savings.
- Local telemetry: none until a supported host writes normalized usage into a scanned session file.

## Routing philosophy

Three levels, kept separate:

1. **Recommendation** — “Use Kimi/DeepSeek for this implementation task.” Overview / Start Here may say this later from evidence, not from marketing.
2. **Handoff / launch** — prepare context and open a supported installed host.
3. **Automated orchestration** — an external harness assigns roles. The dashboard should observe that run, not become the inference proxy.

True API routing through this dashboard is out of scope until the operator supplies official keys and a dedicated, visible routing surface.

## Representation

A project can list workers without collapsing them into one agent name:

```text
PROJECT    AI Development Dashboard
RUN        Feature: Live Feed
ROLE              HOST            PROVIDER     MODEL
Architecture      Claude Code     Anthropic    Opus-class
Implementation    Kimi Code       Moonshot     kimi-k3
QA                OpenCode        DeepSeek     deepseek-v4-flash
Audit             Codex CLI       OpenAI       GPT-5.6-class
```

Role stays empty on historical sessions. Token and time attach to the session; cost estimates attach only when the record is API-billed.
