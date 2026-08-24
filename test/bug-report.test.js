import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildDiagnostics, configuredReportEndpoint, createBugReport, submitBugReport, validateScreenshot, writeBugReportBundle } from '../src/bug-report.js';

const temp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));

test('bug diagnostics are allowlisted and exclude secrets, content, notes, and absolute paths', () => {
  const diagnostics = buildDiagnostics({
    version: '0.1.0',
    commit: 'abc1234',
    lifecycle: { state: 'error', port: 4177, portOccupied: true, portOwner: 'occupied-unknown', healthState: 'unavailable', startupStage: 'health-check' },
    counts: { projects: 2, sessions: 4 },
    permissions: { localRead: true, networkConnected: false },
    secret: 'sk-obvious-fake-secret',
    prompt: 'Never include this prompt body',
    path: '/Users/ericbarker/Private/Project',
    adapters: [{ id: 'Claude', installed: true, capabilities: ['history'] }]
  });
  const text = JSON.stringify(diagnostics);
  assert.equal(text.includes('sk-obvious-fake-secret'), false);
  assert.equal(text.includes('Never include this prompt body'), false);
  assert.equal(text.includes('/Users/ericbarker/Private/Project'), false);
  assert.equal(diagnostics.lifecycle.port, 4177);
  assert.equal(diagnostics.lifecycle.portOccupied, true);
  assert.equal(diagnostics.lifecycle.portOwner, 'occupied-unknown');
  assert.equal(diagnostics.lifecycle.healthState, 'unavailable');
  assert.equal(diagnostics.adapters[0].id, 'Claude');
});

test('bug report bundles include only an explicitly selected image and bounded metadata', () => {
  const root = temp('bug-report');
  const report = createBugReport({ description: 'The dashboard timed out.', context: 'Opening after an update.', includeDiagnostics: true, diagnostics: { lifecycle: { state: 'error' }, prompt: 'excluded' }, now: () => Date.parse('2026-08-22T00:00:00Z'), randomBytes: () => Buffer.from('abcdef12', 'hex') });
  const screenshot = { name: 'screen.png', type: 'image/png', size: 5, data: `data:image/png;base64,${Buffer.from('hello').toString('base64')}` };
  const saved = writeBugReportBundle(root, report, { screenshot });
  assert.equal(report.reportId, 'ADR-20260822-ABCDEF');
  assert.equal(fs.existsSync(saved.reportFile), true);
  assert.equal(fs.existsSync(saved.screenshotFile), true);
  const stored = JSON.parse(fs.readFileSync(saved.reportFile, 'utf8'));
  assert.equal(JSON.stringify(stored).includes('excluded'), false);
  assert.equal(JSON.stringify(stored).includes('data:image'), false);
  assert.equal(fs.statSync(saved.reportFile).mode & 0o077, 0);
  const noImage = writeBugReportBundle(root, createBugReport({ description: 'No image', includeDiagnostics: false }));
  assert.equal(noImage.screenshotFile, null);
});

test('screenshot validation accepts supported types and rejects unsafe or oversized input', () => {
  assert.equal(validateScreenshot({ type: 'image/png', size: 100 }).valid, true);
  assert.equal(validateScreenshot({ type: 'image/jpeg', size: 100 }).valid, true);
  assert.equal(validateScreenshot({ type: 'image/svg+xml', size: 100 }).valid, false);
  assert.equal(validateScreenshot({ type: 'image/png', size: 6 }, { maxBytes: 5 }).valid, false);
});

test('report transport is inert without an explicit HTTPS endpoint and handles mocked success/failure', async () => {
  let calls = 0;
  const report = createBugReport({ description: 'Transport test' });
  assert.equal(configuredReportEndpoint({ AI_DASHBOARD_BUG_REPORT_ENDPOINT: 'http://insecure.test' }), null);
  assert.equal((await submitBugReport(report, { endpoint: null, fetchImpl: async () => { calls++; } })).state, 'not-configured');
  assert.equal(calls, 0);
  const ok = await submitBugReport(report, { endpoint: 'https://support.example.test/report', fetchImpl: async () => ({ ok: true, status: 201, json: async () => ({ reference: 'ADR-remote-1' }) }) });
  assert.equal(ok.state, 'sent');
  assert.equal(ok.reference, 'ADR-remote-1');
  const failed = await submitBugReport(report, { endpoint: 'https://support.example.test/report', fetchImpl: async () => ({ ok: false, status: 503 }) });
  assert.equal(failed.state, 'error');
});

test('CLI report-bug works while the dashboard is stopped', () => {
  const dataDir = temp('bug-cli-data');
  const env = { ...process.env, AI_DASHBOARD_DATA_DIR: dataDir };
  const output = execFileSync(process.execPath, ['src/cli.js', 'report-bug', '--description', 'Startup timeout dry run', '--no-diagnostics'], { cwd: path.resolve(new URL('..', import.meta.url).pathname), env, encoding: 'utf8' });
  assert.match(output, /Report bundle created/);
  const reports = fs.readdirSync(path.join(dataDir, 'bug-reports'));
  assert.equal(reports.length, 1);
  const stored = JSON.parse(fs.readFileSync(path.join(dataDir, 'bug-reports', reports[0], 'report.json'), 'utf8'));
  assert.equal(stored.description, 'Startup timeout dry run');
  assert.equal(stored.includeDiagnostics, false);
});

test('bug-report UI keeps review, screenshot, and local-save controls explicit', () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
  assert.match(html, /id="report-bug"/);
  assert.match(app, /id="bug-screenshot"/);
  assert.match(app, /id="bug-review-diagnostics"/);
  assert.match(app, /id="bug-review-report"/);
  assert.match(app, /id="bug-save"/);
  assert.match(app, /issues\/new\?template=bug_report\.yml/);
  assert.match(app, /Nothing is sent automatically/);
});
