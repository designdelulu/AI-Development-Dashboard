# Security and privacy

AI Development Dashboard is local-first and binds its server to `127.0.0.1`. Its Local Core does not upload code, conversations, credentials, session bodies, or telemetry. An explicitly enabled Connected Service may contact only its selected provider for the documented purpose.

The local service records an owned runtime instance only after binding. Stop/status verify its random local control token and instance identity rather than trusting a PID alone; browser state-changing requests also require same-origin access and an HttpOnly local session cookie. No remote integration is enabled by default.

Maintenance Runtime & Resources keeps this boundary narrow: the Dashboard
Restart and Stop actions accept either the per-instance control token used by
the CLI or the same-origin HttpOnly browser session, then operate only on the
currently owned Dashboard instance. Agent runtimes are observe-only unless an
adapter declares verified lifecycle ownership. Resource and diagnostic
endpoints are read-only, bounded, local, and do not expose command lines,
environment values, credentials, prompts, source code, or terminal output.

OpenRouter Phase 2A accepts only a management credential supplied as `OPENROUTER_MANAGEMENT_KEY` to the local process. It persists only an opaque environment reference, allows only analytics metadata/query and credits endpoints, uses no inference endpoint or key-management endpoint, and sends no prompts, code, transcripts, or request IDs. Connecting enables the distinct connected-service network permission; it grants no installation, capability-write, or agent-configuration permission.

Cline is a separate local inference agent that may run inside Cursor or VS Code. The dashboard does not read Cline's OpenRouter/provider inference key, editor secret storage, provider settings, or message bodies. A Cursor-hosted Cline session may identify `Cline → Cursor → OpenRouter → provider → model` for local metadata, but account-level OpenRouter analytics is never assigned to Cline (or any other host) from timestamps alone. Any future correlation must use an explicit shared request identifier and a reviewed allowlist.

Antigravity Phase 2B is local-only. Its optional status-line bridge cannot change host settings until the user reviews the exact target file/fields and confirms. It backs up an existing status-line configuration, forwards an existing custom status line rather than replacing it, and has a deterministic restore action. A captured quota bucket is never assigned to each model in that bucket.

Appearance customization accepts only a normalized three- or six-digit hexadecimal accent value. It is stored locally, applied through CSS variables, cannot inject arbitrary CSS, makes no network request, and never changes semantic error, warning, or success colors.

Bug reporting is a separate explicit opt-in surface. The lower-left UI action and `ai-dashboard report-bug` create a local report bundle first; no automatic error upload, SMTP, GitHub authentication, or hidden endpoint exists. User-entered descriptions/context and selected screenshots remain user-controlled content and must be reviewed before sharing. Client-side screenshot MIME/size checks are convenience controls only; any future HTTPS receiver must revalidate MIME, size, JSON schema, rate limits, and abuse controls server-side. Diagnostics are allowlisted rather than assembled from raw logs, environment variables, settings, or transcripts. The bounded lifecycle event log stores sanitized stage/code/message metadata only and is local under `.dashboard-data/`.

If you find a path that can expose private data through a public export, generated share card, localhost endpoint, or committed file, please report it privately to the repository owner. Do not include real secrets or raw transcripts in an issue.

## Sensitive material never accepted in contributions

- API keys, access tokens, cookies, passwords, or environment values
- Cursor `cursorAuth` / JWT / cookie material
- raw Claude/Codex/Cursor transcripts or prompts
- generated `.dashboard-data/` records or snapshots
- private repository names, paths, project notes, and machine identifiers

The public sharing boundary is documented in [docs/SHARING-PRIVACY.md](docs/SHARING-PRIVACY.md).
