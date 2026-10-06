import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";

// revalidate で作り置きしたページを R2 に保存する。
// Workers はリクエストごとに使い捨ての実行環境なので、メモリに置いても次に残らないため
export default defineCloudflareConfig({
  incrementalCache: r2IncrementalCache,
});
