// wrangler types は wrangler.jsonc の vars しか型にしないので、
// `wrangler secret put` で登録する秘密の値はここで型を足す
interface Env {
  CRON_SECRET: string;
  // App Store のワークフローを動かすための GitHub のトークン（Actions だけを動かせるもの）。無くても動く
  GITHUB_TOKEN?: string;
}
