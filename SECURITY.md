# Security and privacy

AI Development Dashboard is local-first and binds its server to `127.0.0.1`. It does not upload code, conversations, credentials, session bodies, or telemetry.

If you find a path that can expose private data through a public export, generated share card, localhost endpoint, or committed file, please report it privately to the repository owner. Do not include real secrets or raw transcripts in an issue.

## Sensitive material never accepted in contributions

- API keys, access tokens, cookies, passwords, or environment values
- Cursor `cursorAuth` / JWT / cookie material
- raw Claude/Codex/Cursor transcripts or prompts
- generated `.dashboard-data/` records or snapshots
- private repository names, paths, project notes, and machine identifiers

The public sharing boundary is documented in [docs/SHARING-PRIVACY.md](docs/SHARING-PRIVACY.md).
