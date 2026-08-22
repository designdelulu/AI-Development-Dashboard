# Efficiency Analytics Plan

Research date: 2026-08-22. This plan defines observational analytics and controlled-experiment support. It explicitly does not turn token volume, speed, commits, or tool use into a productivity score.

## Product decision

Do not ship a single “efficiency score.” Ship an evidence ladder:

1. **Descriptive usage** — what was observed: token categories, cost semantics, duration evidence, requests, cache, errors, tools, model, project.
2. **Comparable task cohorts** — how distributions differ for tasks with the same boundary, outcome class, and evidence requirements.
3. **Controlled trials** — paired or randomized attempts where the user deliberately changes one model/capability and records the evaluation.

The dashboard may say “Model A used a median 24% fewer fresh+output tokens in 12 comparable completed tasks.” It may not say “Model A is 24% more productive” or “Skill X saved $40” unless a controlled design and provider-billed counterfactual actually justify that wording.

## Why restraint is necessary

Agentic tasks can vary substantially between repeated runs, and higher token use does not imply higher accuracy. Recent empirical work reports large within-task variance and weak model self-prediction of token cost. This supports distributions, cohorts, and minimum samples rather than point-score rankings. [Agent token-consumption study](https://arxiv.org/abs/2604.22750)

The current dashboard already protects important foundations in `docs/METRICS.md`: token categories are separate, evidence is Exact/Estimated/Mixed/Unavailable, project attribution is confidence-bearing, and current period comparisons require consistent definitions. Extend those semantics; do not replace them.

## Event and schema additions

Increment the normalized schema only after fixtures exist. Keep event facts separate from inferred cycles.

### `UsageObservation`

Extend existing normalized usage events with optional fields:

```text
usageObservationId
sourceId, sourceRecordId, adapterVersion
sessionId, requestId?, generationId?
occurredAt, observedAt
identity: { host, harness?, agent, provider?, modelRaw, modelId? }
project: { id?, confidence, evidenceCode }
tokens: {
  freshInput?, output?, cacheRead?, cacheCreation?, reasoningOther?,
  evidence, derivationCode?
}
cost: {
  amount?, currency?, semantic:
    provider-billed | list-price-equivalent | subscription-credit | unavailable,
  pricingVersion?, coverage?
}
request: { status?, latencyMs?, providerLatencyMs?, finishReason?, retryGroupId? }
capabilityEvidenceIds: []
privacyClass: structural-only
```

Never store prompt/response bodies to infer task type or quality.

### `WorkCycle`

A work cycle is an analyst-visible grouping, not automatically a “task”:

```text
cycleId
projectId
startedAt, endedAt?
boundaryMethod
boundaryConfidence
sessionIds[]
attemptIds[]
outcomeId?
labels[]             // user labels or safe structured source labels only
supersedesCycleId?
```

### `Attempt`

```text
attemptId, cycleId
startedAt, endedAt?
model/provider/host/harness cohort
usage observation IDs
result: completed | cancelled | failed | superseded | unknown
errorEvents[]
reworkLinks[]
capabilityEvidenceIds[]
```

### `OutcomeEvidence`

```text
outcomeId, cycleId
state: accepted | partially-accepted | rejected | reverted | abandoned | unknown
evidenceClass: user-confirmed | test-result | git-structural | host-structured | inferred
checks: [{ kind, status, observedAt, source }]
recordedAt
```

Test status and Git structure are evidence, not semantic correctness. A green test run does not prove the feature satisfies the user's intent.

### `CapabilityEvidence`

```text
evidenceId
capabilityId, capabilityVersionOrCommit?
host, projectId?, sessionId?, attemptId?
class: confirmed-invocation | enabled-present | controlled-assignment
source, observedAt
details: { commandId?, hookId?, toolName?, trialArm? } // bounded IDs only
```

Presence never upgrades to invocation.

## Task and cycle boundaries

Use the strongest available boundary and retain how it was derived:

1. **Explicit controlled trial/task ID** — strongest; a user or harness defines one goal and arms.
2. **Structured host task/session marker** — request/task start and completion events with stable IDs.
3. **User-confirmed grouping** — user joins/splits sessions in the dashboard and optionally records outcome.
4. **Harness job/worker grouping** — when the harness explicitly models one job and child workers.
5. **Session as proxy** — descriptive only, not automatically comparable.
6. **Temporal/Git inference** — suggestion for review, never accepted silently.

Do not use prompt similarity, transcript text classification, branch name interpretation, or “same day/project” as a hidden task boundary.

Cycles may span several sessions/models. Attempts may be nested or parallel. The UI must make user edits reversible and preserve original source relationships.

## Error and rework taxonomy

### Errors

Record only structured evidence:

- `provider_error` — documented request failure/status;
- `rate_limit` — documented quota/rate-limit event;
- `tool_error` — structured non-zero/error result without arguments/output bodies;
- `validation_failed` — explicit test/lint/build/check failure;
- `cancelled_by_user` — host marker;
- `timeout` — host/harness marker;
- `adapter_parse_error` — telemetry quality issue, excluded from model performance;
- `unknown_failure` — failure known, class unknown.

An error count needs a denominator: per attempt/request/tool invocation. Cross-source error rates are compared only when event coverage and definitions match.

### Rework

Use conservative classes:

- `retry_same_attempt` — provider/harness retry group explicitly links requests;
- `resume_after_failure` — structured failure then later attempt in same cycle;
- `superseded_attempt` — user/harness marks later attempt as replacement;
- `reverted_change` — a confirmed Git revert/restore links to the cycle;
- `user_marked_redo` — user explicitly marks it;
- `possible_rework` — heuristic suggestion excluded from headline metrics until confirmed.

“Multiple turns,” many tool calls, or a second model are not automatically rework. They may be normal task structure.

## Model metrics

### Safe descriptive metrics

- observed sessions/cycles/attempts;
- fresh input, output, cache read, cache creation, reasoning/other;
- provider-billed cost and list-price equivalent in separate columns;
- request/tool/error counts with coverage;
- observed elapsed duration and active-dashboard duration, separately labeled;
- result and outcome distributions;
- confirmed retry/rework counts;
- project and task-category distribution where categories are explicit.

### Comparable-cohort metrics

For eligible cohorts:

- median and interquartile range of fresh+output tokens per accepted cycle;
- provider-billed cost per accepted cycle;
- list-price equivalent per accepted cycle, with pricing coverage;
- completion/acceptance proportion with confidence interval;
- median attempts and confirmed retries per accepted cycle;
- median wall time only when start/end definitions match;
- cache composition as a diagnostic, not a quality score.

Always show all eligible outcomes, not only accepted successes. Report excluded records and why.

### Cohort matching

Comparable cohorts require:

- same explicit task family or controlled task definition;
- same outcome evidence requirement;
- same metric version and token/cost semantics;
- compatible host/harness mode or an explicit dimension showing the difference;
- project/language/context bands when these are known and materially imbalanced;
- no Mixed/Estimated inclusion in an Exact-only claim.

Observational matching is labeled **Strongly matched observational comparison**, never an experiment. The first release exposes the matching dimensions rather than claiming regression adjustment, and prefers filters and distributions over an opaque score.

## Skill and capability efficiency

### Evidence classes

1. **Confirmed invocation:** a structured skill/tool/plugin/hook ID was invoked in the attempt.
2. **Enabled/present:** it was installed or enabled for the host/project but invocation is unknown.
3. **Controlled assignment:** a trial deliberately enables/disables or selects the capability for an arm, and adherence is recorded.

Only class 1 may support “sessions using X.” Only class 3 may support causal language after adequate controlled evidence. Class 2 supports adoption/coverage analysis only.

### Observational views

- invocation count and eligible attempts;
- projects/hosts/models where invoked;
- token/cost/outcome distributions with vs without invocation, clearly confounded;
- invocation timing if structured, without displaying content;
- capability version/commit so updates do not mix interventions.

Do not attribute an entire session's cost to every enabled skill. When several capabilities are invoked, show co-occurrence and avoid additive “savings.”

### Controlled A/B support

A trial specification includes:

```text
trialId, hypothesis, taskSetVersion
arms: [{ model?, capabilityAssignment?, host/harness?, version }]
assignmentMethod: randomized | alternating | paired-manual
primaryMetric, outcomeRubric
stoppingRule, minimumPairs
environmentFingerprint
```

The dashboard can import or observe a harness's trial IDs; it does not need to run the harness. Preserve failures and unsuccessful attempts. A user-visible trial report includes protocol deviations and missing telemetry.

Caveman is a useful test case because its current CLI exposes `learn`, `stats`, and `trial` concepts and emphasizes evidence classes. Its upstream benchmarks remain external claims; only local controlled assignments and observed outcomes enter dashboard conclusions. [Caveman](https://github.com/JuliusBrussee/caveman)

## Cost semantics

Never sum across these meanings without separate subtotals:

- **Provider-billed cost:** exact monetary amount returned by a billing/usage source such as OpenRouter.
- **List-price equivalent:** calculation from observed tokens and a versioned price catalog.
- **Subscription credit:** provider-specific unit consumed from a plan; not USD unless the provider explicitly defines the conversion.
- **Subscription capacity:** percentage/window remaining; not cost.
- **Unknown/unpriced:** excluded from money totals and included in coverage.

OpenRouter is especially useful because documented usage responses/generation detail can include exact native token categories and exact cost, while its model catalog supplies current pricing. The dashboard should still store which endpoint supplied each amount. [OpenRouter usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting), [model catalog](https://openrouter.ai/docs/guides/overview/models)

Pricing catalogs are time-versioned. Do not reprice historical “provider-billed” amounts. A user may choose to recalculate list-price equivalents with current prices, but the UI must distinguish original pricing snapshot from recalculated scenario.

## Minimum evidence thresholds

Defaults are product guardrails, not statistical proof:

- descriptive row: 1 observation, explicitly marked small sample;
- period-over-period directional comparison: at least 5 eligible observations in each period;
- observational model/capability comparison: at least 10 eligible attempts and 5 accepted outcomes per cohort, with distributions shown;
- headline comparative statement: at least 20 eligible attempts per cohort and no single project contributing more than 50%, unless the view is explicitly project-specific;
- paired controlled trial: at least 10 valid pairs for an exploratory result; 20 pairs before a default headline;
- error rate: at least 20 eligible denominator events per cohort;
- no ranking with more than 20% unknown outcome or cost/token coverage unless the missingness warning is dominant.

Show exact `n`, project count, date range, exclusions, and missingness. Suppress percent change when the baseline is zero or too small; show raw distributions instead. Confidence intervals should use a documented routine and metric version, not decorative precision.

## UI concept

Add an **Efficiency** workspace only after WorkCycle and OutcomeEvidence exist.

### Level 1: Evidence readiness

- eligible cycles, outcome coverage, token evidence mix, cost coverage;
- explicit message explaining what comparisons are currently possible;
- actions: Review suggested cycles, Record outcome, Create/import trial.

### Level 2: Compare

- selector: Model, Capability, Host, Harness;
- cohort filters and a prominent Observational / Controlled label;
- median/IQR cards for primary metric, acceptance, attempts/rework, and cost semantic;
- compact distribution plot rather than a single winner number;
- coverage/exclusion drawer.

### Level 3: Explain

- metric definition/version;
- task boundary and outcome evidence rules;
- included IDs and reversible cohort definition;
- capability invocation evidence and version;
- pricing source/version;
- limitations and prohibited interpretation.

No green/red “winner” until a controlled trial meets the threshold. Even then, say “lower median cost under this trial” rather than “best model.”

## Schema migration and compatibility

- retain existing session/index fields and derive UsageObservation IDs deterministically;
- introduce WorkCycles in a separate dashboard-local store so rescans do not overwrite user joins/outcomes;
- version `metricDefinitions` independently of index schema;
- do not retroactively infer confirmed capability invocation or outcomes from old sessions;
- historical sessions can participate in descriptive usage, then gain user-confirmed cycles/outcomes without changing original source data;
- changing a boundary/metric definition invalidates cached cohort results and records the old result as obsolete.

## Implemented Phase 3A foundation

Metric-definition version 3.0 implements the normalized private event layer and evidence-readiness workspace. Existing indexed token-day records backfill `UsageObservation` deterministically. Current Claude/Codex structured records may contribute tool-call, tool-error, recognized validator, numeric exit, rate-limit/provider-error, retry-count, and task-complete markers where those fields actually exist. Work Blocks use the documented `session-proxy` method; attempts are validation-scoped; no historical Task or accepted outcome is fabricated. User-confirmed outcomes are separate reversible local metadata. The first UI deliberately stops at descriptive rows and evidence readiness; Unit 20 comparative distributions and controlled reports remain unimplemented.

## Unit 20 comparison decision record

The frontier semantic review is frozen in [EFFICIENCY-COMPARISON-SPEC.md](EFFICIENCY-COMPARISON-SPEC.md). Unit 20 must use Work Cycles rather than session-proxy Work Blocks as comparison units; keep validation evidence distinct from user/structured acceptance evidence; and classify cohorts as Controlled, Strongly matched, Loosely matched, or Unmatched. Only the first two may receive direct comparison surfaces.

Direct model claims require an exact normalized model/execution path, compatible host/harness, explicit task/cycle boundary, compatible named validation contract, matching metric/evidence definition, and disclosed capability configuration. Cross-host observations are execution-path comparisons, not model-only comparisons. Mixed-model cycles are excluded until measured segment-to-attempt linkage exists. Exact provider cost is comparison-eligible only when deterministically linked to every included cycle/segment; aggregate OpenRouter cost remains descriptive.

The existing threshold defaults are now exact UI gates: 1–2 units raw only; 3–4 median/range only; 5–9 limited side-by-side values; 10 eligible attempts plus 5 accepted outcomes per cohort for a strongly matched observational comparison; 20 eligible attempts for a prominent observational summary subject to the 50% project-concentration and 20% missingness gates. Controlled paired work is raw at 1–4 pairs, limited at 5–9, exploratory at 10–19, and receives the default controlled summary at 20 valid pairs. Error rates require 20 compatible denominator events; exact-cost metrics require 100% exact-cost coverage.

At the review baseline, the 290 session-proxy Work Blocks, 258 timestamped UsageObservations, 217 structural events, and 7 confirmed CapabilityEvidence records remain descriptive. With zero safely reconstructed historical validation-command Attempts, no historical record is eligible for an outcome-based Unit 20 comparison. This is an intentional empty state, not a backfill target.

## Tests

- deterministic observation/cycle/attempt IDs and deduplication;
- midnight/timezone splits and multi-session cycles;
- retries do not double-count provider usage and failed-attempt usage is retained;
- error/rework taxonomy never reads or classifies message bodies;
- enabled capability does not become confirmed invocation;
- mixed capability versions are split or warned;
- cost semantic subtotals cannot be accidentally summed;
- missing/unpriced coverage and exclusions are correct;
- minimum thresholds, zero baselines, dominant projects, unknown outcomes, and small samples suppress claims;
- user join/split/outcome edits are reversible and survive rescans;
- controlled-trial protocol deviations remain visible;
- share/export excludes private project/task labels unless explicitly safe.

## What not to claim

- productivity, developer performance, intelligence, or code quality from telemetry alone;
- causation from observational cohorts;
- “saved” tokens/cost without a valid counterfactual;
- subscription dollars saved from API list prices;
- skill use when only installation is known;
- one-shot success from one session/turn count alone;
- redo/error from silence, extra turns, or model switching;
- faster remote inference from local file activity;
- universal best model across projects/tasks;
- precise comparisons when evidence definitions differ.

## Frontier review checkpoints

Require high-reasoning review for WorkCycle boundaries, outcome/evidence semantics, cost-category naming, comparison eligibility, minimum-sample/interval implementation, controlled-trial claims, and privacy of task labels. Routine parsers, stores, filters, and charts can be implemented by a lower-cost model after these contracts are frozen.
