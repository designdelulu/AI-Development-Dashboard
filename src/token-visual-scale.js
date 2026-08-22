import { freshPlusOutput, localDateKey, localDayStart } from './tokens.js';

// Token reports retain local-day buckets, not a synthetic streaming clock. The
// adaptive meter therefore compares one local calendar day with other complete
// local calendar days. It is a display aid only: report totals are unchanged.
export const TOKEN_VISUAL_SCALE_VERSION = 1;
export const TOKEN_VISUAL_BUCKET = 'local-day';
export const TOKEN_VISUAL_BUCKET_LABEL = '1 local calendar day';
export const TOKEN_VISUAL_RECENT_DAYS = 30;
export const TOKEN_VISUAL_MIN_SAMPLES = 7;
export const TOKEN_VISUAL_HEADROOM = 1.25;
export const TOKEN_VISUAL_BOOTSTRAP_FLOOR = 100_000;

const finite = (value) => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const percentile = (values, ratio) => {
  const sorted = values.map(finite).filter((value) => value != null).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
};
const bucketValue = (day) => finite(freshPlusOutput(day?.tokens));

function observedBuckets(calendar = {}, now = new Date()) {
  const currentDate = localDateKey(now);
  const currentStart = localDayStart(currentDate).getTime();
  return Object.values(calendar.days || {}).map((day) => ({
    date: day.date,
    value: bucketValue(day),
    evidence: day.evidence || 'unavailable',
    complete: localDayStart(day.date).getTime() < currentStart
  })).filter((bucket) => bucket.date && bucket.value != null).sort((a, b) => a.date.localeCompare(b.date));
}

// A record is announced only when the bucket that was current on the prior
// scan closes. Older imported/backfilled buckets can improve retained history
// but never create a faux live record notification.
export function buildTokenVisualScale(calendar = {}, previous = null, now = new Date()) {
  const buckets = observedBuckets(calendar, now);
  const currentDate = localDateKey(now);
  const completed = buckets.filter((bucket) => bucket.complete);
  const recent = completed.slice(-TOKEN_VISUAL_RECENT_DAYS);
  const recentValues = recent.map((bucket) => bucket.value);
  const recentP95 = percentile(recentValues, 0.95);
  const learned = recent.length >= TOKEN_VISUAL_MIN_SAMPLES;
  const bootstrapHigh = recentValues.length ? Math.max(...recentValues) : 0;
  const baseline = learned ? recentP95 : bootstrapHigh;
  const ceiling = Math.max(TOKEN_VISUAL_BOOTSTRAP_FLOOR, Math.ceil((baseline || 0) * TOKEN_VISUAL_HEADROOM));
  const priorHigh = finite(previous?.lifetimeHigh?.value) || 0;
  const historicalHigh = completed.reduce((best, bucket) => bucket.value > best.value ? bucket : best, { value: priorHigh, date: previous?.lifetimeHigh?.date || null, evidence: previous?.lifetimeHigh?.evidence || 'unavailable' });
  const lifetimeHigh = { value: historicalHigh.value, date: historicalHigh.date, evidence: historicalHigh.evidence };
  const current = buckets.find((bucket) => bucket.date === currentDate) || { date: currentDate, value: 0, evidence: 'unavailable', complete: false };
  const closedCurrent = completed.find((bucket) => bucket.date === previous?.current?.date) || null;
  let record = null;
  if (closedCurrent && closedCurrent.value > 0 && closedCurrent.value > priorHigh) {
    record = { date: closedCurrent.date, value: closedCurrent.value, evidence: closedCurrent.evidence, previousHigh: priorHigh || null, previousCeiling: finite(previous?.recent?.visualCeiling) || TOKEN_VISUAL_BOOTSTRAP_FLOOR };
  } else if (previous?.record && previous?.current?.date === currentDate) {
    record = previous.record;
  }
  return {
    version: TOKEN_VISUAL_SCALE_VERSION,
    metric: 'fresh-plus-output',
    bucket: { id: TOKEN_VISUAL_BUCKET, label: TOKEN_VISUAL_BUCKET_LABEL },
    current: { date: current.date, value: current.value, evidence: current.evidence, ratio: ceiling ? Math.min(1, current.value / ceiling) : 0 },
    recent: { days: TOKEN_VISUAL_RECENT_DAYS, sampleCount: recent.length, p95: recentP95, learned, visualCeiling: ceiling, headroom: TOKEN_VISUAL_HEADROOM, bootstrapFloor: TOKEN_VISUAL_BOOTSTRAP_FLOOR },
    lifetimeHigh,
    record,
    recomputable: 'Available normalized local-day buckets; no transcript reread is required.',
    computedAt: new Date(now).toISOString()
  };
}
