# Metrics

Metric definitions version: 2.0.

## Token fields

| Display field | Meaning | Never interpreted as |
| --- | --- | --- |
| Fresh input | Provider `input_tokens` excluding cache fields. | Subscription quota or billed tokens. |
| Output tokens | Provider `output_tokens`. | Completed work or quality. |
| Cache read | Provider `cache_read_input_tokens`; previously processed context reused by the provider. | Fresh user input. |
| Cache creation | Provider `cache_creation_input_tokens`; context written to cache where exposed. | Fresh user input. |
| Reasoning / other | Provider-specific explicit fields, if supplied. | A comparable cross-provider measure unless documented by that provider. |
| Total observed token activity | Sum of the above observed categories. Useful for describing model work; deliberately not called “tokens used.” | Subscription billing, plan allowance, or API cost. |

Missing fields remain unavailable/zero in their category. A zero never means a provider used no tokens; it may mean the local source does not expose that field.

## Attribution and efficiency

**Confirmed** project attribution uses a recorded session `cwd` that falls inside a discovered Git root. **Strongly inferred** attribution uses a deterministic encoded Cursor/Claude project folder. Weak/Unknown sessions remain visible in global counts but do not affect project headlines or comparable efficiency.

Tokens per session, cache-read ratio and tools per session compare rolling 30-day periods only when both periods have at least three eligible observations and identical definitions. Git changes and LOC are descriptive context, never productivity scores.
