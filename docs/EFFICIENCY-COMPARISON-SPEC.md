# Efficiency Comparison Specification

Status: Units 1–5 implemented. Unit 6 (controlled-report import) remains
unimplemented. This document defines a private, metadata-only comparison
feature. It does not authorize a ranking, routing recommendation, experiment
runner, adapter change, or a universal efficiency/productivity score.

## Purpose and non-goals

The efficiency foundation answers descriptive questions about observed work
blocks.  Unit 20 may answer a narrower question: **within a disclosed cohort
whose units and evidence match, how do the observed distributions differ?**

It must never infer task quality from token volume, make a causal claim from
observational data, call a session-proxy Work Block a Task, or turn a passing
validator into a claim that an objective is correct.  Prompts, transcript
bodies, source code, terminal output, tool arguments, secrets, and raw paths
remain outside the comparison store and UI.

## Definitions

### Unit hierarchy

```text
Project → Session → Work Block → Work Cycle → Model Segment → Validation Attempt → Events
                                                          └→ Outcome Evidence
```

- **Work Block** is the current bounded observation.  A `session-proxy` Work
  Block is descriptive only.
- **Work Cycle** is a reversible grouping with an explicit task/cycle boundary.
  It is the comparison unit, never an implicitly reconstructed task.
- **Model Segment** is the part of a cycle/attempt attributable to one exact
  identity and execution path.  A mixed-model cycle without attributable
  segments cannot enter a model-level comparison.
- **Validation Attempt** is an observed effort ending in a named validator.
- **Outcome Evidence** records a validation or acceptance signal, not an
  automatic declaration of correctness.

`Task` is reserved for an explicit task ID, controlled benchmark ID, or a
user-created private objective.  Historical session closure, inactivity,
commit creation, handoff creation, and a model switch do not create a Task.

### Evidence classes

Existing event evidence remains authoritative:

- **Measured** — a source emitted the event, status, count, identifier, or
  timestamp directly.
- **Inferred** — a bounded structural rule derived the observation.
- **User-confirmed** — the local user explicitly recorded it.
- **Unknown** — evidence is insufficient.

An inferred retry/rework signal must remain inferred through every aggregate
and tooltip.  Metric evidence and token/cost evidence are separate axes: a
Measured event can still have unavailable or Estimated token/cost coverage.

## Comparable Cohort

### Record

Create a cached, reproducible `ComparableCohort` result; retain its input
descriptor rather than storing a mutable conclusion.

```text
cohortId                       // deterministic hash of descriptor + metric version
source: controlled-trial | user-cycle | structured-task | matched-observation
classification: controlled | strongly-matched | loosely-matched | unmatched
unit: work-cycle | valid-pair
period: { start, end, localTimeZone }
taskKey?                       // opaque stable ID; no prompt/objective body
projectId?
validationContract: { targetId?, kind, strength, version?, requiredStatus }
startingState: { revisionHash?, environmentFingerprint?, known }
dimensions: {
  host, harness, providerPath, modelIdentityLevel,
  capabilityConfiguration, taskCategory?, contextBand?, language?
}
variantDefinition: model-path | capability-assignment | host-harness-path
paired: boolean
pairingKey?                    // controlled task/run pair only
eligibilityVersion
includedCycleIds[]             // local-only opaque IDs
exclusions: [{ cycleId?, metric?, reasonCode }]
coverage: { outcome, token, exactCost, duration, capability }
createdAt, invalidatedAt?
```

Only stable opaque IDs, hashes, bounded category IDs, and numeric metadata may
be persisted.  User labels/objectives, if added later, remain local private
metadata, are opt-in, and never enter Share Stats.

### Cohort classes and permitted claims

| Class | Required evidence | Allowed display | Prohibited claim |
| --- | --- | --- | --- |
| `controlled` | Predeclared benchmark/task, validation contract, variant assignment, compatible start state, recorded deviations | paired distributions and “under this controlled trial” differences | universal/model-wide winner |
| `strongly-matched` | Same explicit user cycle or structured task ID, project, validation contract, compatible model path/configuration | side-by-side observational distributions | causation, rescue, “better” |
| `loosely-matched` | Same project/category and compatible validator, but no same explicit objective/start state | descriptive context only; never a direct efficiency comparison | percentage/directional comparison |
| `unmatched` | anything less | existing descriptive overview only | all comparative language |

The former plan term “Adjusted observational comparison” is replaced by
**Strongly matched observational comparison**.  The first release does not
claim regression adjustment; it exposes its matching dimensions instead.

### Required and optional dimensions

For all direct comparisons, the following are required:

1. an explicit cycle/task or controlled benchmark identity;
2. a compatible named validation contract and outcome eligibility rule;
3. the same metric-definition and token/cost semantics;
4. an exact known model/path identity for the metric being compared; and
5. a declared host/harness treatment: matched when the claim is about a model,
   or intentionally varied and named when the claim is about an execution path.

For strongly-matched observations, same project is also required unless the
task/benchmark fixture itself supplies an immutable project-independent start
state.  Capability configuration must either match, be the declared variant,
or be marked as a confounder that suppresses the model/capability claim.

Starting revision/environment fingerprint, explicit task category, context
band, language, and source/provider path are required for a Controlled cohort
when known by the protocol.  They are otherwise explanatory metadata, not
guesses and not a synthetic difficulty score.  Files-touched count, tool-call
count, duration, and token volume are outcomes/proxies, never matching filters.

## Outcome and validation eligibility

### Two independent axes

`ValidationEvidence` and `OutcomeEvidence` must not be collapsed.

- A **Validated Outcome** means a pre-identified validator passed for the
  cycle/attempt.  It says that check passed; it does not say the user objective
  was completed.
- An **Accepted Outcome** means the user explicitly marked the objective
  complete, or a structured task lifecycle supplied an equivalent explicit
  completion state.  It is a separate acceptance evidence field.

Metrics named “until validation” need a Validated Outcome.  Metrics named
“accepted outcome” need Accepted Outcome evidence.  A passing test alone may
not be included in acceptance/completion rates.  A commit, handoff, session
end, inactivity, agent stop, or model switch is not eligible for either axis.

### Validation contract and strength

Every validation event eligible for Unit 20 needs a bounded `targetId` (for
example a repository script ID or benchmark assertion ID), a validator kind,
status, and source timestamp.  Do not retain the command line or output.

| Strength | Kind | Can establish a Validated Outcome? | Cross-compare with |
| --- | --- | --- | --- |
| V4 | task-specific/benchmark assertion or explicit acceptance check | yes | same target/version only |
| V3 | identified full test suite | yes | same suite/contract only |
| V2 | identified targeted test suite | yes | same target/category only |
| V1 | build or typecheck | yes, as build/typecheck validation only | same kind/target only |
| V0 | lint/format check | yes, as lint/format validation only | same kind/target only |
| none | arbitrary command exited zero | no | never |

User confirmation is an outcome-acceptance signal, not a validation strength;
it may supplement any level and must be compared only to the same acceptance
rule.  A targeted test and a full suite, or a build and lint, are incompatible
for direct outcome rates, cost-per-validated-outcome, and time-to-validation.

### Cycle eligibility

A cycle is outcome-eligible only when it has all of:

1. an explicit comparison boundary (controlled task, structured task, or
   user-created cycle marked as one objective);
2. at least one named validation contract with a Measured passed/failed result;
3. a known exact model segment for the claimed model metric; and
4. enough linkage to associate the validator and preceding segments with the
   same cycle.

For denominators such as validation failure rate, include passed and failed
executions that satisfy the same contract; do not keep only successful cycles.
For cost/tokens/time **until validation**, include every attributable segment
from cycle start until the first matching passed validator.  Do not use only
the final successful attempt.  A cycle ending without the matching pass is
eligible for failure/attempt distributions but not a per-validated-outcome
denominator; show that exclusion explicitly.

## Attempt, retry, error, and rework semantics

### Validation Attempt

An Attempt is not a token bucket.  It is a named validator execution plus the
preceding bounded work since the previous terminal validator/cycle boundary.
Start a new attempt when any of these is observed after a terminal validator:

- a structured implementation/edit/tool event tied to the cycle;
- an explicit harness/agent attempt or retry group;
- a declared model segment switch followed by implementation evidence; or
- a user-created attempt boundary.

A repeated execution of the same validator with no observed substantive event
between it and the prior execution is a **validation recheck**, attached to
the prior attempt.  It still contributes to the validator-event denominator.
If source coverage cannot reveal meaningful intervening work, the attempt
boundary is Unknown rather than manufactured.  The current historical
validation-scoped attempt records do not meet this richer association rule and
must not be retroactively promoted.

### Retry taxonomy

Keep the following separate:

- `retry_measured`: source explicitly reports a retry or retry group;
- `retry_inferred`: same validation contract follows a measured validation
  failure inside a linked cycle; never a quality claim;
- `validation_recheck`: repeat validator execution without observed work;
- `provider_retry`: HTTP/provider transport retry; reliability only;
- `tool_retry`: explicitly linked repeated tool operation.

Model comparisons may display attempts-to-validation and validation retries.
Provider retries, rate limits, transport failures, and adapter parse failures
are excluded from model-quality and coding-failure rates.  They can appear in
a separate “provider/infrastructure interruptions” coverage row.

### Comparison-safe error categories

| Category | Examples | Appropriate metric |
| --- | --- | --- |
| Validation | targeted test/build/typecheck/lint failed | validation failure rate, attempts until matching validation |
| Execution | structured tool, command, or process failure | source-scoped execution reliability only |
| Provider/infrastructure | rate limit, timeout, API/transport failure | provider availability/telemetry only; never coding quality |
| Workflow | explicit rollback, user rejection, abandonment | cycle outcome/descriptive context only |

Every rate needs an equivalent observed denominator and compatible source
coverage in both variants.  “Observed failures” is safe; “model failures” is
not a Unit 20 label.

### Rework

Measured rework requires an explicit user/harness association to the cycle or
attempt: a linked revert/restore, user-marked redo, or superseded attempt.
An unlinked repository `git revert` is not enough.  Repeated edits, a failed
validation followed by re-edit, and structural edit/revert patterns are only
**Possible rework** (Inferred).

Initially, all rework is a descriptive side metric.  It is excluded from
attempt, success, cost, token, and duration denominators and from any headline
comparison.  It may never be described as waste or a confirmed model error.

## Model, host, capability, and mixed-work confounding

### Identity and execution path

The default comparison key is the exact normalized identity:

```text
underlying provider + exact normalized model ID + gateway/provider path + host + harness
```

Agent, host, harness, gateway/account/capacity source, provider, and model
remain distinct.  A registry-declared exact alias may normalize to the same
model ID.  Dated versions, unresolved aliases, auto-selected models, and
Unknown model are distinct/excluded by default.  Model-family grouping is an
explicit secondary, clearly labeled roll-up; it is never the default.

For a model-only claim, host and harness must match.  Cross-host data may be
shown only as a **model-path** or **host/harness-path** comparison, with both
dimensions prominent.  It cannot attribute the difference solely to the
underlying model.  OpenRouter gateway/account identity remains separate from
the underlying provider/model.

### Model segments and switches

New prospective data needs `ModelSegment`:

```text
segmentId, cycleId, attemptId?
startedAt, endedAt?
identity: { agent?, host?, harness?, gateway?, provider?, modelId, modelRaw? }
usageObservationIds[], eventIds[], exactCostIds[]
boundary: source-identity-change | explicit-attempt | user-confirmed
evidence
```

A cycle with multiple attributable segments is a mixed-model cycle.  It is
excluded from a single-model outcome comparison unless each measured attempt
and validation is linked to one segment.  Then show the cycle as “A + B”, the
final validated attempt separately, and prior failure attribution separately.
Never call the final model a rescuer or assign the whole cycle to it.

### Capability confounding

Only `confirmed-invocation` supports “with capability X.”  Installed/enabled
is availability, not use.  For a model comparison, known capability signatures
must match or cause `capability_confounded`; unknown configuration produces a
dominant coverage warning, not an assumption of equivalence.

A capability comparison needs either a controlled assignment or a strongly
matched cohort with confirmed invocation/no-invocation evidence and matching
model/path, validation contract, and other confirmed capability signature.
The latter is an association only: “In this matched observational cohort, work
cycles with confirmed X invocation had a lower median …”  Never say “X saved”
or “X improved outcomes” without a qualifying controlled experiment.

## Token, cost, and duration metrics

### Tokens and cost

**Fresh + Output** is the primary workload token metric.  Fresh Input, Output,
Cache Read, Cache Creation, reasoning/other, and Observed token activity are
supporting diagnostics.  Cache/context processing is not presumed waste.

Compare tokens only when their evidence and metric definition are compatible;
do not mix Exact, Estimated, or Mixed into an Exact-only metric.  Preserve the
existing token semantics and display coverage/missingness.

**Exact API cost** requires a provider-reported billed amount linked
deterministically to the same cycle/segment/model path.  Exact OpenRouter
aggregate model cost that is not linked to a Work Cycle remains descriptive
only.  Subscription use from Claude, Codex, Cursor, and Antigravity is never
converted to dollars.  Cost-per-validated-outcome and cost differences require
100% exact-cost coverage for every included cycle/segment in that metric; with
partial coverage, show only coverage and no cost statistic/difference.

### Duration

Current session-proxy elapsed time is descriptive and must not enter Unit 20
as productive duration.  Prospective `time_to_validation` is allowed only for
a linked cycle with a known start, a matching passed validator, equivalent
host timing semantics, and no unobserved inactivity gap of 30 minutes or more.
Such a gap closes the observed active interval; it is not counted as work.
If any required interval is missing, duration is Unavailable rather than an
overnight/session-open span.  User waiting time and active-dashboard timers
remain separate measurements and are not cross-host model metrics.

Use medians for duration; never use average open-session time as speed.

## Eligibility engine

Eligibility must be evaluated per metric and returned with a visible reason,
not just a boolean.  A cohort may be token-eligible and cost-ineligible.

```text
EligibilityResult {
  eligible: boolean
  scope: descriptive | observational | controlled
  metric
  reasonCodes[]
  includedCount, excludedCount
  coverage: { outcome, token, exactCost, duration, capability }
  dimensionsUsed[]
}
```

Use these reason codes (multiple may apply):

```text
no_explicit_cycle
unmatched_task
unknown_model
auto_selected_model
mixed_model_unattributed
incompatible_model_path
incompatible_host_harness
incompatible_validation_target
incompatible_validation_strength
different_starting_state
capability_confounded
capability_configuration_unknown
no_validated_outcome
no_accepted_outcome
unknown_outcome
incompatible_token_evidence
cost_unavailable
duration_unavailable
provider_infrastructure_interruption
outside_period
duplicate_variant
incomplete_pair
protocol_deviation
insufficient_sample
project_concentration
```

`provider_infrastructure_interruption` is a visible exclusion for
model-quality/validation metrics, not a silent deletion of a record.  Raw
descriptive data remains available even when direct comparison is ineligible.

## Statistics, thresholds, and language

### Statistics

The default statistic is median.  With at least four included units, display
the interquartile range (P25–P75); otherwise show the raw values/range.  Always
show exact `n`, period, project count, outcome/token/cost coverage, exclusions,
and the cohort class.  Do not add p-values, significance badges, confidence
intervals, regression adjustments, or a composite score in Unit 20.

Percent differences use the median and require a nonzero baseline, compatible
metric evidence, and the threshold for a direct comparison.  The UI says
“median was 28% lower in this strongly matched observational cohort,” never
“28% more efficient.”

### Threshold behavior

| Evidence / sample | What may be shown |
| --- | --- |
| 1–2 eligible units per variant | raw observations only, “very limited data”; no median difference or direction |
| 3–4 per variant | median and range, “limited data”; no percentage/directional claim |
| 5–9 per variant | median/IQR where defined and side-by-side values, “limited sample”; no headline or percent-difference claim |
| 10+ eligible attempts **and** 5+ accepted outcomes per observational cohort | strongly matched observational comparison, distributions and carefully qualified median percentage if coverage is compatible |
| 20+ eligible attempts per cohort | may receive a prominent observational summary only if no non-project-specific view has >50% from one project and unknown outcome/token coverage is at most 20% |
| error rate | 20+ compatible denominator events per cohort |
| controlled paired, 1–4 valid pairs | raw pairs only |
| controlled paired, 5–9 valid pairs | limited paired medians/range; no difference claim |
| controlled paired, 10–19 valid pairs | exploratory paired difference with protocol/deviation disclosure |
| controlled paired, 20+ valid pairs | default controlled summary; still no universal winner |

For a project-specific cohort, project concentration is expected but the view
must say so.  Any missingness above 20% makes the warning dominant and
suppresses a comparative summary.  Exact cost always requires 100% coverage,
regardless of sample size.  These gates are product guardrails, not claims of
statistical significance.

## Controlled experiments and user-created cycles

An existing user-created cycle is a useful grouping, but by itself is not a
strongly matched comparison.  It becomes a preferred high-confidence real
world comparison unit only after a user identifies one private objective (or
opaque task key), its variants, and the validation contract.  The dashboard
must not require annotation of every normal session.

Minimum controlled-experiment record:

```text
experimentId, taskSetId, taskSetVersion
primaryValidationContract, primaryMetric
startingRevisionOrFixtureFingerprint, environmentFingerprint?
variants: [{ id, exactModelPath, host, harness, providerPath, capabilityConfiguration }]
assignmentMethod: randomized | alternating | paired-manual
pairId, runOrder, repeatedRunNumber
outcomeEvidenceIds[], modelSegmentIds[], deviationCodes[]
createdBy: user | imported-structured
```

A valid controlled report has a stable benchmark/task identity, matched starting
state, declared variants, repeated runs, same validation contract, measured
result, preserved failures, and recorded missing/protocol deviations.  Order
and randomization/alternation are displayed when relevant.  Unit 20 may import
or report this record later; it must not run the experiment.

## First comparison UI

Keep the current private descriptive Efficiency workspace intact.  Add a
`Comparable observations` section only when at least one Strongly matched or
Controlled cohort is eligible.

```text
Comparable observations                         [7D | Month | Since tracking]
AI Dashboard implementation · Strongly matched observational
Why these are compared: same user-confirmed objective, project, validator,
host/harness, and token definition.  Capabilities matched.  [Explain]

                      n    Median Fresh+Output (IQR)  Validated  Attempts  Exact cost
Claude Sonnet path    4    52K (41K–66K)                3 / 4      1.5       unavailable
Codex path            4    41K (33K–58K)                4 / 4      1.0       unavailable

Limited sample — descriptive side-by-side values, not a claim of superiority.
```

The section is not sorted into a leaderboard and never uses “best,” “winner,”
“smartest,” “quality score,” “productivity,” or an unexplained green/red
verdict.  A capability section uses the same structure and says “Observed
association” for non-controlled cohorts.  Unmatched/loosely matched records
remain in the descriptive view with “Not comparable yet” and the specific
missing evidence.

`Explain` must name cohort source/class, matching dimensions, validation
contract, included/excluded counts and reason codes, sample threshold,
metric/evidence versions, coverage, period, and the causal limitation.  No
comparison details are sent to Share Stats.

## Historical coverage and migration

At this review baseline, 290 session-proxy Work Blocks, 258 timestamped
UsageObservations, 217 structural events, and 7 confirmed capability evidence
records are descriptive evidence.  There are zero safely reconstructed
historical validation-command Attempts.  Consequently, **no historical record
is currently eligible for a Unit 20 outcome-based model or capability
comparison**.  Structured historical validation events may later be displayed
as raw evidence, but cannot bypass the explicit-cycle, validator contract,
attempt, and model-segment gates.

Migration rules:

1. leave indexed sessions and Phase 3A source facts immutable;
2. add comparison records to the local efficiency metadata store, versioned
   separately from index schema and metric definitions;
3. derive deterministic IDs from bounded source IDs; do not backfill outcomes,
   task keys, model segments, or capability use from transcript content;
4. invalidate cached cohorts when boundary, matching, metric, alias, or
   validation-contract versions change, while retaining the old result as
   obsolete metadata; and
5. preserve user-created cycles/outcomes as private reversible data.

## Performance and privacy

Build an incremental local index keyed by changed cycle, attempt, segment,
outcome, and metadata version.  The UI reads cached cohort results; it never
rescans raw transcripts, walks repositories, or calls a provider when a range
changes.  Recalculate only cohorts affected by a changed source/cycle/config.

Persist only opaque source/cycle IDs, normalized identities, bounded validator
and category IDs, timestamps, counts, numeric token/cost values, evidence,
coverage, and hashes/fingerprints.  Do not persist prompt/objective text,
transcript body, source code, command text, terminal/test output, tool
arguments, credentials, account identifiers, raw request IDs, or unredacted
paths.  Private user labels stay out of shares, exports, logs, and screenshots
unless a future explicit policy review authorizes a distinct export.

## Acceptance criteria

Unit 20 is acceptable only when all of the following hold:

- every direct comparison has a visible Controlled or Strongly matched cohort
  descriptor and per-metric eligibility result;
- Work Blocks/session proxies cannot enter an outcome comparison by timestamp
  proximity alone;
- validation and acceptance stay separate, and validator strength/target is
  compatible across variants;
- exact model/path, host/harness, capability configuration, token evidence,
  and exact-cost coverage gates are enforced;
- all thresholds, missingness, project concentration, zero baseline, and
  protocol-deviation suppressions are deterministic and explained;
- mixed-model cycles are excluded unless measured segment/attempt linkage is
  available;
- retries/errors/rework retain their taxonomy and never become a universal
  quality score;
- controlled and observational language remains distinct;
- no comparison data enters Share Stats; and
- fixtures prove privacy exclusions, migration compatibility, incremental
  recomputation, and no change to local-first/network behavior.

## IMPLEMENTATION HANDOFF

### Unit 20.1 — Comparison metadata and migration

**Goal:** Version local comparison descriptors without mutating Phase 3A facts.

**Existing modules to reuse:** `src/efficiency-store.js`, `src/efficiency.js`,
local metadata route patterns, `docs/METRICS.md` versioning.

**Schema changes:** metadata version 2; user cycle fields for opaque
`taskKey`, declared validation contract, variant membership, and private label;
`ComparableCohort` descriptor/cached-result envelope; controlled experiment
record above.

**Implementation steps:** migrate tolerantly; preserve unknown fields where
safe; make user fields reversible; deterministically invalidate cache by
eligibility/metric version; do not backfill old cycles as tasks.

**Invariants:** source scans never overwrite user metadata; labels do not
share; no prompt text or secrets persist.

**Tests:** v1 migration, malformed metadata, reversible cycle edits, cache
invalidation, opaque-ID/privacy snapshots.

**Browser acceptance:** existing Efficiency page works unchanged with old/no
metadata and shows no comparison until explicitly eligible.

**Commit boundary:** metadata/migration only.

### Unit 20.2 — Prospective validation attempts and model segments

**Goal:** Collect enough bounded structural linkage for future cycles without
claiming historical reconstruction.

**Existing modules to reuse:** `src/efficiency.js` structural events,
identity registry, token/evidence helpers.

**Schema changes:** `ValidationContract`, richer `Attempt`, `ModelSegment`,
event-to-cycle/segment linkage, inactivity-gap state.

**Implementation steps:** recognize only existing safe validator categories;
attach repeated validators as rechecks; create segment boundaries from measured
identity/attempt changes; retain Unknown when linkage is absent.

**Invariants:** command/output/prompt content remains in-memory only; no
timestamp-only project/task attribution; inferred retry/rework stays inferred.

**Tests:** pass/fail/recheck, substantive-work boundary, unknown boundary,
mixed-model exclusion, known alias/unknown/auto model, 30-minute gap,
validator compatibility.

**Browser acceptance:** descriptive evidence labels remain accurate; no new
comparison claim yet.

**Commit boundary:** collector/normalizer only.

### Unit 20.3 — Cohort eligibility and coverage engine

**Goal:** Build deterministic Controlled/Strongly-matched/Loose/Unmatched
classification and per-metric exclusions.

**Existing modules to reuse:** Unit 20.1 metadata, Unit 20.2 attempts/segments,
period and token evidence utilities.

**Schema changes:** `EligibilityResult`, reason-code enum, coverage envelope.

**Implementation steps:** apply required dimensions and compatibility tables;
return every exclusion; apply missingness, project concentration, pair and
protocol-deviation rules; retain descriptive records.

**Invariants:** no task inference from temporal proximity; cost eligibility is
independent of token eligibility; provider outages do not become model errors.

**Tests:** every reason code, compatible/incompatible validators, host/harness
stratification, capability confounder, partial exact cost, duplicate/incomplete
pairs, unknown outcomes, current historical zero-eligible fixture.

**Browser acceptance:** an Explain payload can state precisely why each sample
is or is not comparable.

**Commit boundary:** engine and fixtures only.

### Unit 20.4 — Metric and statistics engine

**Goal:** Compute eligible distributions, not scores or rankings.

**Existing modules to reuse:** `src/tokens.js`, cost evidence helpers, Unit
20.3 eligibility outputs.

**Schema changes:** versioned metric-result envelope with median, IQR/range,
raw `n`, coverage, and exclusions.

**Implementation steps:** calculate Fresh+Output, validation/attempt measures,
exact-cost-until-validation, and qualifying duration only after eligibility;
implement all suppression/threshold rows exactly as specified.

**Invariants:** cache is diagnostic; subscriptions are not dollars; final
successful attempt alone is not total cost; no p-values/score/winner.

**Tests:** skewed distributions, median/IQR, zero baseline, n 1–2/3–4/5–9/10/
20 thresholds, 20% missingness, project concentration, 100% exact cost,
provider interruption, deterministic time zones.

**Browser acceptance:** API result is stable, explainable, and does not fetch
network data or raw transcripts.

**Commit boundary:** metrics only.

### Unit 20.5 — Private observational comparison UI

**Goal:** Present only eligible cohorts and their limitations.

**Existing modules to reuse:** existing Efficiency workspace and DD styling,
Unit 20.4 metric envelope, current responsive table/card patterns.

**Schema changes:** none beyond a local selected-cohort preference.

**Implementation steps:** add the Comparable observations section, cohort
selection, distribution/coverage views, limited-data states, and Explain;
keep unmatched work in descriptive evidence readiness.

**Invariants:** no leaderboard, universal score, causal wording, Share Stats
integration, or automatic recommendations.

**Tests:** UI copy/states, all threshold messages, unavailable metric columns,
Explain reason codes, mobile/keyboard/no-overflow, share exclusion.

**Browser acceptance:** 390px, 1366px, 1440px, 1920px, and 200% zoom; no console
errors; controlled versus observational badge is prominent.

**Commit boundary:** observational UI only.

### Unit 20.6 — Controlled report import and display

**Goal:** Report, but do not run, valid controlled trials after independent
review of the import boundary.

**Existing modules to reuse:** Unit 20.1 experiment metadata and Unit 20.4
paired statistic results.

**Schema changes:** strict imported trial/protocol/deviation validation.

**Implementation steps:** accept only bounded, privacy-safe records; preserve
failed/missing runs and run order; render paired raw/distribution views and
protocol limitations.

**Invariants:** no external credentials/network calls, no silent assignment,
no causal claim below controlled thresholds, and no import of prompts/code.

**Tests:** malformed/oversized/private fields, incomplete pairs, order effects,
protocol deviation, n 1–4/5–9/10/20 thresholds, share/export exclusion.

**Browser acceptance:** a controlled report visibly names task set, variant
paths, validation contract, pairs, deviations, and the non-universal scope.

**Commit boundary:** controlled reporting; requires frontier merge review.
