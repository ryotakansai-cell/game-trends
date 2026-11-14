// wrangler types は wrangler.jsonc の vars しか型にしないので、
// `wrangler secret put` で登録する秘密の値はここで型を足す
interface Env {
  CRON_SECRET: string;
  // App Store のワークフローを動かすための GitHub のトークン（Actions だけを動かせるもの）。無くても動く
  GITHUB_TOKEN?: string;
  // healthchecks.io の Ping key（プロジェクトの Settings にある）。収集の見張りの合図に使う。無ければ見張りを省略
  HEALTHCHECKS_PING_KEY?: string;
  // 試す用：何分より古い記録を「止まった」とみなすか。普段は入れない（既定は index.ts の DEFAULT_STALE_MINUTES）
  STALE_MINUTES?: string;
}
