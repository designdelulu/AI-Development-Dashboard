# Security and privacy

AI Development Dashboard is local-first and binds its server to `127.0.0.1`. Its Local Core does not upload code, conversations, credentials, session bodies, or telemetry. An explicitly enabled Connected Service may contact only its selected provider for the documented purpose.

The local service records an owned runtime instance only after binding. Stop/status verify its random local control token and instance identity rather than trusting a PID alone; browser state-changing requests also require same-origin access and an HttpOnly local session cookie. No remote integration is enabled by default.

OpenRouter Phase 2A accepts only a management credential supplied as `OPENROUTER_MANAGEMENT_KEY` to the local process. It persists only an opaque environment reference, allows only analytics metadata/query and credits endpoints, uses no inference endpoint or key-management endpoint, and sends no prompts, code, transcripts, or request IDs. Connecting enables the distinct connected-service network permission; it grants no installation, capability-write, or agent-configuration permission.

If you find a path that can expose private data through a public export, generated share card, localhost endpoint, or committed file, please report it privately to the repository owner. Do not include real secrets or raw transcripts in an issue.

## Sensitive material never accepted in contributions

- API keys, access tokens, cookies, passwords, or environment values
- Cursor `cursorAuth` / JWT / cookie material
- raw Claude/Codex/Cursor transcripts or prompts
- generated `.dashboard-data/` records or snapshots
- private repository names, paths, project notes, and machine identifiers

The public sharing boundary is documented in [docs/SHARING-PRIVACY.md](docs/SHARING-PRIVACY.md).
