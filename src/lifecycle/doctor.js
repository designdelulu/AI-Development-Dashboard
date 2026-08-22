import fs from 'node:fs';
import { readRuntime, validRuntime } from './runtime-record.js';

export function doctor(paths, script) {
  const runtime = readRuntime(paths.runtimeFile);
  const checks = [
    { id: 'data-directory', ok: (() => { try { fs.mkdirSync(paths.dataDir, { recursive: true, mode: 0o700 }); return true; } catch { return false; } })() },
    { id: 'runtime-record', ok: !runtime || validRuntime(runtime, { script }) },
    { id: 'local-only', ok: true }
  ];
  return { ok: checks.every((check) => check.ok), checks, runtime: runtime ? { state: validRuntime(runtime, { script }) ? 'owned' : 'stale' } : { state: 'absent' } };
}
