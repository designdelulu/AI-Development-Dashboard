import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readLifecycleEvents } from './lifecycle/log.js';

export const BUG_REPORT_SCHEMA_VERSION = 1;
export const BUG_REPORT_MAX_DESCRIPTION = 8_000;
export const BUG_REPORT_MAX_CONTEXT = 4_000;
export const BUG_REPORT_MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
export const BUG_REPORT_IMAGE_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp']);

const control = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

function text(value, max = 500) {
  return String(value ?? '').replace(control, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function integer(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : fallback;
}

function boolean(value) { return value === true; }

export function createReportId({ now = () => Date.now(), randomBytes = crypto.randomBytes } = {}) {
  const date = new Date(now());
  const day = Number.isNaN(date.getTime()) ? '00000000' : date.toISOString().slice(0, 10).replaceAll('-', '');
  return `ADR-${day}-${randomBytes(4).toString('hex').slice(0, 6).toUpperCase()}`;
}

function safeAdapter(value = {}) {
  return {
    id: text(value.id || value.adapterId, 80) || 'unknown',
    state: text(value.state, 40) || null,
    installed: boolean(value.installed),
    historical: boolean(value.historical),
    active: boolean(value.active),
    connected: boolean(value.connected),
    capabilities: Array.isArray(value.capabilities) ? value.capabilities.map((item) => text(item, 60)).filter(Boolean).slice(0, 30) : []
  };
}

/**
 * Build diagnostics only from explicit, allowlisted metadata. Callers should
 * never pass a settings object, environment object, transcript, or raw log.
 */
export function buildDiagnostics(input = {}) {
  const normalized = input.dashboard
    ? { ...input, version: input.dashboard.version, commit: input.dashboard.commit, dataSchemaVersion: input.dashboard.dataSchemaVersion, nodeMajor: input.environment?.nodeMajor, os: { platform: input.environment?.platform, architecture: input.environment?.architecture } }
    : input;
  const lifecycle = normalized.lifecycle || {};
  const counts = normalized.counts || {};
  const permissions = normalized.permissions || {};
  const osInfo = normalized.os || {};
  const diagnostics = {
    schemaVersion: BUG_REPORT_SCHEMA_VERSION,
    dashboard: {
      version: text(normalized.version, 40) || null,
      commit: text(normalized.commit, 80) || null,
      dataSchemaVersion: integer(normalized.dataSchemaVersion)
    },
    environment: {
      platform: text(osInfo.platform || os.platform(), 30),
      architecture: text(osInfo.architecture || os.arch(), 30),
      nodeMajor: integer(normalized.nodeMajor || String(process.versions.node || '').split('.')[0])
    },
    lifecycle: {
      state: text(lifecycle.state, 40) || 'unknown',
      port: integer(lifecycle.port),
      startupStage: text(lifecycle.startupStage, 80) || null,
      startupDurationMs: integer(lifecycle.startupDurationMs)
    },
    permissions: {
      localRead: boolean(permissions.localRead),
      networkConnected: boolean(permissions.networkConnected),
      localIntegrationWrite: boolean(permissions.localIntegrationWrite),
      externalModification: boolean(permissions.externalModification)
    },
    counts: {
      projects: integer(counts.projects, 0),
      sessions: integer(counts.sessions, 0),
      capabilities: integer(counts.capabilities, 0),
      usageObservations: integer(counts.usageObservations, 0)
    },
    adapters: Array.isArray(normalized.adapters) ? normalized.adapters.map(safeAdapter).slice(0, 40) : [],
    recentLifecycleEvents: Array.isArray(normalized.recentLifecycleEvents)
      ? normalized.recentLifecycleEvents.slice(-40).map((event) => ({
        at: text(event.at, 40) || null,
        stage: text(event.stage, 80) || null,
        code: text(event.code, 80) || null,
        message: text(event.message, 260) || null,
        ...(Number.isFinite(event.durationMs) ? { durationMs: integer(event.durationMs) } : {})
      }))
      : []
  };
  return diagnostics;
}

export function validateScreenshot({ type, size } = {}, { maxBytes = BUG_REPORT_MAX_SCREENSHOT_BYTES } = {}) {
  const normalizedType = text(type, 80).toLowerCase();
  const bytes = integer(size, -1);
  if (!BUG_REPORT_IMAGE_TYPES.includes(normalizedType)) return { valid: false, error: 'Choose a PNG, JPEG, or WebP image.' };
  if (bytes < 0 || bytes > maxBytes) return { valid: false, error: `Screenshots must be ${Math.round(maxBytes / (1024 * 1024))} MB or smaller.` };
  return { valid: true, type: normalizedType, size: bytes };
}

export function createBugReport({ description, context = '', includeDiagnostics = true, diagnostics = {}, screenshot = null, now = () => Date.now(), randomBytes = crypto.randomBytes } = {}) {
  const cleanDescription = String(description ?? '').replace(control, ' ').trim().slice(0, BUG_REPORT_MAX_DESCRIPTION);
  if (!cleanDescription) throw new Error('Describe what happened before saving the report.');
  const cleanContext = String(context ?? '').replace(control, ' ').trim().slice(0, BUG_REPORT_MAX_CONTEXT);
  let screenshotManifest = null;
  if (screenshot) {
    const validation = validateScreenshot(screenshot);
    if (!validation.valid) throw new Error(validation.error);
    screenshotManifest = { name: text(screenshot.name, 160) || 'screenshot', type: validation.type, size: validation.size };
  }
  return {
    schemaVersion: BUG_REPORT_SCHEMA_VERSION,
    reportId: createReportId({ now, randomBytes }),
    createdAt: new Date(now()).toISOString(),
    description: cleanDescription,
    context: cleanContext || null,
    includeDiagnostics: includeDiagnostics === true,
    diagnostics: includeDiagnostics === true ? buildDiagnostics(diagnostics) : null,
    screenshot: screenshotManifest
  };
}

function decodeScreenshot(screenshot) {
  if (!screenshot?.data) return null;
  const raw = String(screenshot.data);
  const base64 = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw;
  if (!/^[A-Za-z0-9+/=]+$/.test(base64)) throw new Error('Screenshot data is not valid base64.');
  const buffer = Buffer.from(base64, 'base64');
  const validation = validateScreenshot({ type: screenshot.type, size: buffer.length });
  if (!validation.valid) throw new Error(validation.error);
  return buffer;
}

export function writeBugReportBundle(dataDir, report, { screenshot = null } = {}) {
  if (!report?.reportId) throw new Error('A report ID is required.');
  const directory = path.join(dataDir, 'bug-reports', report.reportId);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const safeReport = JSON.parse(JSON.stringify(report));
  const image = screenshot ? decodeScreenshot({ ...screenshot, data: screenshot.data || screenshot }) : null;
  let imageName = null;
  if (image) {
    const extension = report.screenshot?.type === 'image/png' ? 'png' : report.screenshot?.type === 'image/webp' ? 'webp' : 'jpg';
    imageName = `screenshot.${extension}`;
    fs.writeFileSync(path.join(directory, imageName), image, { mode: 0o600 });
    safeReport.screenshot = { ...(safeReport.screenshot || {}), file: imageName };
  }
  const reportFile = path.join(directory, 'report.json');
  const temporary = `${reportFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(safeReport, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, reportFile);
  return { reportId: report.reportId, directory, reportFile, screenshotFile: imageName ? path.join(directory, imageName) : null, relativeDirectory: path.join('.dashboard-data', 'bug-reports', report.reportId) };
}

export function formatBugReportText(report = {}) {
  const lines = [`AI Development Dashboard bug report ${text(report.reportId, 80)}`, '', 'What happened:', text(report.description, BUG_REPORT_MAX_DESCRIPTION) || '(not provided)'];
  if (report.context) lines.push('', 'What I was doing:', text(report.context, BUG_REPORT_MAX_CONTEXT));
  if (report.includeDiagnostics && report.diagnostics) lines.push('', 'Diagnostics:', JSON.stringify(report.diagnostics, null, 2));
  if (report.screenshot) lines.push('', `Screenshot: ${report.screenshot.file || report.screenshot.name || 'included'}`);
  return lines.join('\n');
}

export function configuredReportEndpoint(env = process.env) {
  const endpoint = String(env.AI_DASHBOARD_BUG_REPORT_ENDPOINT || '').trim();
  return /^https:\/\//i.test(endpoint) ? endpoint : null;
}

export async function submitBugReport(report, { screenshot = null, endpoint = configuredReportEndpoint(), fetchImpl = globalThis.fetch } = {}) {
  if (!endpoint) return { state: 'not-configured', reportId: report?.reportId || null };
  if (typeof fetchImpl !== 'function') return { state: 'error', error: 'No HTTPS report transport is available.' };
  try {
    const form = new FormData();
    form.set('report', JSON.stringify(report));
    const image = screenshot ? decodeScreenshot(screenshot) : null;
    if (image) form.set('screenshot', new Blob([image], { type: screenshot.type }), screenshot.name || 'screenshot');
    const response = await fetchImpl(endpoint, { method: 'POST', body: form });
    if (!response?.ok) return { state: 'error', error: `Report endpoint returned HTTP ${response?.status || 'unknown'}.` };
    let body = {};
    try { body = await response.json(); } catch {}
    return { state: 'sent', reportId: report.reportId, reference: text(body.reference, 100) || report.reportId };
  } catch (error) {
    return { state: 'error', error: text(error?.message || 'Report submission failed.', 240) };
  }
}

export function diagnosticsFromLocalState({ dataDir, version = null, commit = null, dataSchemaVersion = null, lifecycle = {}, permissions = {}, adapters = [], counts = {} } = {}) {
  return buildDiagnostics({ version, commit, dataSchemaVersion, lifecycle, permissions, adapters, counts, recentLifecycleEvents: readLifecycleEvents(path.join(dataDir, 'lifecycle.jsonl')) });
}
