import { readPlanCapacity } from './capacity.js';

// Capacity collection can walk provider-local stores. Keep that work outside
// the dashboard HTTP event loop. The parent passes only the small lifecycle
// source-state metadata required to decide which optional actions are shown.
let sourceStates = {};
try {
  const parsed = JSON.parse(process.argv[2] || '{}');
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) sourceStates = parsed;
} catch {}

try {
  process.stdout.write(JSON.stringify(readPlanCapacity(undefined, { sourceStates })));
} catch (error) {
  process.stderr.write(String(error?.message || 'Capacity collection failed.'));
  process.exitCode = 1;
}
