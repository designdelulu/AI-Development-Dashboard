# Contributing

Thank you for considering a contribution. AI Development Dashboard is an early public local-first beta. Small, evidence-driven changes are welcome.

## Ground rules

- Do not add raw agent transcripts, prompts, credentials, cookies, provider tokens, absolute private paths, or generated `.dashboard-data/` files.
- Keep agent adapters conservative: unknown data stays unknown.
- Keep agent, host, provider, model, and account/capacity source as separate fields. Do not collapse a hosted model into the host’s brand.
- Keep analytics and sharing separate. Public-safe snapshots may only use explicitly allowlisted aggregate fields.
- Add deterministic sanitized fixtures for parser, attribution, privacy, or metric changes.
- Do not alter external agent configuration as part of dashboard behavior.
- Use the shared accent variables for user-personalizable highlights; do not add a hardcoded Design Delulu pink where the selected accent should apply. Keep semantic success, warning, and error colors independent from the accent.
- Keep lifecycle/reporting diagnostics allowlisted. Never add raw log, environment, transcript, prompt, source-code, credential, or private-path content to a bug bundle or new endpoint.
- Keep Local Core offline. Connected-service network access must remain explicit, narrowly scoped, and separately permissioned.

## Local workflow

```bash
npm test
npm run scan
npm start
```

Before opening a future pull request, run the tests, inspect `git diff --check`, and verify the dashboard with missing-data states as well as real local data.

## Pull requests

Describe the user-facing behavior, evidence boundary, and tests in the pull request. Include a synthetic fixture for parser or telemetry changes. Do not attach real `.dashboard-data`, screenshots containing private project information, transcripts, prompts, or credentials. Unsupported sources should remain explicitly unavailable rather than being guessed into the UI.

## License

Contributions are accepted under the MIT License. See [LICENSE](LICENSE).
