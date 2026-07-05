/*
 * サイト設定。デプロイ時にここを書き換えます。
 *  - 収集フェーズ: api に Cloudflare Worker の URL を設定
 *      例) api: "https://yosegaki.<あなた>.workers.dev"
 *  - 完成フェーズ（焼き固め後）: api: "" にすると静的な docs/data/*.json を読みます
 */
window.YOSEGAKI = {
  api: "",
  basePath: ""
};
