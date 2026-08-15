// Cursor token telemetry: what Cursor itself provides vs what this adapter can read.
// Official Usage CSV import remains a future option. Auth material is never read.

export const CURSOR_USAGE_URL = 'https://cursor.com/dashboard';

export const CURSOR_TOKEN_SOURCE = Object.freeze({
  adapterStatus: 'experimental',
  officialView: { label: 'View Cursor Usage', href: CURSOR_USAGE_URL },
  import: Object.freeze({
    status: 'planned',
    implemented: false,
    label: 'Import Cursor Usage',
    source: 'Official Cursor Usage CSV export, or a user-selected export file',
    note: 'Not required until a documented export schema is confirmed.'
  }),
  notInspected: Object.freeze([
    'Cursor account cookies or dashboard DOM',
    'cursorAuth access/refresh tokens',
    'unofficial provider endpoints',
    'ItemTable keys that look like credentials'
  ])
});

export function cursorTokenAvailability(diagnostics = {}) {
  const status = diagnostics.cursorTokenStatus || diagnostics.status;
  const action = CURSOR_TOKEN_SOURCE.officialView;
  if (status === 'exact') {
    return { available: true, evidence: 'exact', reason: 'Local token telemetry', detail: 'Explicit token or context-meter fields in local Cursor storage.', action };
  }
  if (status === 'estimated' || status === 'mixed') {
    return {
      available: true,
      evidence: status,
      reason: status === 'mixed' ? 'Local token telemetry includes estimates' : 'Estimated local token telemetry',
      detail: 'Current Cursor builds often store per-bubble tokenCount as {0,0}. Non-zero fields are used first; otherwise a documented character estimate is labelled Estimated.',
      action
    };
  }
  if (status === 'busy') {
    return { available: false, evidence: 'unavailable', reason: 'Local token telemetry unavailable', detail: diagnostics.cursorTokenReason || 'Cursor database was busy.', action };
  }
  if (status === 'empty') {
    return { available: false, evidence: 'unavailable', reason: 'Local token telemetry unavailable', detail: 'No dated Cursor token events in the selected sources.', action };
  }
  return {
    available: false,
    evidence: 'unavailable',
    reason: 'Local token telemetry unavailable',
    detail: diagnostics.cursorTokenReason || 'This dashboard has no validated local Cursor token ledger for the current scan.',
    action
  };
}
