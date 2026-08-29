import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { discoverHermes, hermesInstallation, hermesLiveCompletions, readHermesHistory, readHermesLive, readHermesLiveAsync } from '../src/hermes.js';
import * as hermesAdapter from '../src/adapters/hermes.js';

const temp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); };

function createDatabase(file, project, { live = true, unsupported = false } = {}) {
  const script = unsupported
    ? "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute('create table unrelated (id text)'); c.commit()"
    : `import sqlite3,sys,time
c=sqlite3.connect(sys.argv[1])
c.executescript('''
create table sessions (id text primary key, source text, model text, parent_session_id text, started_at real, ended_at real, input_tokens integer, output_tokens integer, cache_read_tokens integer, cache_write_tokens integer, reasoning_tokens integer, cwd text, git_repo_root text, billing_provider text, last_activity_at real, api_call_count integer, tool_call_count integer, message_count integer, hidden integer, system_prompt text, title text);
create table session_model_usage (session_id text, model text, billing_provider text, input_tokens integer, output_tokens integer, cache_read_tokens integer, cache_write_tokens integer, reasoning_tokens integer, first_seen real, last_seen real);
create table session_turn_leases (conversation_id text, holder text, acquired_at real, expires_at real);
''')
now=time.time()
c.execute('insert into sessions values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', ('session-1','desktop','z-ai/glm-5.3-flash',None,now-30,None,120,45,10,5,7,sys.argv[2],sys.argv[2],'openrouter',now,2,3,4,0,'PRIVATE SYSTEM PROMPT','PRIVATE TITLE'))
c.execute('insert into session_model_usage values (?,?,?,?,?,?,?,?,?,?)', ('session-1','z-ai/glm-5.3-flash','openrouter',120,45,10,5,7,now-30,now))
if ${live ? 'True' : 'False'}: c.execute('insert into session_turn_leases values (?,?,?,?)', ('session-1','private-holder',now-5,now+120))
c.commit()`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  execFileSync('python3', ['-c', script, file, project]);
}

function fixture({ live = true, unsupported = false } = {}) {
  const home = temp('hermes-home');
  const project = path.join(home, 'Projects', 'demo');
  fs.mkdirSync(path.join(project, '.git'), { recursive: true });
  const root = path.join(home, '.hermes');
  write(path.join(root, 'config.yaml'), 'model:\n  default: z-ai/glm-5.3-flash\n  provider: openrouter\n');
  createDatabase(path.join(root, 'state.db'), project, { live, unsupported });
  write(path.join(root, 'runtime', 'active_sessions.json'), { entries: [{ session_id: 'session-1', surface: 'desktop', metadata: { prompt: 'PRIVATE ACTIVE PROMPT' } }] });
  return { home, root, project };
}

test('Hermes stays optional when absent and detects configuration without reading secrets', () => {
  const home = temp('hermes-absent');
  const absent = discoverHermes({ homeDir: home, env: { PATH: '' }, now: new Date('2026-08-29T00:00:00Z') });
  assert.equal(absent.installed.state, 'not-detected');
  assert.equal(absent.history.state, 'unsupported');
  fs.mkdirSync(path.join(home, '.hermes'), { recursive: true });
  write(path.join(home, '.hermes', 'config.yaml'), 'model:\n  default: future/provider-model\n  provider: openrouter\n');
  write(path.join(home, '.hermes', '.env'), 'OPENROUTER_API_KEY=private-value-must-not-escape\n');
  const state = discoverHermes({ homeDir: home, env: { PATH: '' }, now: new Date('2026-08-29T00:00:00Z') });
  assert.equal(state.installed.state, 'detected');
  assert.equal(state.history.state, 'none-yet');
  assert.equal(state.connection.state, 'configured');
  assert.equal(state.installation.configuredModel, 'future/provider-model');
  assert.equal(JSON.stringify(state).includes('private-value-must-not-escape'), false);
});

test('Hermes history preserves Agent, observed Desktop host, OpenRouter gateway, dynamic model, project, and exact tokens', () => {
  const { home, project } = fixture();
  const installation = hermesInstallation({ homeDir: home, env: { PATH: '' } });
  const result = readHermesHistory({ installation, projects: [{ id: 'project:demo', canonicalPath: project }] });
  assert.equal(result.sessions.length, 1);
  const session = result.sessions[0];
  assert.equal(session.agent, 'Hermes Agent');
  assert.equal(session.host, 'Hermes Desktop');
  assert.equal(session.gateway, 'OpenRouter');
  assert.equal(session.provider, 'Z.AI');
  assert.equal(session.modelId, 'z-ai/glm-5.3-flash');
  assert.equal(session.projectId, 'project:demo');
  assert.equal(session.tokens.freshInput, 120);
  assert.equal(session.tokens.output, 45);
  assert.equal(session.tokens.cacheRead, 10);
  assert.equal(session.tokens.cacheCreation, 5);
  assert.equal(session.tokens.reasoning, 7);
  assert.match(session.sourceFile, /^<hermes-state-db>$/);
  assert.doesNotMatch(JSON.stringify(session), /PRIVATE SYSTEM PROMPT|PRIVATE TITLE|private-holder|\.hermes/i);
});

test('Hermes durable turn lease is Working while a desktop slot alone is not', async () => {
  const { home } = fixture({ live: true });
  const installation = hermesInstallation({ homeDir: home, env: { PATH: '' } });
  const active = readHermesLive({ installation, now: Date.now() });
  assert.equal(active.length, 1);
  assert.equal(active[0].host, 'Hermes Desktop');
  assert.equal(active[0].gateway, 'OpenRouter');
  assert.equal(active[0].source, 'hermes-durable-turn-lease');
  assert.equal((await readHermesLiveAsync({ installation, now: Date.now(), timeoutMs: 5000 })).length, 1);
  const idleFixture = fixture({ live: false });
  assert.deepEqual(readHermesLive({ installation: hermesInstallation({ homeDir: idleFixture.home, env: { PATH: '' } }), now: Date.now() }), []);
  const completed = hermesLiveCompletions(active, [], Date.parse('2026-08-29T00:00:00Z'));
  assert.deepEqual(completed.map(({ agent, host, model, kind }) => ({ agent, host, model, kind })), [{ agent: 'Hermes Agent', host: 'Hermes Desktop', model: 'z-ai/glm-5.3-flash', kind: 'hermes-durable-turn-completed' }]);
});

test('Hermes safely degrades for an unsupported future state schema and profiles remain separated', () => {
  const { home, root } = fixture({ unsupported: true });
  const profileRoot = path.join(root, 'profiles', 'private-work');
  write(path.join(profileRoot, 'config.yaml'), 'model:\n  default: example/future\n');
  const installation = hermesInstallation({ homeDir: home, env: { PATH: '' } });
  assert.equal(installation.homes.length, 2);
  assert.equal(installation.homes[1].profile, 'Profile 1');
  const result = readHermesHistory({ installation });
  assert.equal(result.sessions.length, 0);
  assert.equal(result.diagnostics.hermesUnsupported, 2);
  assert.equal(hermesAdapter.manifest.capabilities.live, 'exact');
});
