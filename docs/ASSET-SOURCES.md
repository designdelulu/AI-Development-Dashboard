# Share Stats agent assets

This local-only dashboard packages optimized PNG copies of native application icons for its personal Share Stats cards. They are used solely as labelled agent identifiers and are never uploaded by the dashboard.

| Agent | Local source inspected | Packaged file |
| --- | --- | --- |
| Claude | `/Applications/Claude.app/Contents/Resources/ion-dist/images/claude_app_icon.png` | `public/assets/agents/claude.png` |
| Codex | `/Applications/ChatGPT.app/Contents/Resources/icon-codex-light.png` | `public/assets/agents/codex.png` |
| Cursor | `/Applications/Cursor.app/Contents/Resources/Cursor.icns` | `public/assets/agents/cursor.png` |

Each asset remains unmodified in aspect ratio; the dashboard only creates a 512px display copy. The images are embedded into generated SVG cards so local PNG export remains self-contained. They do not imply provider endorsement, partnership, or affiliation. Models without a distinct official mark use the provider/agent mark plus the model name. Unknown identities use a letter fallback; the dashboard does not hotlink or scrape logo sites.

## README and article screenshots

Canonical live-activity capture lives in the Design Delulu article as `designdelulu-site/images/blog/ai-development-dashboard-live-activity-capacity.webp` (real local signal field, privacy-safe). The GitHub README hero `docs/assets/ai-development-dashboard-live-activity.png` is a repository-local PNG derived from that same source. Overview and Live Feed shots remain additional product documentation, not substitutes for the live-activity hero.

## Achievement badge artwork

Seven owner-supplied sprite sheets (1536×1024, 2×3 of six tiers) were copied from Downloads into `public/assets/achievements/source/` and sliced to 512×512 plus 160px thumbs. Originals in Downloads were not modified.

| Family folder | Achievement ids | Source sheet |
| --- | --- | --- |
| `multi-agent-mastery` | `multi-agent-builder` | `multi-agent-mastery.png` |
| `capability-mastery` | `capability-in-practice` | `capability-mastery.png` |
| `dev-streak` | `consistent-builder` | `dev-streak.png` |
| `token-efficiency` | `leaner-loop` | `token-efficiency.png` |
| `lean-context` | `lean-context` | `lean-context.png` |
| `parallel-operator` | `parallel-operator` | `parallel-operator.png` |
| `shipping-streak` | `shipping-streak` | `shipping-streak.png` |

Tiers left-to-right, top-to-bottom: bronze, silver, gold, platinum, diamond, mythic. Share Stats embeds the 160px thumbs; the UI can use the 512px slices. This is local artwork mapping only — not a new achievement system or leaderboard.

