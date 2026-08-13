# Share Stats agent assets

This local-only dashboard packages optimized PNG copies of native application icons for its personal Share Stats cards. They are used solely as labelled agent identifiers and are never uploaded by the dashboard.

| Agent | Local source inspected | Packaged file |
| --- | --- | --- |
| Claude | `/Applications/Claude.app/Contents/Resources/ion-dist/images/claude_app_icon.png` | `public/assets/agents/claude.png` |
| Codex | `/Applications/ChatGPT.app/Contents/Resources/icon-codex-light.png` | `public/assets/agents/codex.png` |
| Cursor | `/Applications/Cursor.app/Contents/Resources/Cursor.icns` | `public/assets/agents/cursor.png` |

Each asset remains unmodified in aspect ratio; the dashboard only creates a 512px display copy. The images are embedded into generated SVG cards so local PNG export remains self-contained. They do not imply provider endorsement, partnership, or affiliation.
