# Private remote and public-release checklist

## Private GitHub remote now

- [x] Confirm `git status` is clean before a pass (re-check after commits).
- [x] Confirm `.dashboard-data/`, `node_modules/`, logs, screenshots with private material, and OS metadata are ignored.
- [x] Inspect staged files for absolute paths, raw transcript text, credentials, tokens, and private project metadata.
- [x] Private GitHub remote exists (`designdelulu/AI-Development-Dashboard`).
- [x] Keep the in-app Source code footer link disabled while the remote is private (`repositoryPublic` defaults false).

## Before making the repository public

- [x] Review the entire reachable Git history, not only the latest tree, for generated local analytics or private information. 2026-08-15: 19 commits scanned; no `.env`, `.dashboard-data`, handoff files, API keys, or private-key material in tracked history. Owner absolute paths are not present in tracked JS/HTML/CSS/JSON. Remaining public blockers are a true fresh-clone machine run and the visibility switch — not history remediation.
- [ ] Re-run privacy tests and manually inspect Share Stack, Manifest, Setup Prompt, Private Backup warnings, and every Share Story slide.
- [x] Review screenshots and article images for private project names, prompts, notes, paths, credentials, and machine identifiers. Current README screenshot shows live telemetry without project names. Do not replace it with an owner-machine Overview that lists private projects.
- [x] Choose and add an explicit license (MIT, 2026-08-15).
- [x] Re-check README, architecture, metrics, source discovery, limitations, contributing, privacy, and security documentation.
- [ ] Confirm a fresh clone: `npm install` → `npm start` → configure project root → scan → dashboard. macOS needs Node 20+ and Git. Missing Claude/Codex/Cursor must degrade, not crash. Automated coverage exists for empty roots and missing Dropbox; a clean-machine run is still required before public.
- [x] Confirm no hardcoded owner project root is required (Dropbox is detected only if present).
- [x] Confirm footer Source code stays off until visibility is public, then set `repositoryPublic: true` in `.dashboard-data/settings.json`. No UI redesign required.
- [ ] Decide whether issue templates are useful for the intended contributor audience.
- [ ] Tag a reviewed release (for example `v0.2.0`), then change repository visibility intentionally.
- [ ] Enable the public Source code footer link only after visibility is public.
- [ ] Review the Design Delulu article wording so it does not imply public availability before that switch. Canonical article: `https://designdelulu.com/blog/ai-development-dashboard.html`.

## Never publish

Raw sessions, prompts, source code from observed projects, credentials, cookies, plan-account data, private paths, project notes, local exports, private capabilities, and generated local analytics.
