/*
 * 寄せ書き 収集フェーズ API のコアロジック（トランスポート非依存）
 *
 * Cloudflare Worker（src/index.js）とローカルモック（tools/mock-server.mjs）の
 * 両方からこの1ファイルを読み込むことで、本番とテストのロジックを一致させる。
 *
 * kv は次の非同期インターフェースを満たすアダプタ:
 *   get(key) -> string | null
 *   put(key, value) -> void
 *   delete(key) -> void
 *   list(prefix) -> string[]   (キー名の配列)
 */

const CFG_KEY = 'config';

const DEFAULT_CONFIG = {
  title: '寄せ書き',
  notice: 'やさしい言葉で、思い出に残るメッセージを届けよう。',
  photoMode: 'photo',            // 'photo' | 'text'
  deadline: '',                  // '' または ISO日付文字列
  // 見た目（エディタと同じキー）
  envW: 110, envRatio: 0.72, envRadius: 3, envColor: '#f2dd8e', flapColor: '#e3c463',
  shadow: 0.18, tilt: 4, nameSize: 12, nameColor: '#6b5c26',
  pinSize: 18, pinColor: '#e23b2e', pinOffset: -8,
  bgPattern: 'stripe', bgColor: '#e4e7ea', patDensity: 0.05,
  font: 'zen', centerSize: 210,
  centerImg: false, bgImage: false
};

// 見た目/収集設定として受け付けるキー（未知のキーは無視してKVを汚さない）
const CONFIG_KEYS = Object.keys(DEFAULT_CONFIG).filter(k => k !== 'centerImg' && k !== 'bgImage');

function num(v, d) { v = +v; return isNaN(v) ? d : v; }
function clamp(v, min, max, d) { v = num(v, d); return Math.max(min, Math.min(max, v)); }

function rid(bytes) {
  const b = new Uint8Array(bytes || 16);
  crypto.getRandomValues(b);
  return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
}

async function getJSON(kv, key, def) {
  const s = await kv.get(key);
  if (s == null) return def;
  try { return JSON.parse(s); } catch (e) { return def; }
}

function sanitizeConfig(body) {
  const out = {};
  if (!body || typeof body !== 'object') return out;
  for (const k of CONFIG_KEYS) {
    if (body[k] === undefined) continue;
    if (k === 'notice') out[k] = String(body[k]).slice(0, 400);
    else if (k === 'title') out[k] = String(body[k]).slice(0, 60);
    else if (k === 'photoMode') out[k] = body[k] === 'text' ? 'text' : 'photo';
    else if (k === 'deadline') out[k] = String(body[k]).slice(0, 40);
    else if (k === 'bgPattern') out[k] = ['plain', 'stripe', 'dot', 'image'].includes(body[k]) ? body[k] : 'stripe';
    else if (k === 'font') out[k] = String(body[k]).slice(0, 12);
    else if (typeof DEFAULT_CONFIG[k] === 'number') out[k] = num(body[k], DEFAULT_CONFIG[k]);
    else out[k] = String(body[k]).slice(0, 40);
  }
  return out;
}

function publicConfig(cfg, origin) {
  return {
    ...cfg,
    centerUrl: cfg.centerImg ? origin + '/api/photo/__center__' : null,
    bgUrl: cfg.bgImage ? origin + '/api/photo/__bg__' : null
  };
}

function withPhoto(post, origin) {
  return { ...post, photo: post.hasPhoto ? origin + '/api/photo/' + encodeURIComponent(post.id) : null };
}

/**
 * @returns {{status:number, json?:object, photo?:string, contentType?:string}}
 *   photo は base64 文字列（トランスポート側でデコードして配信）
 */
export async function handleApi(ctx, kv, adminKey) {
  const { method, segments: seg, query, body, headers, origin } = ctx;

  const res = (status, json) => ({ status, json });
  const isAdmin = () => {
    const m = String(headers.authorization || '').match(/^Bearer\s+(.+)$/i);
    return !!(m && adminKey && m[1] === adminKey);
  };
  const needAdmin = () => { if (!isAdmin()) { const e = new Error('管理者キーが正しくありません'); e.status = 401; throw e; } };
  const auth = async () => {
    const customId = String((body && body.customId) || query.c || '');
    const token = String((body && body.token) || query.t || '');
    const rec = await getJSON(kv, 'link:' + customId, null);
    if (!rec || rec.token !== token) { const e = new Error('リンクが無効です'); e.status = 401; throw e; }
    return rec;
  };

  // ---- 画像配信（公開） ----
  if (seg[0] === 'photo' && method === 'GET') {
    const b64 = await kv.get('photo:' + seg.slice(1).join('/'));
    if (b64 == null) return res(404, { error: 'not found' });
    return { status: 200, photo: b64, contentType: 'image/jpeg' };
  }

  // ---- 設定 ----
  if (seg[0] === 'config') {
    if (method === 'GET') {
      const cfg = await getJSON(kv, CFG_KEY, DEFAULT_CONFIG);
      return res(200, publicConfig({ ...DEFAULT_CONFIG, ...cfg }, origin));
    }
    if (method === 'PUT') {
      needAdmin();
      const cur = await getJSON(kv, CFG_KEY, DEFAULT_CONFIG);
      const next = { ...DEFAULT_CONFIG, ...cur, ...sanitizeConfig(body) };
      await kv.put(CFG_KEY, JSON.stringify(next));
      return res(200, publicConfig(next, origin));
    }
  }

  // ---- 画像アセット（中心地 / 背景・管理者のみ） ----
  if (seg[0] === 'asset' && seg[1]) {
    needAdmin();
    const name = seg[1].replace(/[^a-z0-9_]/gi, '');
    const flag = name === 'center' ? 'centerImg' : name === 'bg' ? 'bgImage' : null;
    if (!flag) return res(400, { error: '不明なアセットです' });
    const cfg = await getJSON(kv, CFG_KEY, DEFAULT_CONFIG);
    if (method === 'PUT') {
      const b64 = String((body && body.dataUrl) || '').split(',')[1] || '';
      if (!b64) return res(400, { error: '画像データがありません' });
      await kv.put('photo:__' + name + '__', b64);
      cfg[flag] = true;
      await kv.put(CFG_KEY, JSON.stringify(cfg));
      return res(200, { ok: true });
    }
    if (method === 'DELETE') {
      await kv.delete('photo:__' + name + '__');
      cfg[flag] = false;
      await kv.put(CFG_KEY, JSON.stringify(cfg));
      return res(200, { ok: true });
    }
  }

  // ---- 個別リンク発行（管理者のみ） ----
  if (seg[0] === 'links') {
    needAdmin();
    if (method === 'POST') {
      const customId = String((body && body.customId) || '').trim();
      const displayName = String((body && body.displayName) || '').trim().slice(0, 24);
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(customId)) return res(400, { error: 'カスタムidは英数字・_・- のみ使えます' });
      if (!displayName) return res(400, { error: '表示名を入力してください' });
      if (await kv.get('link:' + customId)) return res(409, { error: 'そのカスタムidは既に発行済みです' });
      const rec = { customId, displayName, token: rid(12), createdAt: Date.now() };
      await kv.put('link:' + customId, JSON.stringify(rec));
      return res(200, rec);
    }
    if (method === 'GET') {
      const keys = await kv.list('link:');
      const links = [];
      for (const k of keys) {
        const r = await getJSON(kv, k, null);
        if (!r) continue;
        links.push({ ...r, posted: (await kv.get('post:' + r.customId)) != null });
      }
      links.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      return res(200, { links });
    }
  }
  if (seg[0] === 'link' && seg[1] && method === 'DELETE') {
    needAdmin();
    await kv.delete('link:' + seg[1]);
    return res(200, { ok: true });
  }

  // ---- 本人確認（投稿者：表示名と既存投稿を取得） ----
  if (seg[0] === 'whoami' && method === 'GET') {
    const rec = await auth();
    const post = await getJSON(kv, 'post:' + rec.customId, null);
    const cfg = await getJSON(kv, CFG_KEY, DEFAULT_CONFIG);
    return res(200, {
      customId: rec.customId, displayName: rec.displayName,
      photoMode: cfg.photoMode, deadline: cfg.deadline,
      post: post ? withPhoto(post, origin) : null
    });
  }

  // ---- 全投稿＋設定（公開・閲覧/収集画面用） ----
  if (seg[0] === 'feed' && method === 'GET') {
    const cfg = await getJSON(kv, CFG_KEY, DEFAULT_CONFIG);
    const keys = await kv.list('post:');
    const posts = [];
    for (const k of keys) {
      const p = await getJSON(kv, k, null);
      if (p) posts.push(withPhoto(p, origin));
    }
    posts.sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
    return res(200, { config: publicConfig({ ...DEFAULT_CONFIG, ...cfg }, origin), posts });
  }

  // ---- 投稿の削除（管理者：idをパスで指定） ----
  if (seg[0] === 'post' && seg[1] && method === 'DELETE') {
    needAdmin();
    await kv.delete('post:' + seg[1]);
    await kv.delete('photo:' + seg[1]);
    return res(200, { ok: true });
  }

  // ---- 投稿の作成/更新・削除（投稿者） ----
  if (seg[0] === 'post' && !seg[1]) {
    const rec = await auth();
    if (method === 'DELETE') {
      await kv.delete('post:' + rec.customId);
      await kv.delete('photo:' + rec.customId);
      return res(200, { ok: true });
    }
    if (method === 'POST') {
      const cfg = await getJSON(kv, CFG_KEY, DEFAULT_CONFIG);
      if (cfg.deadline) {
        const t = Date.parse(cfg.deadline);
        if (!isNaN(t) && Date.now() > t) return res(403, { error: '受付期間が終了しました' });
      }
      const cur = await getJSON(kv, 'post:' + rec.customId, null);
      let hasPhoto = false;
      if (cfg.photoMode === 'photo') {
        const dataUrl = body && body.photo;
        if (dataUrl && /^data:/.test(dataUrl)) {
          await kv.put('photo:' + rec.customId, dataUrl.split(',')[1] || '');
          hasPhoto = true;
        } else if (body && body.keepPhoto && cur && cur.hasPhoto) {
          hasPhoto = true;
        } else {
          await kv.delete('photo:' + rec.customId);
          hasPhoto = false;
        }
      }
      const post = {
        id: rec.customId, name: rec.displayName,
        comment: String((body && body.comment) || '').slice(0, 200),
        x: clamp(body && body.x, 120, 1480, 800),
        y: clamp(body && body.y, 140, 1460, 800),
        deg: clamp(body && body.deg, -12, 12, 0),
        hasPhoto, updatedAt: Date.now()
      };
      await kv.put('post:' + rec.customId, JSON.stringify(post));
      return res(200, withPhoto(post, origin));
    }
  }

  // ---- 全投稿の一括削除（管理者）: 投稿本文と写真を消す。リンク・デザインは残す ----
  if (seg[0] === 'posts' && method === 'DELETE') {
    needAdmin();
    const keys = await kv.list('post:');
    for (const k of keys) {
      const id = k.slice('post:'.length);
      await kv.delete(k);
      await kv.delete('photo:' + id);
    }
    return res(200, { ok: true, deleted: keys.length });
  }

  // ---- 環境の初期化（管理者）: 投稿・写真・リンク・設定をすべて削除 ----
  if (seg[0] === 'reset' && method === 'POST') {
    needAdmin();
    for (const prefix of ['post:', 'photo:', 'link:']) {
      const keys = await kv.list(prefix);
      for (const k of keys) await kv.delete(k);
    }
    await kv.delete(CFG_KEY);
    return res(200, { ok: true });
  }

  return res(404, { error: 'not found' });
}

export { DEFAULT_CONFIG };
