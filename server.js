'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

// Load .env (if present) without overriding real env vars. Values are never logged.
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env) && m[2] !== '') process.env[m[1]] = m[2];
  }
} catch { /* no .env */ }

const nb = require('./lib/notebook');
const { modelList } = require('./lib/gemini');
const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg' };

function readJson(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(Object.assign(new Error('request too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch { reject(Object.assign(new Error('invalid JSON'), { status: 400 })); } });
    req.on('error', reject);
  });
}
const routes = {
  'GET /api/status': async () => ({ gemini: Boolean(process.env.GEMINI_API_KEY), models: modelList() }),
  'POST /api/analyze': async (req) => nb.analyzeImage(await readJson(req)),
  'POST /api/practice': async (req) => nb.morePractice(await readJson(req, 64 * 1024)),
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const h = routes[`${req.method} ${url.pathname}`];
  if (h) {
    try {
      const out = await h(req);
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out));
    } catch (e) {
      const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
      console.error(`${req.method} ${url.pathname} -> ${status}: ${e.message}`);
      res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message, code: e.code || null }));
    }
    return;
  }
  if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
  const f = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : path.normalize(decodeURIComponent(url.pathname)));
  if (f.startsWith(PUBLIC + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile()) {
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  } else { res.writeHead(404); res.end('not found'); }
});
const port = Number(process.env.PORT || 3000);
server.listen(port, '0.0.0.0', () => console.log(`Mistake Notebook AI on http://localhost:${port} (gemini configured: ${Boolean(process.env.GEMINI_API_KEY)})`));
