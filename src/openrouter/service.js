import fs from 'node:fs';
import path from 'node:path';
import { OPENROUTER_MANAGEMENT_CREDENTIAL_REF, credentialStatus, openRouterCredential } from '../credentials.js';
import { normalizePermissions } from '../permissions.js';
import { loadSettings, saveSettings } from '../config.js';
import { OpenRouterClient, OpenRouterError } from './client.js';
import { analyticsQuery, analyticsSchema, normalizeAnalytics } from './analytics.js';

const CACHE_FILE = 'openrouter.json';
const SAFE_PERIODS = new Set(['today', 'yesterday', '7d', 'month']);
const iso = (date) => date.toISOString();

export function periodRange(period = 'today', now = new Date()) {
  const end = new Date(now);
  const start = new Date(now);
  if (period === 'yesterday') { start.setHours(0, 0, 0, 0); end.setHours(0, 0, 0, 0); start.setDate(start.getDate() - 1); }
  else if (period === '7d') start.setDate(start.getDate() - 7);
  else if (period === 'month') start.setDate(1), start.setHours(0, 0, 0, 0);
  else start.setHours(0, 0, 0, 0);
  return { id: SAFE_PERIODS.has(period) ? period : 'today', start: iso(start), end: iso(end) };
}

function cacheFile(dataDir) { return path.join(dataDir, CACHE_FILE); }
function readCache(dataDir) { try { const value = JSON.parse(fs.readFileSync(cacheFile(dataDir), 'utf8')); return value && typeof value === 'object' ? value : null; } catch { return null; } }
function writeCache(dataDir, value) { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(cacheFile(dataDir), JSON.stringify(value, null, 2)); }
function safeError(error) { return error instanceof OpenRouterError ? error.code : 'connector-error'; }

// This service is the only OpenRouter network boundary. Construction and state
// reads are side-effect-free; sync requires an already-enabled connected
// permission and credential reference.
export function createOpenRouterService({ dataDir, env = process.env, fetchImpl = globalThis.fetch, now = () => new Date(), getSettings = loadSettings, putSettings = saveSettings } = {}) {
  const settings = () => getSettings(dataDir);
  const serviceSettings = () => settings().connectedServices?.openRouter || {};
  const cache = () => readCache(dataDir);
  const state = () => {
    const configured = serviceSettings();
    const cached = cache();
    const credential = credentialStatus(env, configured.credentialRef);
    return {
      id: 'openrouter', enabled: configured.enabled === true,
      connected: configured.enabled === true && normalizePermissions(settings().permissions).networkConnected === true && credential.available,
      credential: { reference: credential.reference, available: credential.available },
      lastSyncedAt: configured.lastSyncAt || cached?.syncedAt || null,
      lastError: configured.lastError || null,
      cached: cached ? { ...cached, stale: Boolean(configured.lastError) } : null,
      network: 'OpenRouter is contacted only after explicit connection and a manual sync.'
    };
  };
  const update = (patch) => putSettings(dataDir, { connectedServices: { ...settings().connectedServices, openRouter: { ...serviceSettings(), ...patch } } });

  async function sync({ period = 'today' } = {}) {
    const current = state();
    if (!current.enabled) throw new OpenRouterError('not-connected', 'Connect OpenRouter before syncing usage.');
    if (!normalizePermissions(settings().permissions).networkConnected) throw new OpenRouterError('permission-denied', 'Connected-service network permission is disabled.');
    const credential = openRouterCredential(env, serviceSettings().credentialRef);
    if (!credential) throw new OpenRouterError('credential-unavailable', 'The OpenRouter management credential is unavailable to this dashboard process.');
    const client = new OpenRouterClient({ credential: credential.value, fetchImpl });
    try {
      const meta = await client.meta();
      const schema = analyticsSchema(meta);
      const range = periodRange(period, now());
      const byModel = analyticsQuery(schema, range, ['model']);
      const byProvider = analyticsQuery(schema, range, ['provider']);
      if (!byModel) throw new OpenRouterError('partial-schema', 'OpenRouter analytics did not advertise supported aggregate metrics.');
      const [modelResponse, providerResponse, creditsResponse] = await Promise.all([
        client.analytics(byModel),
        byProvider ? client.analytics(byProvider) : Promise.resolve({ data: { data: [] } }),
        client.credits()
      ]);
      const normalized = normalizeAnalytics({ modelResponse, providerResponse, creditsResponse, schema, range });
      writeCache(dataDir, normalized);
      update({ lastSyncAt: normalized.syncedAt, lastError: null });
      return state();
    } catch (error) {
      const code = safeError(error);
      update({ lastError: code });
      throw error;
    }
  }

  async function connect({ period = 'today' } = {}) {
    const credential = openRouterCredential(env);
    if (!credential) throw new OpenRouterError('credential-unavailable', 'Set OPENROUTER_MANAGEMENT_KEY for the dashboard process before connecting.');
    const permissions = normalizePermissions(settings().permissions);
    putSettings(dataDir, {
      permissions: { ...permissions, networkConnected: true },
      connectedServices: { ...settings().connectedServices, openRouter: { enabled: true, credentialRef: OPENROUTER_MANAGEMENT_CREDENTIAL_REF, connectedAt: now().toISOString(), lastSyncAt: serviceSettings().lastSyncAt || null, lastError: null } }
    });
    return sync({ period });
  }

  function disconnect() {
    // The environment remains the owner's process configuration; this only
    // forgets the reference and disables future calls. Aggregate cache stays
    // local for an explicit later deletion policy.
    putSettings(dataDir, {
      connectedServices: { ...settings().connectedServices, openRouter: { enabled: false, credentialRef: null, connectedAt: null, lastSyncAt: serviceSettings().lastSyncAt || null, lastError: null } }
    });
    return state();
  }

  return { state, connect, sync, disconnect };
}
