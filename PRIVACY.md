# Privacy

AI Development Dashboard is a local-first product. The scanner and localhost server do not make network requests. They read supported local metadata and write derived analytics only under `.dashboard-data/`, which is gitignored.

## What is stored locally

- source file paths and fingerprints
- timestamps, compact counters, Git snapshot metadata
- normalized token category totals when a local record exposes them
- project pins, statuses, and private notes in `project-metadata.json`
- frozen public-safe share snapshots when you export a recap

## What is never copied

- prompt bodies, transcript text, tool arguments
- credentials, cookies, API keys, environment values
- source code from observed projects
- Claude/Cursor subscription account data

## Sharing

Share Stack, Manifest, Setup Prompt, and Share Story cards use an allowlisted public-safe snapshot. They exclude project names, notes, paths, prompts, credentials, and private capabilities. See [docs/SHARING-PRIVACY.md](docs/SHARING-PRIVACY.md).

## Public GitHub

The repository is private until an explicit visibility change. The in-app Source code footer link stays off until `repositoryPublic` is enabled in `.dashboard-data/settings.json` after that change. A public release still requires the history audit in [docs/RELEASE-CHECKLIST.md](docs/RELEASE-CHECKLIST.md).
