import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const CONFIDENCE = { confirmed: 'Confirmed', strong: 'Strongly inferred', weak: 'Weakly inferred', unknown: 'Unknown' };
const home = process.env.HOME;
const iso = (v) => { try { return new Date(v).toISOString(); } catch { return null; } };
const safeStat = (p) => { try { return fs.statSync(p); } catch { return null; } };
const exists = (p) => !!safeStat(p);
const hash = (v) => crypto.createHash('sha256').update(v).digest('hex').slice(0, 16);
const fileFingerprint = (p) => { const st = safeStat(p); return st ? `${st.size}:${Math.round(st.mtimeMs)}` : null; };
const walk = (root, options = {}) => {
  const out = []; const maxDepth = options.maxDepth ?? 8; const maxFiles = options.maxFiles ?? Infinity; const accept = options.accept ?? (() => true);
  const ignore = new Set(options.ignore ?? ['.git', 'node_modules', '.dashboard-data', 'archive', 'Archives']);
  function visit(dir, depth) { if (depth > maxDepth || out.length >= maxFiles) return; let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) { if (out.length >= maxFiles) return; const full = path.join(dir, entry.name); if (entry.isDirectory()) { if (!ignore.has(entry.name)) visit(full, depth + 1); } else if (accept(full, entry)) out.push(full); }
  } visit(root, 0); return out;
};
// Read a bounded prefix. Session files can be very large; a scan must stay responsive
// and must never load a private transcript wholesale. New adapters can add streaming
// tail/cumulative counters when a provider's stable format warrants it.
const readJsonl = (file, onRow) => { try { const size = safeStat(file)?.size || 0; const limit = Math.min(size, 512 * 1024); const fd = fs.openSync(file, 'r'); const buffer = Buffer.alloc(limit); fs.readSync(fd, buffer, 0, limit, 0); fs.closeSync(fd); for (const line of buffer.toString('utf8').split('\n')) if (line.trim()) { try { onRow(JSON.parse(line)); } catch {} } } catch {} };
const firstLine = (file) => { try { return fs.readFileSync(file, 'utf8').split('\n').find(Boolean)?.slice(0, 220) || ''; } catch { return ''; } };
const projectId = (p) => `project:${hash(p)}`;
const normalPath = (p) => path.resolve(p).replace(/\\/g, '/');
const within = (child, parent) => normalPath(child).startsWith(`${normalPath(parent)}/`) || normalPath(child) === normalPath(parent);
const git = (cwd, args) => { try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };

export function discoverProjects(root) {
  const roots = new Set();
  for (const gitDir of walk(root, { maxDepth: 5, accept: (f) => path.basename(f) === '.git' })) roots.add(path.dirname(gitDir));
  // .git commonly is a directory and walk intentionally visits its contents; check direct tree too.
  function visit(dir, depth = 0) { if (depth > 5) return; let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (entries.some((e) => e.name === '.git')) roots.add(dir);
    for (const e of entries) if (e.isDirectory() && !['.git', 'node_modules', '.dashboard-data', 'Archives', 'archive'].includes(e.name)) visit(path.join(dir, e.name), depth + 1);
  } visit(root);
  return [...roots].sort().map((canonicalPath) => {
    const branch = git(canonicalPath, ['branch', '--show-current']);
    const remote = git(canonicalPath, ['remote', 'get-url', 'origin']);
    const last = git(canonicalPath, ['log', '-1', '--format=%cI']);
    return { id: projectId(canonicalPath), name: path.basename(canonicalPath), canonicalPath, git: { isRepository: true, branch: branch || null, remote: remote || null, lastCommitAt: iso(last) }, confidence: CONFIDENCE.confirmed };
  });
}
function resolveProject(cwd, projects) { if (!cwd) return null; const candidates = projects.filter((p) => within(cwd, p.canonicalPath)).sort((a, b) => b.canonicalPath.length - a.canonicalPath.length); return candidates[0] || null; }
function usageOf(obj) { const u = obj?.usage || obj?.message?.usage || obj?.payload?.usage || {}; return { input: Number(u.input_tokens ?? u.inputTokens ?? 0), output: Number(u.output_tokens ?? u.outputTokens ?? 0), cached: Number(u.cache_read_input_tokens ?? u.cached_tokens ?? u.cacheReadInputTokens ?? 0), reasoning: Number(u.reasoning_tokens ?? u.reasoningTokens ?? 0) }; }
function sessionEvent({ agent, id, timestamp, cwd, model, usage, tools = 0, compactions = 0, sourceFile, projects, evidence = CONFIDENCE.confirmed }) { const p = resolveProject(cwd, projects); return { id: `${agent}:${id}`, agent, sourceFile, sourceFingerprint: fileFingerprint(sourceFile), timestamp, projectId: p?.id || null, projectPath: p?.canonicalPath || cwd || null, attributionConfidence: p ? evidence : CONFIDENCE.unknown, model: model || null, usage, tools, compactions }; }
export function scanClaude(projects, claudeRoot = path.join(home, '.claude', 'projects'), previous = new Map()) {
  const sessions = new Map();
  for (const file of walk(claudeRoot, { maxDepth: 4, accept: (f) => f.endsWith('.jsonl') })) { const prior = previous.get(file); if (prior?.sourceFingerprint === fileFingerprint(file)) { sessions.set(prior.id, prior); continue; }
    let event = null;
    readJsonl(file, (row) => { const id = row.sessionId || row.message?.id || path.basename(file, '.jsonl'); if (!event) event = sessionEvent({ agent: 'Claude', id, timestamp: row.timestamp, cwd: row.cwd, model: row.message?.model, usage: { input: 0, output: 0, cached: 0, reasoning: 0 }, sourceFile: file, projects });
      const u = usageOf(row); event.usage.input += u.input; event.usage.output += u.output; event.usage.cached += u.cached; event.usage.reasoning += u.reasoning;
      if (row.type === 'assistant' && Array.isArray(row.message?.content)) event.tools += row.message.content.filter((x) => x.type === 'tool_use').length;
      if (/compact|summary/i.test(row.type || '')) event.compactions += 1;
      if (row.timestamp && (!event.timestamp || row.timestamp > event.timestamp)) event.timestamp = row.timestamp;
    }); if (event) sessions.set(event.id, event);
  } return [...sessions.values()];
}
export function scanCodex(projects, codexRoot = path.join(home, '.codex', 'sessions'), previous = new Map()) {
  const sessions = new Map();
  for (const file of walk(codexRoot, { maxDepth: 5, accept: (f) => f.endsWith('.jsonl') })) { const prior = previous.get(file); if (prior?.sourceFingerprint === fileFingerprint(file)) { sessions.set(prior.id, prior); continue; }
    let event = null;
    readJsonl(file, (row) => { const p = row.payload || {}; const id = p.id || p.session_id || p.sessionId || path.basename(file, '.jsonl'); const cwd = p.cwd || p.working_directory || p.workspace?.cwd;
      if (!event) event = sessionEvent({ agent: 'Codex', id, timestamp: row.timestamp, cwd, model: p.model, usage: { input: 0, output: 0, cached: 0, reasoning: 0 }, sourceFile: file, projects });
      const u = usageOf(row); event.usage.input += u.input; event.usage.output += u.output; event.usage.cached += u.cached; event.usage.reasoning += u.reasoning;
      if (/tool|function_call|command_execution/.test(row.type || '') || p.type === 'function_call') event.tools += 1;
      if (/compact|summary/i.test(row.type || '') || /compact/i.test(p.event_type || '')) event.compactions += 1;
      if (row.timestamp && (!event.timestamp || row.timestamp > event.timestamp)) event.timestamp = row.timestamp;
    }); if (event) sessions.set(event.id, event);
  } return [...sessions.values()];
}
export function scanCursor(projects, cursorRoot = path.join(home, '.cursor', 'projects'), previous = new Map()) {
  const sessions = [];
  if (!exists(cursorRoot)) return sessions;
  for (const dir of fs.readdirSync(cursorRoot, { withFileTypes: true }).filter((x) => x.isDirectory())) {
    const decoded = '/' + dir.name.replace(/^Users-/, 'Users/').replaceAll('-', '/');
    const candidate = projects.find((p) => dir.name.includes(p.canonicalPath.replace(/^\//, '').replaceAll('/', '-')));
    const transcripts = walk(path.join(cursorRoot, dir.name, 'agent-transcripts'), { maxDepth: 3, accept: (f) => /\.(jsonl|json)$/.test(f) });
    for (const file of transcripts) { const prior = previous.get(file); if (prior?.sourceFingerprint === fileFingerprint(file)) { sessions.push(prior); continue; } const st = safeStat(file); sessions.push(sessionEvent({ agent: 'Cursor', id: hash(file), timestamp: st?.mtime.toISOString(), cwd: candidate?.canonicalPath || decoded, usage: { input: 0, output: 0, cached: 0, reasoning: 0 }, sourceFile: file, projects, evidence: candidate ? CONFIDENCE.strong : CONFIDENCE.weak })); }
  } return sessions;
}
function capabilityType(file) { const b = path.basename(file); if (b === 'SKILL.md') return 'Agent Skill'; if (b === 'CLAUDE.md' || b === 'AGENTS.md' || b === '.cursorrules' || file.includes('/.cursor/rules/')) return 'Instruction'; if (/settings.*\.json$|config.*\.toml$|mcp.*\.json$/i.test(b)) return 'MCP / Configuration'; return 'Capability'; }
export function discoverCapabilities(projects, sources) {
  const roots = [
    { root: path.join(home, '.claude', 'skills'), origin: 'Claude user', depth: 5 }, { root: path.join(home, '.claude', 'plugins'), origin: 'Claude plugin', depth: 6 }, { root: path.join(home, '.claude', 'scheduled-tasks'), origin: 'Claude user', depth: 4 },
    { root: path.join(home, '.codex', 'skills'), origin: 'Codex user', depth: 5 }, { root: path.join(home, '.codex', 'plugins'), origin: 'Codex plugin', depth: 5 },
    { root: path.join(home, '.cursor', 'skills-cursor'), origin: 'Cursor user', depth: 4 }, { root: path.join(home, '.cursor', 'agents'), origin: 'Cursor user', depth: 4 }, { root: path.join(home, '.cursor', 'plugins'), origin: 'Cursor plugin', depth: 5 },
    { root: sources.projectsRoot, origin: 'Project', depth: 6 }
  ]; const files = new Map();
  for (const item of roots) for (const file of walk(item.root, { maxDepth: item.depth, accept: (f) => ['SKILL.md', 'CLAUDE.md', 'AGENTS.md', '.cursorrules'].includes(path.basename(f)) || /\/\.cursor\/rules\/.*\.mdc$/.test(f) })) files.set(file, item.origin);
  return [...files].map(([file, origin]) => { const st = safeStat(file); const p = projects.find((x) => within(file, x.canonicalPath)); const title = firstLine(file).replace(/^#\s*/, '') || path.basename(path.dirname(file));
    return { id: `capability:${hash(file)}`, name: title, type: capabilityType(file), location: file, origin, projectId: p?.id || null, sourceHash: hash(`${st?.size}:${st?.mtimeMs}`), firstObserved: new Date().toISOString(), lastModified: st?.mtime.toISOString() || null, usageCount: 0, usageConfidence: CONFIDENCE.unknown, health: 'Never Observed', statusNote: 'Installed/configured; no safe usage evidence yet.' };
  });
}
export function gitMetrics(project) {
  const p = project.canonicalPath; const out = (args) => git(p, args) || ''; const commits = Number(out(['rev-list', '--count', 'HEAD']) || 0); const changes = out(['log', '--numstat', '--format=']).split('\n').filter(Boolean).reduce((a, l) => { const [add, del] = l.split('\t'); a.additions += Number(add) || 0; a.deletions += Number(del) || 0; return a; }, { additions: 0, deletions: 0 });
  const files = walk(p, { maxDepth: 5, maxFiles: 1500, ignore: ['.git', 'node_modules', '.dashboard-data', 'Archives', 'archive', 'dist', 'build', '.next', 'vendor', 'coverage'], accept: (f) => { const st = safeStat(f); return (st?.size || 0) < 1_000_000 && /\.(js|mjs|cjs|ts|tsx|jsx|py|go|rs|html|css|md|json|yml|yaml|sql|sh)$/i.test(f); } }); let lines = 0; for (const f of files) { try { lines += fs.readFileSync(f, 'utf8').split('\n').length; } catch {} }
  return { commits, additions: changes.additions, deletions: changes.deletions, netChange: changes.additions - changes.deletions, filesMeasured: files.length, linesMeasured: lines };
}
export function derive(index) {
  const sessions = index.sessions; const byProject = new Map(index.projects.map((p) => [p.id, { ...p, sessions: [], metrics: null }])); for (const s of sessions) if (s.projectId && byProject.has(s.projectId)) byProject.get(s.projectId).sessions.push(s);
  const projects = [...byProject.values()].map((p) => { const usage = p.sessions.reduce((a, s) => { for (const k of Object.keys(a)) a[k] += s.usage[k] || 0; return a; }, { input: 0, output: 0, cached: 0, reasoning: 0 }); return { ...p, metrics: gitMetrics(p), sessionCount: p.sessions.length, agents: [...new Set(p.sessions.map((x) => x.agent))], usage, recentActivity: p.sessions.map((x) => x.timestamp).filter(Boolean).sort().at(-1) || p.git.lastCommitAt }; });
  const usedCaps = index.capabilities.map((c) => ({ ...c, health: c.usageCount ? 'Active' : 'Never Observed' }));
  const total = sessions.reduce((a, s) => { a.sessions++; for (const k of Object.keys(a.usage)) a.usage[k] += s.usage[k] || 0; a.tools += s.tools; a.compactions += s.compactions; return a; }, { sessions: 0, tools: 0, compactions: 0, usage: { input: 0, output: 0, cached: 0, reasoning: 0 } });
  return { ...index, projects, capabilities: usedCaps, summary: { ...total, activeProjects: projects.filter((p) => p.sessionCount || p.git.lastCommitAt).length, observableTokens: Object.values(total.usage).reduce((a, x) => a + x, 0), agents: [...new Set(sessions.map((s) => s.agent))], lastScanAt: new Date().toISOString() } };
}
export function scan(sources, previous = null) { const projects = discoverProjects(sources.projectsRoot); const priorBySource = new Map((previous?.sessions || []).filter((s) => s.sourceFile).map((s) => [s.sourceFile, s])); const sessions = [...scanClaude(projects, sources.claudeRoot, priorBySource), ...scanCodex(projects, sources.codexRoot, priorBySource), ...scanCursor(projects, sources.cursorRoot, priorBySource)]; const capabilities = discoverCapabilities(projects, sources); return derive({ schemaVersion: 1, sources, projects, sessions, capabilities, errors: [] }); }
export function defaultSources() { return { projectsRoot: path.join(home, 'Dropbox', 'Projects'), claudeRoot: path.join(home, '.claude', 'projects'), codexRoot: path.join(home, '.codex', 'sessions'), cursorRoot: path.join(home, '.cursor', 'projects') }; }
