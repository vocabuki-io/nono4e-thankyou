/*
 * 寄せ書き 共有データレイヤ
 * - 読み取り: GitHub Pages 上の docs/data/*(同一オリジン)を fetch するだけ
 * - 書き込み: GitHub Contents API を投稿キー(Fine-grained PAT)で直接呼ぶ
 *   投稿キーは招待リンクの「#k=トークン」から localStorage に保存され、
 *   リポジトリにはコミットされない
 */
(function () {
  const CFG = {
    owner: 'vocabuki-io',
    repo: 'nono4e-thankyou',
    branch: 'main',
    root: 'docs'
  };
  const TOKEN_KEY = 'yosegaki-token-v1';

  (function pickTokenFromUrl() {
    const m = location.hash.match(/[#&]k=([^&]+)/);
    if (!m) return;
    try { localStorage.setItem(TOKEN_KEY, decodeURIComponent(m[1])); } catch (e) {}
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
  })();

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }
  function setToken(t) {
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (e) {}
  }

  function utf8ToB64(s) { return btoa(unescape(encodeURIComponent(s))); }
  function b64ToUtf8(s) { return decodeURIComponent(escape(atob(s.replace(/\s/g, '')))); }

  function headers() {
    const h = { Accept: 'application/vnd.github+json' };
    const t = getToken();
    if (t) h.Authorization = 'Bearer ' + t;
    return h;
  }
  function contentsUrl(path) {
    return 'https://api.github.com/repos/' + CFG.owner + '/' + CFG.repo + '/contents/' + path;
  }
  function fail(status, message) {
    const e = new Error(message);
    e.status = status;
    return e;
  }
  function authError() { return fail(401, '投稿キーが正しくないか、権限がありません'); }

  async function getFile(path) {
    const res = await fetch(contentsUrl(path) + '?ref=' + CFG.branch + '&t=' + Date.now(), { headers: headers() });
    if (res.status === 404) return null;
    if (res.status === 401 || res.status === 403) throw authError();
    if (!res.ok) throw fail(res.status, '読み込みに失敗しました (' + res.status + ')');
    return res.json();
  }

  async function putFile(path, contentB64, message) {
    for (let i = 0; i < 4; i++) {
      const cur = await getFile(path);
      const body = { message: message, branch: CFG.branch, content: contentB64 };
      if (cur && cur.sha) body.sha = cur.sha;
      const res = await fetch(contentsUrl(path), { method: 'PUT', headers: headers(), body: JSON.stringify(body) });
      if (res.ok) return;
      if (res.status === 401 || res.status === 403) throw authError();
      if (res.status !== 409 && res.status !== 422) throw fail(res.status, '保存に失敗しました (' + res.status + ')');
      await new Promise(r => setTimeout(r, 350 * (i + 1)));
    }
    throw fail(409, '混み合っています。少し待ってからもう一度お試しください');
  }

  // 同時投稿で上書きし合わないよう、毎回最新を取得し直して sha 競合時はリトライする
  async function updateJsonFile(path, mutate, message) {
    for (let i = 0; i < 4; i++) {
      const cur = await getFile(path);
      let data = [];
      if (cur && cur.content) {
        try { data = JSON.parse(b64ToUtf8(cur.content)); } catch (e) { data = []; }
      }
      if (!Array.isArray(data)) data = [];
      const next = mutate(data);
      const body = { message: message, branch: CFG.branch, content: utf8ToB64(JSON.stringify(next, null, 1)) };
      if (cur && cur.sha) body.sha = cur.sha;
      const res = await fetch(contentsUrl(path), { method: 'PUT', headers: headers(), body: JSON.stringify(body) });
      if (res.ok) return;
      if (res.status === 401 || res.status === 403) throw authError();
      if (res.status !== 409 && res.status !== 422) throw fail(res.status, '保存に失敗しました (' + res.status + ')');
      await new Promise(r => setTimeout(r, 350 * (i + 1)));
    }
    throw fail(409, '混み合っています。少し待ってからもう一度お試しください');
  }

  async function deleteFile(path, message) {
    const cur = await getFile(path);
    if (!cur) return;
    const res = await fetch(contentsUrl(path), {
      method: 'DELETE', headers: headers(),
      body: JSON.stringify({ message: message, branch: CFG.branch, sha: cur.sha })
    });
    if (res.ok || res.status === 404) return;
    if (res.status === 401 || res.status === 403) throw authError();
    throw fail(res.status, '削除に失敗しました (' + res.status + ')');
  }

  async function loadPosts() {
    try {
      const res = await fetch('data/posts.json?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return [];
      const j = await res.json();
      return Array.isArray(j) ? j : [];
    } catch (e) { return []; }
  }

  async function loadTheme() {
    try {
      const res = await fetch('data/theme.json?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) { return null; }
  }

  async function savePost(post, opt) {
    opt = opt || {};
    if (opt.photoDataUrl) {
      await putFile(CFG.root + '/data/photos/' + post.id + '.jpg', opt.photoDataUrl.split(',')[1], '写真を更新: ' + post.name);
      post.photo = 'data/photos/' + post.id + '.jpg';
    } else if (opt.removePhoto) {
      await deleteFile(CFG.root + '/data/photos/' + post.id + '.jpg', '写真を削除: ' + post.name);
      post.photo = null;
    }
    await updateJsonFile(
      CFG.root + '/data/posts.json',
      arr => arr.filter(p => p && p.id !== post.id).concat([post]),
      '寄せ書き: ' + post.name
    );
  }

  async function deletePost(id, name) {
    await updateJsonFile(
      CFG.root + '/data/posts.json',
      arr => arr.filter(p => p && p.id !== id),
      '投稿を削除: ' + (name || id)
    );
    await deleteFile(CFG.root + '/data/photos/' + id + '.jpg', '写真を削除: ' + (name || id));
  }

  async function saveTheme(theme) {
    await putFile(CFG.root + '/data/theme.json', utf8ToB64(JSON.stringify(theme, null, 1)), 'デザイン設定を更新');
  }

  async function saveCenterImage(dataUrl) {
    await putFile(CFG.root + '/data/center.jpg', dataUrl.split(',')[1], '中心地画像を更新');
  }

  async function removeCenterImage() {
    await deleteFile(CFG.root + '/data/center.jpg', '中心地画像を削除');
  }

  window.Yosegaki = {
    getToken, setToken,
    loadPosts, loadTheme,
    savePost, deletePost,
    saveTheme, saveCenterImage, removeCenterImage
  };
})();
