import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";
import memoryQueue from "@opennextjs/cloudflare/overrides/queue/memory-queue";

// revalidate で作り置きしたページを R2 に保存する。
// Workers はリクエストごとに使い捨ての実行環境なので、メモリに置いても次に残らないため
export default defineCloudflareConfig({
  incrementalCache: r2IncrementalCache,
  // 期限が切れた作り置きを、裏で作り直す役。指定しないと「何もしない」になり、
  // ○ のページ（/games・Steam・Roblox・sitemap など）がデプロイした時の中身のまま止まっていた
  // （2026-10-11 に Steam のページが記録なしのまま固まって発覚）。
  // メモリーキューは、開かれたときに Worker が自分自身（wrangler.jsonc の WORKER_SELF_REFERENCE）を
  // 呼んで作り直す。同じページの作り直しは、同じ実行環境の中では1回にまとめる
  queue: memoryQueue,
});
