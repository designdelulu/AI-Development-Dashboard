import fs from 'node:fs';
import path from 'node:path';

const MAX_LINES = 160;
const MAX_BYTES = 48 * 1024;

function safeMessage(value) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\/Users\/[^\s/]+/g, '[user]')
    .replace(/\/private\/tmp\/[^\s/]+/g, '[temp]')
    .replace(/(?:^|\s)\/(?:private|tmp|var|home)\/[^\s]+/g, (value) => value.startsWith(' ') ? ' [local-path]' : '[local-path]')
    .replace(/(?:[A-Za-z]:)?\\Users\\[^\s\\]+/g, '[user]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 260);
}

export function appendLifecycleEvent(file, event = {}) {
  if (!file) return false;
  const record = {
    at: typeof event.at === 'string' ? event.at : new Date().toISOString(),
    stage: safeMessage(event.stage || 'unknown').slice(0, 80),
    code: safeMessage(event.code || '').slice(0, 80) || null,
    message: safeMessage(event.message || '').slice(0, 260) || null,
    durationMs: Number.isFinite(event.durationMs) ? Math.max(0, Math.round(event.durationMs)) : undefined
  };
  if (record.durationMs === undefined) delete record.durationMs;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
    lines.push(JSON.stringify(record));
    let kept = lines.slice(-MAX_LINES);
    while (Buffer.byteLength(kept.join('\n') + '\n') > MAX_BYTES && kept.length > 1) kept = kept.slice(1);
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${kept.join('\n')}\n`, { mode: 0o600 });
    fs.renameSync(temporary, file);
    return true;
  } catch {
    return false;
  }
}

export function readLifecycleEvents(file, limit = 40) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-Math.max(0, limit)).flatMap((line) => {
      try {
        const value = JSON.parse(line);
        return value && typeof value === 'object' ? [{
          at: typeof value.at === 'string' ? value.at : null,
          stage: safeMessage(value.stage),
          code: safeMessage(value.code) || null,
          message: safeMessage(value.message) || null,
          ...(Number.isFinite(value.durationMs) ? { durationMs: Math.max(0, Math.round(value.durationMs)) } : {})
        }] : [];
      } catch { return []; }
    });
  } catch { return []; }
}

export { MAX_BYTES as LIFECYCLE_LOG_MAX_BYTES, MAX_LINES as LIFECYCLE_LOG_MAX_LINES };
