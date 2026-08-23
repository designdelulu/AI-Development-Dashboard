import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export function runtimeToken() { return crypto.randomBytes(32).toString('hex'); }
export function readRuntime(file) { try { const value = JSON.parse(fs.readFileSync(file, 'utf8')); return value && typeof value === 'object' ? value : null; } catch { return null; } }
export function writeRuntime(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); const temp = `${file}.${process.pid}.${Date.now()}.tmp`; fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 }); fs.renameSync(temp, file); return value; }
export function removeRuntime(file) { try { fs.unlinkSync(file); } catch {} }

export function removeRuntimeIfOwned(file, owner = {}) {
  const current = readRuntime(file);
  if (!current || (owner.pid != null && current.pid !== owner.pid) || (owner.instanceId && current.instanceId !== owner.instanceId)) return false;
  removeRuntime(file);
  return true;
}
export function processAlive(pid) { try { process.kill(Number(pid), 0); return true; } catch { return false; } }
export function validRuntime(record, { script = null } = {}) { return Boolean(record && Number.isInteger(record.pid) && record.pid > 0 && processAlive(record.pid) && (!script || record.script === script)); }

export function processCommand(pid, { run = execFileSync } = {}) {
  try {
    return String(run('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8', timeout: 750, stdio: ['ignore', 'pipe', 'ignore'] }) || '').trim();
  } catch { return null; }
}

// PID reuse is possible after a crash. A verified command-line match is
// required before the lifecycle fallback is allowed to signal a process.
export function ownsProcess(record, { script = null, command = processCommand } = {}) {
  if (!record || !Number.isInteger(record.pid) || record.pid <= 0 || !processAlive(record.pid)) return false;
  if (script && record.script !== script) return false;
  const observed = command(record.pid);
  if (!observed) return false;
  const normalized = observed.replace(/\\/g, '/');
  const expected = String(record.script || script || '').replace(/\\/g, '/');
  return Boolean(expected && (normalized.includes(expected) || normalized.includes(path.basename(expected))));
}
