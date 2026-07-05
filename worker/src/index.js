import { handleApi } from './core.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Max-Age': '86400'
};

function kvAdapter(ns) {
  return {
    get: k => ns.get(k),
    put: (k, v) => ns.put(k, v),
    delete: k => ns.delete(k),
    list: async prefix => {
      const out = [];
      let cursor;
      do {
        const r = await ns.list({ prefix, cursor });
        for (const it of r.keys) out.push(it.name);
        cursor = r.cursor;
        if (r.list_complete) break;
      } while (cursor);
      return out;
    }
  };
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      return new Response('寄せ書き API', { headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' } });
    }

    const segments = url.pathname.replace(/^\/api\//, '').split('/').filter(Boolean);
    const query = Object.fromEntries(url.searchParams);
    let body = {};
    if (request.method === 'POST' || request.method === 'PUT') {
      try { body = await request.json(); } catch (e) { body = {}; }
    }

    const ctx = {
      method: request.method, segments, query, body,
      headers: { authorization: request.headers.get('Authorization') || '' },
      origin: url.origin
    };

    let r;
    try {
      r = await handleApi(ctx, kvAdapter(env.YOSEGAKI_KV), env.ADMIN_KEY);
    } catch (e) {
      r = { status: e.status || 500, json: { error: e.message || 'error' } };
    }

    if (r.photo != null) {
      const bin = Uint8Array.from(atob(r.photo), c => c.charCodeAt(0));
      return new Response(bin, {
        status: r.status,
        headers: { ...CORS, 'Content-Type': r.contentType || 'image/jpeg', 'Cache-Control': 'public, max-age=60' }
      });
    }
    return new Response(JSON.stringify(r.json), {
      status: r.status,
      headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' }
    });
  }
};
