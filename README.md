# 寄せ書き

地図の上にみんなの封筒(メッセージ+写真)をピンで置いていく寄せ書きサイト。
GitHub Pages(`docs/` ディレクトリ)で動く静的サイトで、サーバーは使いません。

## ページ構成

| ページ | 役割 |
|---|---|
| `docs/index.html` | メニュー |
| `docs/viewer.html` | みんなの投稿を閲覧(封筒タップでメッセージ・写真を表示) |
| `docs/contribute.html` | 地図にピンを置いてメッセージを投稿・編集・削除 |
| `docs/editor.html` | 見た目の調整エディタ(幹事用)。「公開デザインとして保存」で全員に反映 |

## データの仕組み

- 投稿データはこのリポジトリの `docs/data/` にコミットされます
  - `docs/data/posts.json` — 全投稿(名前・メッセージ・位置・写真パス)
  - `docs/data/photos/<id>.jpg` — 投稿写真
  - `docs/data/theme.json` — エディタで保存した公開デザイン設定
  - `docs/data/center.jpg` — 中心地の画像
- **読み取り**: GitHub Pages 上の同一オリジンから `fetch` するだけ(キー不要)
- **書き込み**: ブラウザから GitHub Contents API を直接呼びます。認証には「投稿キー」(Fine-grained PAT)を使います
- 同時投稿は sha の競合検出+リトライで保護しています
- 投稿してから viewer に反映されるまで、GitHub Pages の再デプロイぶん(1〜2分)かかります

## 幹事のセットアップ

1. GitHub で Fine-grained personal access token を作成する
   - **Repository access**: このリポジトリのみ
   - **Permissions**: Contents → Read and write(それ以外は不要)
   - 有効期限は寄せ書きの受付期間に合わせて短めに
2. 招待リンクを参加者に配る(URLの `#k=` 以降がトークン):

   ```
   https://<あなたのPagesドメイン>/contribute.html#k=<トークン>
   ```

   リンクを開くとトークンは端末の localStorage に保存され、URLからは即座に消えます。
3. デザインを調整する場合は `editor.html` を開き、「配置」タブ →「公開デザインとして保存」

## 注意事項

- 招待リンクを持っている人は誰でもこのリポジトリの**コンテンツを書き換えられます**。リンクは参加者以外に共有しないでください。寄せ書き専用のリポジトリで運用することを推奨します
- トークンをリポジトリ内のファイルに書かないでください(GitHub の secret scanning により自動失効します)
- 受付終了後はトークンを失効(revoke)させれば、サイトは閲覧専用になります

## ローカル開発

```sh
cd docs && python3 -m http.server 8000
```

`http://localhost:8000` で確認できます。書き込み操作は本物のリポジトリに対して行われる点に注意してください。
