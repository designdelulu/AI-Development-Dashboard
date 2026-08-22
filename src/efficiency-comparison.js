import crypto from 'node:crypto';
import { freshPlusOutput } from './tokens.js';

export const COHORT_CLASSES = Object.freeze({ controlled: 'controlled', stronglyMatched: 'strongly-matched', looselyMatched: 'loosely-matched', unmatched: 'unmatched' });
export const ELIGIBILITY_REASONS = Object.freeze(['no_explicit_cycle', 'unmatched_task', 'unknown_model', 'auto_selected_model', 'mixed_model_unattributed', 'incompatible_model_path', 'incompatible_host_harness', 'incompatible_validation_target', 'incompatible_validation_strength', 'different_starting_state', 'capability_confounded', 'capability_configuration_unknown', 'no_validated_outcome', 'no_accepted_outcome', 'unknown_outcome', 'incompatible_token_evidence', 'cost_unavailable', 'duration_unavailable', 'provider_infrastructure_interruption', 'outside_period', 'duplicate_variant', 'incomplete_pair', 'protocol_deviation', 'insufficient_sample', 'project_concentration']);
export const COMPARISON_ELIGIBILITY_VERSION = '1';

const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 20);
const present = (value) => value != null && value !== '';
const listEqual = (a = [], b = []) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const executionPath = (identity = {}) => ({ provider: identity.provider || null, modelId: identity.modelId || null, host: identity.host || null, harness: identity.harness || null });
const pathKey = (identity = {}) => [identity.provider || '', identity.modelId || '', identity.host || '', identity.harness || ''].join('|');
const compatibleContract = (a, b) => Boolean(a && b && a.targetId === b.targetId && a.kind === b.kind && a.strength === b.strength && (a.version || null) === (b.version || null) && (a.requiredStatus || 'passed') === (b.requiredStatus || 'passed'));
const projectFor = (cycle, byBlock) => {
  const projects = new Set((cycle.workBlockIds || []).map((id) => byBlock.get(id)?.projectId).filter(Boolean));
  return projects.size === 1 ? [...projects][0] : null;
};
const outcomeState = (cycle, outcomes = []) => outcomes.find((outcome) => (cycle.workBlockIds || []).includes(outcome.workBlockId) && outcome.evidenceClass === 'user-confirmed')?.state || null;
const relevantEvents = (cycle, events = []) => events.filter((event) => (cycle.workBlockIds || []).includes(event.workBlockId));

function candidateFor(cycle, foundation, byBlock, period = null) {
  const segments = (foundation.modelSegments || []).filter((segment) => segment.cycleId === cycle.id);
  const attempts = (foundation.attempts || []).filter((attempt) => attempt.cycleId === cycle.id);
  const events = relevantEvents(cycle, foundation.events);
  const reasons = [];
  if (!cycle.taskKey) reasons.push('no_explicit_cycle', 'unmatched_task');
  if (!cycle.validationContract) reasons.push('incompatible_validation_target');
  if (!cycle.capabilityConfigurationKnown) reasons.push('capability_configuration_unknown');
  const projectId = projectFor(cycle, byBlock);
  if (!projectId) reasons.push('unmatched_task');
  if (period?.start || period?.end) {
    const inRange = (cycle.workBlockIds || []).every((id) => {
      const startedAt = byBlock.get(id)?.startedAt;
      if (!startedAt) return false;
      const value = new Date(startedAt).getTime();
      return (!period.start || value >= new Date(period.start).getTime()) && (!period.end || value < new Date(period.end).getTime());
    });
    if (!inRange) reasons.push('outside_period');
  }
  if (segments.length !== 1) reasons.push('mixed_model_unattributed');
  const segment = segments[0] || null;
  if (!segment?.identity?.modelId || segment.identity.modelId === 'unknown') reasons.push('unknown_model');
  if (segment?.identity?.modelId === 'auto') reasons.push('auto_selected_model');
  const contractAttempts = attempts.filter((attempt) => compatibleContract(attempt.validationContract, cycle.validationContract));
  if (!contractAttempts.length) reasons.push('no_validated_outcome');
  const validated = contractAttempts.some((attempt) => attempt.result === 'completed');
  const accepted = outcomeState(cycle, foundation.outcomes) === 'accepted';
  const capabilityIds = [...new Set((foundation.capabilityEvidence || []).filter((item) => (cycle.workBlockIds || []).includes(item.workBlockId) && item.class === 'confirmed-invocation').map((item) => item.capabilityId))].sort();
  const providerInterrupted = events.some((item) => ['provider_error', 'rate_limit', 'timeout'].includes(item.type));
  return {
    cycle, projectId, segments, segment, attempts: contractAttempts, events, identity: segment?.identity || null,
    executionPath: executionPath(segment?.identity), executionPathKey: pathKey(segment?.identity),
    validationContract: cycle.validationContract || null, validated, accepted,
    capabilityIds, providerInterrupted, reasons: [...new Set(reasons)]
  };
}

export function eligibilityResult(candidate, { metric = 'fresh_plus_output', scope = 'observational', extraReasons = [] } = {}) {
  const reasons = [...candidate.reasons, ...extraReasons];
  if (metric === 'until_validation' && !candidate.validated) reasons.push('no_validated_outcome');
  if (metric === 'accepted_outcome' && !candidate.accepted) reasons.push('no_accepted_outcome');
  if (metric === 'quality' && candidate.providerInterrupted) reasons.push('provider_infrastructure_interruption');
  const blocking = new Set(['no_explicit_cycle', 'unmatched_task', 'unknown_model', 'auto_selected_model', 'mixed_model_unattributed', 'incompatible_validation_target', 'incompatible_validation_strength', 'capability_confounded', 'capability_configuration_unknown', 'provider_infrastructure_interruption', 'no_validated_outcome', 'no_accepted_outcome', 'outside_period']);
  const reasonCodes = [...new Set(reasons)];
  return { eligible: !reasonCodes.some((reason) => blocking.has(reason)), scope, metric, reasonCodes, includedCount: 0, excludedCount: reasonCodes.length ? 1 : 0, coverage: { outcome: candidate.validated ? 1 : 0, token: 0, exactCost: 0, duration: 0, capability: candidate.cycle.capabilityConfigurationKnown ? 1 : 0 }, dimensionsUsed: ['taskKey', 'projectId', 'validationContract', 'executionPath', 'capabilityConfiguration'] };
}

function cohortClass(candidates) {
  if (!candidates.length) return COHORT_CLASSES.unmatched;
  if (candidates.every((item) => item.cycle.boundaryMethod === 'controlled-trial' && item.cycle.startingState?.known)) return COHORT_CLASSES.controlled;
  if (candidates.every((item) => item.cycle.taskKey && item.projectId && item.validationContract && item.cycle.capabilityConfigurationKnown)) return COHORT_CLASSES.stronglyMatched;
  if (candidates.every((item) => item.cycle.taskCategory && item.projectId && item.validationContract)) return COHORT_CLASSES.looselyMatched;
  return COHORT_CLASSES.unmatched;
}

export function buildComparableCohorts(foundation = {}, { period = null } = {}) {
  const byBlock = new Map((foundation.workBlocks || []).map((block) => [block.id, block]));
  const candidates = (foundation.userCycles || []).map((cycle) => candidateFor(cycle, foundation, byBlock, period));
  const groups = new Map();
  for (const candidate of candidates) {
    const contract = candidate.validationContract || {};
    const key = [candidate.cycle.taskKey || candidate.cycle.taskCategory ? (candidate.cycle.taskKey || `loose:${candidate.cycle.taskCategory}`) : `unmatched:${candidate.cycle.id}`, candidate.projectId || 'unknown-project', contract.targetId || 'unknown-validator', contract.strength || 'unknown-strength'].join('|');
    (groups.get(key) || groups.set(key, []).get(key)).push(candidate);
  }
  return [...groups.values()].map((items) => {
    const classification = cohortClass(items);
    const first = items[0];
    const capabilityMismatch = items.some((item) => !listEqual(item.cycle.capabilityConfiguration, first.cycle.capabilityConfiguration) || !listEqual(item.capabilityIds, first.capabilityIds));
    const hostMismatch = items.some((item) => item.executionPath.host !== first.executionPath.host || item.executionPath.harness !== first.executionPath.harness);
    const variants = new Map();
    const exclusions = [];
    for (const item of items) {
      const extra = [];
      if (capabilityMismatch) extra.push('capability_confounded');
      if (hostMismatch) extra.push('incompatible_host_harness');
      const eligibility = eligibilityResult(item, { extraReasons: extra, scope: classification === COHORT_CLASSES.controlled ? 'controlled' : classification === COHORT_CLASSES.stronglyMatched ? 'observational' : 'descriptive' });
      const key = item.executionPathKey || 'unknown';
      const variant = variants.get(key) || { key, identity: item.identity, executionPath: item.executionPath, observations: [], eligibility: [] };
      variant.observations.push(item);
      variant.eligibility.push(eligibility);
      variants.set(key, variant);
      if (!eligibility.eligible) exclusions.push({ cycleId: item.cycle.id, metric: 'fresh_plus_output', reasonCode: eligibility.reasonCodes[0] || 'insufficient_sample' });
    }
    const direct = [COHORT_CLASSES.controlled, COHORT_CLASSES.stronglyMatched].includes(classification) && variants.size >= 2;
    if (!direct) for (const item of items) exclusions.push({ cycleId: item.cycle.id, metric: 'fresh_plus_output', reasonCode: classification === COHORT_CLASSES.looselyMatched ? 'unmatched_task' : 'insufficient_sample' });
    const descriptor = { source: classification === COHORT_CLASSES.controlled ? 'controlled-trial' : 'user-cycle', classification, unit: classification === COHORT_CLASSES.controlled ? 'valid-pair' : 'work-cycle', period, taskKey: first.cycle.taskKey || null, projectId: first.projectId, validationContract: first.validationContract, dimensions: { host: hostMismatch ? null : first.executionPath.host, harness: hostMismatch ? null : first.executionPath.harness, providerPath: first.executionPath.provider, modelIdentityLevel: 'exact', capabilityConfiguration: capabilityMismatch ? null : first.cycle.capabilityConfiguration }, variantDefinition: hostMismatch ? 'host-harness-path' : 'model-path', paired: classification === COHORT_CLASSES.controlled, eligibilityVersion: COMPARISON_ELIGIBILITY_VERSION, includedCycleIds: items.filter((item) => !item.reasons.length).map((item) => item.cycle.id), exclusions };
    const collectedVariants = [...variants.values()];
    const allVariantsEligible = collectedVariants.every((variant) => variant.eligibility.every((result) => result.eligible));
    return { ...descriptor, cohortId: `cohort:${hash(descriptor)}`, eligible: direct && !capabilityMismatch && allVariantsEligible, variants: collectedVariants, evidenceLevel: classification === COHORT_CLASSES.controlled ? 'Controlled' : classification === COHORT_CLASSES.stronglyMatched ? 'Strongly matched' : classification === COHORT_CLASSES.looselyMatched ? 'Loosely matched' : 'Unmatched' };
  });
}

export function eligibleObservationTokens(candidate, foundation = {}) {
  const segment = candidate.segment;
  if (!segment?.usageObservationIds?.length) return { value: null, reasonCode: 'incompatible_token_evidence' };
  const observations = new Map((foundation.usageObservations || []).map((item) => [item.id, item]));
  const values = segment.usageObservationIds.map((id) => observations.get(id)).filter(Boolean);
  const evidence = new Set(values.map((item) => item.tokens?.evidence));
  if (evidence.size !== 1 || !evidence.has('exact')) return { value: null, reasonCode: 'incompatible_token_evidence' };
  return { value: values.reduce((total, item) => total + freshPlusOutput(item.tokens || {}), 0), reasonCode: null };
}

const sorted = (values = []) => values.filter(Number.isFinite).slice().sort((a, b) => a - b);
const quantile = (values, q) => {
  if (!values.length) return null;
  const point = (values.length - 1) * q, lower = Math.floor(point), upper = Math.ceil(point);
  return lower === upper ? values[lower] : values[lower] + (values[upper] - values[lower]) * (point - lower);
};
export function distribution(values = []) {
  const items = sorted(values);
  return { n: items.length, median: quantile(items, 0.5), min: items[0] ?? null, max: items.at(-1) ?? null, iqr: items.length >= 4 ? { p25: quantile(items, 0.25), p75: quantile(items, 0.75) } : null, values: items };
}

export function sampleGate({ paired = false, variants = [], projectSpecific = true } = {}) {
  const counts = variants.map((variant) => variant.metrics?.eligibleAttempts || 0);
  const accepted = variants.map((variant) => variant.metrics?.acceptedOutcomes || 0);
  const min = counts.length ? Math.min(...counts) : 0;
  if (paired) {
    if (min >= 20) return { state: 'controlled-summary', label: 'Controlled comparison', percentageAllowed: true, direct: true };
    if (min >= 10) return { state: 'controlled-exploratory', label: 'Exploratory controlled comparison', percentageAllowed: true, direct: true };
    if (min >= 5) return { state: 'limited-paired', label: 'Limited paired data', percentageAllowed: false, direct: false };
    return { state: 'raw-pairs', label: 'Very limited paired data', percentageAllowed: false, direct: false };
  }
  if (min >= 20 && variants.every((variant) => variant.metrics?.unknownOutcomeCoverage <= 0.2 && variant.metrics?.tokenCoverage >= 0.8) && projectSpecific) return { state: 'observational-summary', label: 'Strongly matched observational comparison', percentageAllowed: true, direct: true };
  if (min >= 10 && accepted.every((value) => value >= 5)) return { state: 'observational-comparison', label: 'Strongly matched observational comparison', percentageAllowed: true, direct: true };
  if (min >= 5) return { state: 'limited-sample', label: 'Limited sample', percentageAllowed: false, direct: false };
  if (min >= 3) return { state: 'limited-data', label: 'Limited data', percentageAllowed: false, direct: false };
  return { state: 'raw-only', label: 'Very limited data', percentageAllowed: false, direct: false };
}

function exactCostsFor(candidate, foundation = {}) {
  const rows = (foundation.exactCostObservations || []).filter((item) => item.cycleId === candidate.cycle.id && item.modelSegmentId === candidate.segment?.id && item.semantic === 'provider-billed' && Number.isFinite(Number(item.amount)));
  if (!rows.length) return null;
  return rows.reduce((total, item) => total + Number(item.amount), 0);
}

function variantMetrics(variant, foundation) {
  const tokenValues = [], attemptValues = [], validatedTokens = [], exactCostValues = [];
  let acceptedOutcomes = 0, validatedOutcomes = 0, validationFailures = 0, totalAttempts = 0, unknownOutcomes = 0;
  for (const candidate of variant.observations) {
    const tokens = eligibleObservationTokens(candidate, foundation);
    if (tokens.value != null) tokenValues.push(tokens.value);
    const attempts = candidate.attempts.length;
    totalAttempts += attempts;
    attemptValues.push(attempts);
    validationFailures += candidate.attempts.filter((attempt) => attempt.result === 'failed').length;
    if (candidate.validated) { validatedOutcomes++; if (tokens.value != null) validatedTokens.push(tokens.value); }
    if (candidate.accepted) acceptedOutcomes++; else unknownOutcomes++;
    const cost = candidate.validated ? exactCostsFor(candidate, foundation) : null;
    if (cost != null) exactCostValues.push(cost);
  }
  const total = variant.observations.length;
  const tokenCoverage = total ? tokenValues.length / total : 0;
  const exactCostCoverage = validatedOutcomes ? exactCostValues.length / validatedOutcomes : 0;
  return {
    observations: total, eligibleAttempts: totalAttempts, acceptedOutcomes, validatedOutcomes, validationFailures,
    unknownOutcomeCoverage: total ? unknownOutcomes / total : 1, tokenCoverage, exactCostCoverage,
    freshPlusOutput: tokenCoverage === 1 ? distribution(tokenValues) : null,
    freshPlusOutputUntilValidation: validatedTokens.length ? distribution(validatedTokens) : null,
    attempts: distribution(attemptValues),
    validationFailureRate: totalAttempts >= 20 ? { failures: validationFailures, denominator: totalAttempts, value: validationFailures / totalAttempts } : null,
    // Exact cost is withheld unless every validated cycle has a deterministic provider-billed amount.
    exactCostUntilValidation: validatedOutcomes && exactCostCoverage === 1 ? distribution(exactCostValues) : null,
    exactCostCoverage
  };
}

export function comparisonMetrics(foundation = {}, options = {}) {
  const cohorts = buildComparableCohorts(foundation, options).map((cohort) => {
    const variants = cohort.variants.map((variant) => ({ ...variant, metrics: variantMetrics(variant, foundation) }));
    const gate = sampleGate({ paired: cohort.paired, variants, projectSpecific: Boolean(cohort.projectId) });
    const canCompare = cohort.eligible && gate.direct;
    const percentages = {};
    if (canCompare && variants.length === 2) {
      const [baseline, comparison] = variants;
      const a = baseline.metrics.freshPlusOutput?.median, b = comparison.metrics.freshPlusOutput?.median;
      if (a > 0 && b != null) percentages.freshPlusOutput = (b - a) / a;
    }
    return { ...cohort, variants, gate, canCompare, percentages, sharing: 'disabled' };
  });
  return { eligibilityVersion: COMPARISON_ELIGIBILITY_VERSION, cohorts, comparable: cohorts.some((cohort) => cohort.canCompare), sharing: 'disabled' };
}
