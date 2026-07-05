/*
 * ローカル開発/テスト用モックサーバー。
 * worker/src/core.js を Cloudflare Worker と共有し、KV を in-memory Map で代替する。
 * docs/ の静的配信も行い、/config.js は自分自身を api に指すよう動的生成する。
 *
 *   node tools/mock-server.mjs [port] [--admin=KEY]
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { handleApi } from '../worker/src/core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = path.join(ROOT, 'docs');
const PORT = parseInt(process.argv[2], 10) || 8787;
const ADMIN_KEY = (process.argv.find(a => a.startsWith('--admin=')) || '--admin=admin-secret').split('=')[1];

const store = new Map();
const kv = {
  get: async k => (store.has(k) ? store.get(k) : null),
  put: async (k, v) => { store.set(k, v); },
  delete: async k => { store.delete(k); },
  list: async prefix => [...store.keys()].filter(k => k.startsWith(prefix))
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization'
};
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.css': 'text/css; charset=utf-8' };

function readBody(req) {
  return new Promise(resolve => {
    let d = '';
    req.on('data', c => { d += c; });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }

  if (url.pathname.startsWith('/api/')) {
    const segments = url.pathname.replace(/^\/api\//, '').split('/').filter(Boolean);
    const query = Object.fromEntries(url.searchParams);
    const body = (req.method === 'POST' || req.method === 'PUT') ? await readBody(req) : {};
    const ctx = { method: req.method, segments, query, body, headers: { authorization: req.headers['authorization'] || '' }, origin: url.origin };
    let r;
    try { r = await handleApi(ctx, kv, ADMIN_KEY); }
    catch (e) { r = { status: e.status || 500, json: { error: e.message || 'error' } }; }
    if (r.photo != null) {
      res.writeHead(r.status, { ...CORS, 'Content-Type': r.contentType || 'image/jpeg' });
      return res.end(Buffer.from(r.photo, 'base64'));
    }
    res.writeHead(r.status, { ...CORS, 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(r.json));
  }

  // config.js を動的生成してこのモックを api に向ける
  if (url.pathname === '/config.js') {
    res.writeHead(200, { 'Content-Type': MIME['.js'] });
    return res.end(`window.YOSEGAKI = { api: "http://localhost:${PORT}", basePath: "" };`);
  }

  // 静的ファイル配信
  let file = url.pathname === '/' ? '/index.html' : url.pathname;
  const full = path.join(DOCS, path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
  try {
    const data = await readFile(full);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(data);
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  }
});

server.listen(PORT, () => console.log(`mock server on http://localhost:${PORT}  (admin key: ${ADMIN_KEY})`));
