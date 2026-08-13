import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { defaultSources, scan } from './core.js';
import { shareableStack, manifest, privateInventory, publicMetricOptions, createSnapshot, shareCardSvg, setupPrompt } from './sharing.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, '.dashboard-data'); const indexFile = path.join(dataDir, 'index.json');
let liveIndex = null, lastReason = 'starting'; let refreshing = false;
function refresh(reason = 'manual') { if (refreshing) return liveIndex; refreshing = true; fs.mkdirSync(dataDir, { recursive: true }); const previous = liveIndex || (fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : null); const result = scan(defaultSources(), previous); result.summary.refreshReason = reason; liveIndex = result; fs.writeFileSync(indexFile, JSON.stringify(result, null, 2)); refreshing = false; return result; }
function index() { return liveIndex || (fs.existsSync(indexFile) ? (liveIndex = JSON.parse(fs.readFileSync(indexFile, 'utf8'))) : refresh('startup')); }
function body(req) { return new Promise((resolve) => { let text=''; req.on('data',d=>text+=d); req.on('end',()=>{ try { resolve(JSON.parse(text||'{}')); } catch { resolve({}); } }); }); }
function contentType(file) { return file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : 'application/json'; }
function watchSources() { const roots=Object.values(defaultSources()); let timer; const changed=()=>{ clearTimeout(timer); timer=setTimeout(()=>refresh('local activity'),1800); }; for(const source of roots) try { fs.watch(source,{recursive:true},changed); } catch { try { fs.watch(source,changed); } catch {} } setInterval(()=>refresh('periodic check'),300000).unref(); }
function serve() { refresh('startup'); watchSources(); const publicDir = path.join(root, 'public'); const server = http.createServer(async (req, res) => { const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/data') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(index())); }
  if (url.pathname === '/api/scan' && req.method === 'POST') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(refresh('manual refresh'))); }
  if (url.pathname === '/api/status') { res.setHeader('Content-Type','application/json'); const x=index(); return res.end(JSON.stringify({state:'Live',lastUpdated:x.summary.lastScanAt,reason:x.summary.refreshReason||lastReason,diagnostics:x.summary.diagnostics})); }
  if (url.pathname === '/api/export/stack') { res.setHeader('Content-Type','application/json'); return res.end(JSON.stringify(shareableStack(index()),null,2)); }
  if (url.pathname === '/api/export/manifest') { res.setHeader('Content-Type','application/json'); return res.end(JSON.stringify(manifest(index()),null,2)); }
  if (url.pathname === '/api/export/private') { res.setHeader('Content-Type','application/json'); return res.end(JSON.stringify(privateInventory(index()),null,2)); }
  if (url.pathname === '/api/export/setup-prompt') { res.setHeader('Content-Type','text/plain; charset=utf-8'); return res.end(setupPrompt(index())); }
  if (url.pathname === '/api/share/options') { res.setHeader('Content-Type','application/json'); return res.end(JSON.stringify(publicMetricOptions(index()))); }
  if (url.pathname === '/api/share/snapshot' && req.method === 'POST') { const b=await body(req); try { const snapshot=createSnapshot(index(),b.metrics,b.format,path.join(dataDir,'snapshots')); res.setHeader('Content-Type','application/json'); return res.end(JSON.stringify(snapshot)); } catch(e) { res.statusCode=400; return res.end(JSON.stringify({error:e.message})); } }
  if (url.pathname === '/api/share/card.svg') { const id=url.searchParams.get('snapshot'); const file=id&&path.join(dataDir,'snapshots',`${id}.json`); if(!file || !fs.existsSync(file)){res.statusCode=404;return res.end('Snapshot not found');} res.setHeader('Content-Type','image/svg+xml'); return res.end(shareCardSvg(JSON.parse(fs.readFileSync(file,'utf8')))); }
  let asset = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//, ''); asset = path.normalize(asset); const full = path.join(publicDir, asset); if (!full.startsWith(publicDir) || !fs.existsSync(full)) { res.statusCode = 404; return res.end('Not found'); } res.setHeader('Content-Type', contentType(full)); res.end(fs.readFileSync(full));
 }); server.listen(4177, '127.0.0.1', () => console.log('AI Development Dashboard → http://127.0.0.1:4177'));
}
if (process.argv[2] === 'scan') { const data = refresh(); console.log(`Indexed ${data.projects.length} projects, ${data.sessions.length} sessions, ${data.capabilities.length} capabilities.`); } else serve();
