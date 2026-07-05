# 寄せ書き

Google Maps風の平面マップに、Wii伝言板のような封筒＋📍ピンでメッセージを寄せていく寄せ書きサービス。

## 2フェーズ構成

| フェーズ | 状態 | 技術 |
|---|---|---|
| 収集フェーズ | 動的（寄稿者が投稿できる） | Cloudflare Workers + KV（`worker/`） |
| 完成フェーズ | 静的・不変・永久 | 焼き固めた `docs/data/*.json` → GitHub Pages |

`docs/config.js` の `api` に Worker の URL を入れると収集フェーズ、空にすると静的な完成フェーズとして動きます。

## ページ構成（`docs/`）

| ページ | 役割 |
|---|---|
| `index.html` | メニュー |
| `viewer.html` | みんなの投稿を閲覧（封筒タップでメッセージ・写真、名前検索、現在地ボタン） |
| `contribute.html` | 個人リンクから開き、地図にピンを置いて投稿・編集・移動・削除 |
| `admin.html` | 幹事用。収集設定・背景・中心地・**個人リンクの発行** |
| `editor.html` | 封筒/ピン/配色をスライダーで微調整し、公開設定へ反映 |

## バックエンド（`worker/`）

Cloudflare Worker が収集フェーズの API を提供します。書き込み権限はサーバー側に隠れ、
ブラウザには一切露出しません。API ロジックは `worker/src/core.js` に集約し、
本番（Worker）とローカルモック（`tools/mock-server.mjs`）で共有しています。

主なエンドポイント:

- `GET  /api/feed` — 全投稿＋公開設定（閲覧・収集画面用、公開）
- `GET  /api/config` — 公開設定（公開）
- `GET  /api/whoami?c=&t=` — 個人リンクの本人確認＋自分の既存投稿（トークン必須）
- `POST /api/post` / `DELETE /api/post` — 投稿の作成/更新・削除（`customId`＋トークンを照合）
- `PUT  /api/config` / `PUT|DELETE /api/asset/:name` / `POST|GET /api/links` / `DELETE /api/link/:id` — 管理者専用（`Authorization: Bearer <ADMIN_KEY>`）
- `GET  /api/photo/:key` — 画像配信

### なりすまし防止

管理者が個人リンクを発行すると、`カスタムid → ランダムトークン` が KV に保存されます
（`link:<customId>`）。投稿時はこの2つを照合するため、**カスタムidを知っているだけでは
他人として投稿できません**。表示名も発行時に確定し、投稿者は変更できません。

## セットアップ（幹事）

### 1. Worker をデプロイ

```sh
cd worker
npx wrangler kv namespace create YOSEGAKI_KV   # 出力の id を wrangler.toml に貼る
npx wrangler secret put ADMIN_KEY              # 管理者キーを設定
npx wrangler deploy
```

### 2. サイトを Worker に接続

`docs/config.js` の `api` にデプロイした Worker の URL を設定してコミット
（例: `api: "https://yosegaki.xxx.workers.dev"`）。
※ `admin.html` から一時的に接続先を設定して試すこともできます（この端末にのみ保存）。

### 3. 収集設定と個人リンク発行

`admin.html` を開き、管理者キーで接続 → タイトル・注意書き・投稿モード（写真あり/なし）・
締切・背景・中心地画像を設定し、参加者ごとに個人リンクを発行して配布します。

- リンク形式: `contribute.html?c=<カスタムid>#t=<トークン>`
- 開くとトークンは端末に保存され、URL からは即消去されます

### 4. 完成後の焼き固め（永久保存）

受付終了後、収集データを `docs/data/` に焼き込んで静的化します（`docs/config.js` の
`api` を空にすると `docs/data/*.json` を読む完成フェーズになります）。
`GET /api/feed` と `/api/photo/*` を取得して `docs/data/posts.json` / `config.json` /
`photos/` に書き出す焼き固めスクリプトは今後追加予定です。

## ローカル開発・テスト

Worker と同じ `core.js` を使うモックサーバーで、Cloudflare なしに全フローを試せます。

```sh
node tools/mock-server.mjs 8787 --admin=admin-secret
# http://localhost:8787/admin.html を開き、URL に http://localhost:8787、キーに admin-secret
```

## 注意事項

- 個人リンクは本人に直接渡してください（トークンが本人性の担保です）
- `ADMIN_KEY` や KV id はコミットしないでください（`wrangler secret` / ローカル設定で管理）
- 完成フェーズに移す＝ Worker を止めても、Git に焼き込んだ本体は永久に残ります
