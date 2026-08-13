# Sharing and export privacy

## Field classes

| Class | Examples | Shareable default |
| --- | --- | --- |
| Public-safe | Agent names, public capability names/types, normalized aggregate metrics | Yes |
| User-approved | Project names, optional public source links | No — future explicit opt-in only |
| Private | Absolute paths, machine identifiers, private capability/project metadata | No |
| Forbidden | Prompts, transcript bodies, source code, credentials, secret/MCP/environment values | Never |

The export module centrally constructs public exports from allowlisted fields. Private capabilities are excluded from Shareable Stack and Manifest. Private Inventory is marked **PRIVATE — DO NOT SHARE** and still excludes forbidden fields.

Dashboard-only project pins, statuses and notes are **Private**. They are not public-share metrics, are not read by ShareSnapshot creation, and are excluded from Share Stack, Manifest, Setup Prompt and social-card rendering. A future opt-in sharing control would need an explicit separate field class and confirmation.

## Share snapshots and links

A `ShareSnapshot` freezes selected public-safe values, metric-definition version, period, privacy class and output format in the local gitignored index. Browser cards are rendered solely from that snapshot. Generated images are downloaded locally; no cloud upload exists.

Future optional links must upload only an explicitly approved ShareSnapshot, never source code, raw sessions, source files, private paths or credentials. Sharing must remain opt-in per snapshot.

## Setup Prompt and future import

The Setup Prompt is generated from the current normalized parent-capability registry at request time. It includes public-safe names, safe descriptions, agent compatibility and sources; it excludes private/local-only capabilities, paths, prompts, credentials and project data. It directs a receiving agent to audit, compare, preserve, preview and validate rather than install blindly.

Future Import Stack flow: audit target machine → compare installed capabilities → classify already-installed/missing/version-different/conflict/unsupported → preview plan → user approves → apply → validate. The manifest and Setup Prompt are inputs to the same safety model, never executable installation instructions.

## Share Story deck

The dashboard can build a local multi-slide recap. Every card is derived from a frozen Public-safe `ShareSnapshot`; the deck can include only evidence-supported slides. Agent ranking contains labeled agent names, observed session counts, percentages, and public local-app marks. Capability ranking includes only non-private capability names with confirmed event evidence. Project names and dashboard notes are never part of the deck.

Achievements are deterministic. They reward observed multi-agent work, confirmed capability practice, sustained active days, and a comparable personal efficiency improvement when available. Six tiers (Bronze through Mythic) are metadata and replaceable badge asset slots, not a claim of externally verified performance. No achievement rewards total tokens, LOC, prompt count, or tool-call volume.

## Future story/video

The same snapshot/card schema supports 9:16 stories. A future renderer should prefer browser animation capture or Remotion if a repeatable video workflow is justified; it must consume snapshots, not live private telemetry.

## Share experience

The interface starts with a public-safe observed-story preview before customization. Its agent marks use locally packaged native application assets as clearly labelled identifiers; numeric rank, count, percentage, and proportional bars are the quantitative encoding. Asset provenance is recorded in `docs/ASSET-SOURCES.md`. Achievements are deterministic, evidence-labelled and intentionally never reward token volume, LOC, prompt count or tool-call count.

Share cards keep four normalized token categories separate: Fresh input, Output, Cache read and Cache creation. A segmented composition may show their relative observed volume, but labels explicitly state that cached context is not fresh consumption. A category known elsewhere in local history but absent from the chosen period remains selectable only as an explained unavailable state; it is never rendered as a misleading zero.

The Claude, Codex and Cursor share marks are dashboard-owned abstract line identities. The official Cursor brand page and OpenAI brand guidance were reviewed previously, but a consistently reusable official set covering all three agents could not be verified under one redistribution model. Keeping an original, clearly labelled set avoids implied endorsement and third-party trademark asset bundling. Mark area is a deterministic square-root transform of observed session count within the selected period, while accessible text preserves the exact count and percentage.
