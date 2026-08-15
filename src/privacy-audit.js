import fs from 'node:fs';
import path from 'node:path';

const SECRET = /(sk-[A-Za-z0-9_-]{12,}|AKIA[0-9A-Z]{16}|BEGIN (RSA |OPENSSH )?PRIVATE KEY|api[_-]?key\s*[:=]\s*['\"][^'\"]+['\"]|ANTHROPIC_API_KEY\s*=\s*\S+|OPENAI_API_KEY\s*=\s*\S+)/i;
const ENV_FILE = /(^|\/)\.env($|\.)/;
const DASHBOARD_DATA = /(^|\/)\.dashboard-data(\/|$)/;
const HANDOFF = /\.handoff\.md$/;
const OWNER_PATH = /\/Users\/ericbarker\//i;
const PLACEHOLDER_PATH = /\/Users\/x\//;

const SKIP_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.woff', '.woff2']);

export function auditText(text, filename = '') {
  const findings = [];
  const relative = filename.replace(/\\/g, '/');
  if (ENV_FILE.test(relative) && !relative.endsWith('.env.example')) findings.push({ file: relative, kind: 'env-file', detail: 'Environment file should not be tracked.' });
  if (DASHBOARD_DATA.test(relative)) findings.push({ file: relative, kind: 'local-analytics', detail: 'Generated dashboard data should not be tracked.' });
  if (HANDOFF.test(relative)) findings.push({ file: relative, kind: 'handoff', detail: 'Handoff artifacts should not be tracked.' });
  if (SECRET.test(text)) findings.push({ file: relative, kind: 'secret', detail: 'Possible credential or private key material.' });
  if (OWNER_PATH.test(text) && !PLACEHOLDER_PATH.test(text) && !/\.md$/.test(relative)) {
    findings.push({ file: relative, kind: 'absolute-owner-path', detail: 'Tracked source contains an owner-specific absolute path.' });
  }
  return findings;
}

export function auditTree(root, files) {
  const findings = [];
  for (const file of files) {
    const relative = file.replace(/\\/g, '/');
    if (SKIP_EXT.has(path.extname(relative).toLowerCase())) continue;
    let text = '';
    try { text = fs.readFileSync(path.join(root, file), 'utf8'); } catch { continue; }
    if (relative.startsWith('test/')) continue;
    findings.push(...auditText(text, relative));
  }
  return findings;
}
