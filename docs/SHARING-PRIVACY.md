# Sharing and export privacy

## Field classes

| Class | Examples | Shareable default |
| --- | --- | --- |
| Public-safe | Agent names, public capability names/types, normalized aggregate metrics | Yes |
| User-approved | Project names, optional public source links | No — future explicit opt-in only |
| Private | Absolute paths, machine identifiers, private capability/project metadata | No |
| Forbidden | Prompts, transcript bodies, source code, credentials, secret/MCP/environment values | Never |

The export module centrally constructs public exports from allowlisted fields. Private capabilities are excluded from Shareable Stack and Manifest. Private Inventory is marked **PRIVATE — DO NOT SHARE** and still excludes forbidden fields.

## Share snapshots and links

A `ShareSnapshot` freezes selected public-safe values, metric-definition version, period, privacy class and output format in the local gitignored index. Browser cards are rendered solely from that snapshot. Generated images are downloaded locally; no cloud upload exists.

Future optional links must upload only an explicitly approved ShareSnapshot, never source code, raw sessions, source files, private paths or credentials. Sharing must remain opt-in per snapshot.

## Future story/video

The same snapshot/card schema supports 9:16 stories. A future renderer should prefer browser animation capture or Remotion if a repeatable video workflow is justified; it must consume snapshots, not live private telemetry.
