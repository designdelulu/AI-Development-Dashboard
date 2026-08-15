# Contributing

Thank you for considering a contribution. This project is currently a private local-first beta; public contribution workflow will be enabled only after the public-release checklist is complete.

## Ground rules

- Do not add raw agent transcripts, prompts, credentials, cookies, provider tokens, absolute private paths, or generated `.dashboard-data/` files.
- Keep agent adapters conservative: unknown data stays unknown.
- Keep analytics and sharing separate. Public-safe snapshots may only use explicitly allowlisted aggregate fields.
- Add deterministic sanitized fixtures for parser, attribution, privacy, or metric changes.
- Do not alter external agent configuration as part of dashboard behavior.

## Local workflow

```bash
npm test
npm run scan
npm start
```

Before opening a future pull request, run the tests, inspect `git diff --check`, and verify the dashboard with missing-data states as well as real local data.

## License

Contributions are accepted under the MIT License. See [LICENSE](LICENSE).
