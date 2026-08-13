# Private remote and public-release checklist

## Private GitHub remote now

- [ ] Confirm `git status` is clean.
- [ ] Confirm `.dashboard-data/`, `node_modules/`, logs, screenshots with private material, and OS metadata are ignored.
- [ ] Inspect staged files for absolute paths, raw transcript text, credentials, tokens, and private project metadata.
- [ ] Create the repository as **private** and push only the reviewed branch.
- [ ] Keep the in-app Source code footer link disabled while the remote is private.

## Before making the repository public

- [ ] Review the entire reachable Git history, not only the latest tree, for generated local analytics or private information.
- [ ] Re-run privacy tests and manually inspect Share Stack, Manifest, Setup Prompt, Private Backup warnings, and every Share Story slide.
- [ ] Review screenshots and article images for private project names, prompts, notes, paths, credentials, and machine identifiers.
- [ ] Choose and add an explicit license; no license is implied today.
- [ ] Re-check README, architecture, metrics, source discovery, limitations, contributing, and security documentation.
- [ ] Decide whether issue templates are useful for the intended contributor audience.
- [ ] Tag a reviewed release, then change repository visibility intentionally.
- [ ] Enable the public Source code footer link only after visibility is public.
- [ ] Review the Design Delulu article wording so it does not imply public availability before that switch.

## Never publish

Raw sessions, prompts, source code from observed projects, credentials, cookies, plan-account data, private paths, project notes, local exports, private capabilities, and generated local analytics.
