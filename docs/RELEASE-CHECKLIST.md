# Public-release checklist

This checklist records the release boundary for the public GitHub repository. It is not a promise that every adapter or planned feature is implemented.

## Publication gate

- [x] `master` is the release branch and the working tree is clean before release edits.
- [x] `.dashboard-data/`, `node_modules/`, logs, local reports, and OS metadata are ignored.
- [x] Reachable branches and history were reviewed for generated analytics, raw sessions, credentials, private keys, and owner paths.
- [x] README screenshots were manually reviewed; the real project names shown in the existing images were explicitly approved for publication. No prompts, notes, credentials, or machine paths are shown.
- [x] MIT `LICENSE` is present.
- [x] Privacy, security, telemetry, architecture, metrics, contributing, and support documentation describe implemented behavior.
- [x] Fresh-clone setup is documented with the public repository URL.
- [x] Bug reporting is opt-in, local by default, and has public issue templates without automatic uploads.
- [ ] Run the final fresh public clone after the visibility switch.
- [ ] Verify the public source link in the running dashboard after enabling the local release setting.

## Never publish

Raw sessions, prompts, source code from observed projects, credentials, cookies, plan-account data, private paths, project notes, local exports, private capabilities, and generated local analytics.

## Release notes

The current public beta includes project-first resume context, registry-driven live activity for supported runtimes, adaptive token visualization, OpenRouter account analytics, Cursor-hosted Cline evidence where exposed, Runtime & Resources diagnostics, privacy-safe local bug bundles, and local accent customization. Unsupported telemetry remains unavailable rather than inferred.
