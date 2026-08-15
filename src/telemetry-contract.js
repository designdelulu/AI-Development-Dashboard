// Future provider adapters describe this shape. Only Claude, Codex, and Cursor
// are implemented. Unknown fields stay unavailable; they are never fabricated.

export const TELEMETRY_CONTRACT = Object.freeze({
  version: 1,
  fields: Object.freeze([
    'sessions',
    'projects',
    'timestamps',
    'tokenCategories',
    'tokenEvidence',
    'model',
    'provider',
    'host',
    'accountCapacity',
    'liveActivity'
  ]),
  tokenEvidence: Object.freeze(['exact', 'estimated', 'mixed', 'unavailable']),
  notes: Object.freeze({
    timestamps: 'Usage-event time in UTC, bucketed in the operator timezone. Never scan time, ingest time, file mtime, or backfill time.',
    tokenEvidence: 'Exact is provider/local numeric usage. Estimated is a documented derivation. Mixed aggregates contain both. Unavailable is not a zero.',
    accountCapacity: 'Plan/account remaining allowance. Separate from model identity and token analytics.'
  })
});
