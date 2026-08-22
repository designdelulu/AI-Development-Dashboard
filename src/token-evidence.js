export const TOKEN_EVIDENCE = Object.freeze({
  exact: 'exact',
  estimated: 'estimated',
  mixed: 'mixed',
  unavailable: 'unavailable'
});

export function emptyEvidence() {
  return { exact: 0, estimated: 0 };
}

export function mergeEvidenceLevel(left, right) {
  if (!left) return right || TOKEN_EVIDENCE.unavailable;
  if (!right) return left;
  if (left === right) return left;
  if (left === TOKEN_EVIDENCE.unavailable) return right;
  if (right === TOKEN_EVIDENCE.unavailable) return left;
  return TOKEN_EVIDENCE.mixed;
}

export function evidenceFromCounts({ exact = 0, estimated = 0 } = {}) {
  if (exact && estimated) return TOKEN_EVIDENCE.mixed;
  if (estimated) return TOKEN_EVIDENCE.estimated;
  if (exact) return TOKEN_EVIDENCE.exact;
  return TOKEN_EVIDENCE.unavailable;
}

export function addEvidence(target = emptyEvidence(), evidence = TOKEN_EVIDENCE.exact, count = 1) {
  const next = { exact: target.exact || 0, estimated: target.estimated || 0 };
  if (evidence === TOKEN_EVIDENCE.estimated) next.estimated += count;
  else if (evidence === TOKEN_EVIDENCE.exact) next.exact += count;
  return next;
}

export function formatObservedTokens(value, { estimated = false, mixed = false } = {}) {
  const amount = Number(value) || 0;
  const compact = amount >= 1e9 ? `${(amount / 1e9).toFixed(2)}B` : amount >= 1e6 ? `${(amount / 1e6).toFixed(1)}M` : amount >= 1e3 ? `${(amount / 1e3).toFixed(0)}K` : new Intl.NumberFormat().format(amount);
  if (mixed || estimated) return `~${compact}`;
  return compact;
}
