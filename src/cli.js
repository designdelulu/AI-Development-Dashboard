import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { defaultSources, scan } from './core.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, '.dashboard-data'); const indexFile = path.join(dataDir, 'index.json');
function refresh() { fs.mkdirSync(dataDir, { recursive: true }); const previous = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : null; const result = scan(defaultSources(), previous); fs.writeFileSync(indexFile, JSON.stringify(result, null, 2)); return result; }
function index() { return fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : refresh(); }
function contentType(file) { return file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : 'application/json'; }
function serve() { const publicDir = path.join(root, 'public'); const server = http.createServer((req, res) => { const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/data') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(index())); }
  if (url.pathname === '/api/scan' && req.method === 'POST') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(refresh())); }
  let asset = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//, ''); asset = path.normalize(asset); const full = path.join(publicDir, asset); if (!full.startsWith(publicDir) || !fs.existsSync(full)) { res.statusCode = 404; return res.end('Not found'); } res.setHeader('Content-Type', contentType(full)); res.end(fs.readFileSync(full));
 }); server.listen(4177, '127.0.0.1', () => console.log('AI Development Dashboard → http://127.0.0.1:4177'));
}
if (process.argv[2] === 'scan') { const data = refresh(); console.log(`Indexed ${data.projects.length} projects, ${data.sessions.length} sessions, ${data.capabilities.length} capabilities.`); } else serve();
