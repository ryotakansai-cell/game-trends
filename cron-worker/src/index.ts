// 毎時のスナップショット収集を、Cloudflare の Cron Triggers から呼び出す。
//
// 以前は GitHub Actions の schedule で呼んでいたが、混雑時に実行が飛ばされ、
// 毎時のはずが実際は4〜6時間おきだった（2026/10 に実行履歴とDBで確認）。
// Cron Triggers は時刻どおりに動き、無料プランでも使える。
//
// 収集の処理そのものは Vercel 側の API にあり、ここは「時間になったら叩く」だけ。
// 処理を移さないのは、DB や各APIのキーを Vercel の1か所に置いたままにするため。

// cron式（wrangler.jsonc の triggers.crons）→ 呼び出すAPI
// Twitch と YouTube の時刻をずらしているのは、同時に走らせて
// Vercel 側の関数の実行が重ならないようにするため
const JOBS: Record<string, string> = {
  "23 * * * *": "/api/cron/snapshot",
  "38 * * * *": "/api/cron/youtube-snapshot",
};

export default {
  async scheduled(controller, env) {
    const path = JOBS[controller.cron];
    if (!path) throw new Error(`未登録のcron式です: ${controller.cron}`);

    const res = await fetch(`${env.SITE_URL}${path}`, {
      headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
      // 転送（3xx）を追わずに失敗として扱う。旧URLへの転送に気づかず
      // 「成功したのにデータが保存されない」状態になるのを防ぐため
      redirect: "manual",
    });

    // 例外にすると Cloudflare のダッシュボードで「失敗」として記録される
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`${path} が失敗しました: ${res.status} ${body.slice(0, 200)}`);
    }
    console.log(`${path} 成功: ${res.status}`);
  },
} satisfies ExportedHandler<Env>;
