// Cursor token telemetry: what Cursor itself provides vs what this adapter can read.
// Bounded local inspection found no validated per-event token ledger. Auth material
// in Cursor storage is never read. Official Usage CSV import is a future option.

export const CURSOR_TOKEN_SOURCE = Object.freeze({
  adapterStatus: 'unavailable',
  reason: 'Local token telemetry unavailable',
  detail: 'This dashboard has no validated local Cursor token ledger. Cursor still shows usage in the Cursor account dashboard.',
  inspected: Object.freeze([
    'agent-transcripts JSON/JSONL (role/message records; no trustworthy token fields)',
    'state.vscdb ItemTable usage-like keys (slash-command counters, not model tokens)',
    'composerHeaders metadata (session timestamps only)'
  ]),
  notInspected: Object.freeze([
    'Cursor account cookies or dashboard DOM',
    'cursorAuth access/refresh tokens',
    'unofficial provider endpoints'
  ]),
  officialView: { label: 'View Cursor Usage', href: 'https://cursor.com/dashboard' },
  import: Object.freeze({
    status: 'planned',
    implemented: false,
    label: 'Import Cursor Usage',
    source: 'Official Cursor Usage CSV export, or a user-selected export file',
    note: 'Not required until a documented export schema is confirmed.'
  })
});

export function cursorTokenAvailability() {
  return {
    available: false,
    reason: CURSOR_TOKEN_SOURCE.reason,
    detail: CURSOR_TOKEN_SOURCE.detail,
    action: CURSOR_TOKEN_SOURCE.officialView
  };
}
