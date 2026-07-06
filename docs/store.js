/*
 * 寄せ書き クライアント側データレイヤ
 *
 * 2フェーズ構成:
 *  - 収集フェーズ（動的）: window.YOSEGAKI.api に Cloudflare Worker の URL がある場合。
 *    閲覧は /api/feed、投稿は個別リンクのトークンで /api/post。
 *  - 完成フェーズ（静的）: api が未設定の場合。焼き固めた docs/data/*.json を読むだけ。
 *
 * api の URL は docs/config.js（デプロイ時に設定）または localStorage 'yg-api'
 * （管理者が admin.html から一時設定）で与える。
 */
(function () {
  const CFG = (window.YOSEGAKI || {});
  function apiBase() {
    let ov = '';
    try { ov = localStorage.getItem('yg-api') || ''; } catch (e) {}
    return (ov || CFG.api || '').replace(/\/$/, '');
  }
  const isApi = () => !!apiBase();

  // ---- 個別リンクの取り込み: contribute.html?c=<id>#t=<token> ----
  (function captureIdentity() {
    const params = new URLSearchParams(location.search);
    const c = params.get('c');
    const hm = location.hash.match(/[#&]t=([^&]+)/);
    const t = hm ? decodeURIComponent(hm[1]) : '';
    if (c && t) {
      try {
        localStorage.setItem('yg-cid', c);
        localStorage.setItem('yg-token:' + c, t);
      } catch (e) {}
      // トークンを URL から消す（履歴/リファラに残さない）
      try { history.replaceState(null, '', location.pathname); } catch (e) {}
    }
  })();

  function identity() {
    let c = '';
    try { c = localStorage.getItem('yg-cid') || ''; } catch (e) {}
    if (!c) {
      const p = new URLSearchParams(location.search).get('c');
      if (p) c = p;
    }
    if (!c) return null;
    let token = '';
    try { token = localStorage.getItem('yg-token:' + c) || ''; } catch (e) {}
    return { customId: c, token };
  }

  function fail(status, message) { const e = new Error(message); e.status = status; return e; }

  async function apiFetch(pathname, opt) {
    opt = opt || {};
    const res = await fetch(apiBase() + pathname, opt);
    const ct = res.headers.get('Content-Type') || '';
    const data = ct.includes('json') ? await res.json().catch(() => ({})) : null;
    if (!res.ok) throw fail(res.status, (data && data.error) || ('通信に失敗しました (' + res.status + ')'));
    return data;
  }

  // ---- 閲覧（両モード共通） ----
  async function loadFeed() {
    if (isApi()) {
      return apiFetch('/api/feed?t=' + Date.now());
    }
    // 静的（完成フェーズ）
    const [config, posts] = await Promise.all([
      fetch('data/config.json?t=' + Date.now(), { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('data/posts.json?t=' + Date.now(), { cache: 'no-store' }).then(r => r.ok ? r.json() : []).catch(() => [])
    ]);
    return { config: config || {}, posts: Array.isArray(posts) ? posts : [] };
  }

  // ---- 投稿者（収集フェーズのみ） ----
  async function whoami() {
    const id = identity();
    if (!id || !id.token) throw fail(401, 'リンクが無効です。招待リンクから開いてください');
    return apiFetch('/api/whoami?c=' + encodeURIComponent(id.customId) + '&t=' + encodeURIComponent(id.token) + '&r=' + Date.now());
  }

  async function savePost(data) {
    const id = identity();
    if (!id || !id.token) throw fail(401, 'リンクが無効です');
    const payload = Object.assign({ customId: id.customId, token: id.token }, data);
    return apiFetch('/api/post', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
  }

  async function deletePost() {
    const id = identity();
    if (!id || !id.token) throw fail(401, 'リンクが無効です');
    return apiFetch('/api/post', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customId: id.customId, token: id.token })
    });
  }

  // ---- 管理者 ----
  const admin = {
    setApi(url) { try { url ? localStorage.setItem('yg-api', url.replace(/\/$/, '')) : localStorage.removeItem('yg-api'); } catch (e) {} },
    getApi: apiBase,
    setKey(k) { try { k ? localStorage.setItem('yg-admin', k) : localStorage.removeItem('yg-admin'); } catch (e) {} },
    getKey() { try { return localStorage.getItem('yg-admin') || ''; } catch (e) { return ''; } },
    hasKey() { return !!admin.getKey(); },
    _headers() { return { 'Content-Type': 'application/json', Authorization: 'Bearer ' + admin.getKey() }; },
    getConfig() { return apiFetch('/api/config?t=' + Date.now()); },
    putConfig(patch) { return apiFetch('/api/config', { method: 'PUT', headers: admin._headers(), body: JSON.stringify(patch) }); },
    uploadAsset(name, dataUrl) { return apiFetch('/api/asset/' + name, { method: 'PUT', headers: admin._headers(), body: JSON.stringify({ dataUrl }) }); },
    deleteAsset(name) { return apiFetch('/api/asset/' + name, { method: 'DELETE', headers: admin._headers() }); },
    issueLink(customId, displayName) { return apiFetch('/api/links', { method: 'POST', headers: admin._headers(), body: JSON.stringify({ customId, displayName }) }); },
    listLinks() { return apiFetch('/api/links?t=' + Date.now(), { headers: admin._headers() }); },
    revokeLink(customId) { return apiFetch('/api/link/' + encodeURIComponent(customId), { method: 'DELETE', headers: admin._headers() }); },
    listPosts() { return apiFetch('/api/feed?t=' + Date.now()).then(f => (f && f.posts) || []); },
    deletePost(customId) { return apiFetch('/api/post/' + encodeURIComponent(customId), { method: 'DELETE', headers: admin._headers() }); }
  };

  function linkFor(customId, token) {
    const base = location.origin + location.pathname.replace(/[^/]*$/, '') + 'contribute.html';
    return base + '?c=' + encodeURIComponent(customId) + '#t=' + encodeURIComponent(token);
  }

  window.Yosegaki = {
    isApi, apiBase,
    identity, whoami, loadFeed, savePost, deletePost,
    admin, linkFor
  };
})();
