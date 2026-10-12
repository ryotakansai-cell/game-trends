// 毎時のスナップショット収集を、Cloudflare の Cron Triggers から呼び出す。
//
// 以前は GitHub Actions の schedule で呼んでいたが、混雑時に実行が飛ばされ、
// 毎時のはずが実際は4〜6時間おきだった（2026/10 に実行履歴とDBで確認）。
// Cron Triggers は時刻どおりに動く。
//
// 収集の処理そのものはサイト側の API にあり、ここは「時間になったら叩く」だけ。
// 処理を移さないのは、DB や各APIのキーをサイトの1か所に置いたままにするため。

/** 1つの仕事。サイトの API を呼ぶか、GitHub Actions のワークフローを動かすか */
type Job = { path: string } | { githubWorkflow: string };

// cron式（wrangler.jsonc の triggers.crons）→ その時刻にやる仕事。
// 時刻をずらしているのは、同時に走らせてサイト側の処理が重ならないようにするため
const JOBS: Record<string, Job[]> = {
  "23 * * * *": [{ path: "/api/cron/snapshot" }],
  "38 * * * *": [{ path: "/api/cron/youtube-snapshot" }],
  // 1日1回：前日の毎時の記録を日ごとの集計にまとめ、90日より古い記録を消す
  "53 20 * * *": [{ path: "/api/cron/daily" }],
  // Bluesky への投稿（日本時間8時：前日のまとめ、12・18・21時：いま見られている配信）
  "0 23 * * *": [{ path: "/api/cron/bluesky?kind=daily" }],
  "0 3,9,12 * * *": [{ path: "/api/cron/bluesky?kind=live" }],
  "8 * * * *": [
    // 毎時：ゲームを遊んでいる人数（Steam・Roblox）
    { path: "/api/cron/play-snapshot" },
    // 毎時：App Store の順位。Apple が Cloudflare からの RSS の読み取りを拒否するので、
    // GitHub の回線で読むワークフロー（.github/workflows/appstore.yml）をここから動かす。
    // GitHub 自身の定期実行は4〜5時間おきにしか動かなかった（2026-10-12 に実行履歴で確認）。
    // 予定（cron 式）を増やさず、毎時8分の仕事に相乗りさせている
    { githubWorkflow: "appstore.yml" },
  ],
  // 毎時：ツイキャスの配信中の記録
  "48 * * * *": [{ path: "/api/cron/twitcasting-snapshot" }],
  // 毎時：Kick の配信中の記録
  "13 * * * *": [{ path: "/api/cron/kick-snapshot" }],
};

const REPO = "ryotakansai-cell/game-trends";

async function run(job: Job, env: Env): Promise<string> {
  if ("githubWorkflow" in job) {
    // 鍵（Actions だけを動かせる GitHub のトークン）が無いあいだは何もしない。
    // その間は GitHub 自身の定期実行（4〜5時間おき）だけで集める
    if (!env.GITHUB_TOKEN) return `${job.githubWorkflow}: 鍵が無いので省略`;
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/actions/workflows/${job.githubWorkflow}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          // GitHub の API は User-Agent が無いと断る
          "User-Agent": "stream-trends-cron",
        },
        body: JSON.stringify({ ref: "main" }),
      },
    );
    // 成功すると 204（中身なし）が返る
    if (res.status !== 204) {
      throw new Error(
        `${job.githubWorkflow} の起動に失敗: ${res.status} ${(await res.text()).slice(0, 200)}`,
      );
    }
    return `${job.githubWorkflow} を起動`;
  }

  const res = await fetch(`${env.SITE_URL}${job.path}`, {
    headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
    // 転送（3xx）を追わずに失敗として扱う。旧URLへの転送に気づかず
    // 「成功したのにデータが保存されない」状態になるのを防ぐため
    redirect: "manual",
  });
  if (!res.ok) {
    throw new Error(
      `${job.path} が失敗しました: ${res.status} ${(await res.text()).slice(0, 200)}`,
    );
  }
  return `${job.path} 成功: ${res.status}`;
}

export default {
  async scheduled(controller, env) {
    const jobs = JOBS[controller.cron];
    if (!jobs) throw new Error(`未登録のcron式です: ${controller.cron}`);

    // 同じ時刻の仕事は同時に動かす。1つが失敗しても、ほかは最後まで動かす
    const results = await Promise.allSettled(jobs.map((j) => run(j, env)));
    const errors: string[] = [];
    for (const r of results) {
      if (r.status === "fulfilled") console.log(r.value);
      else errors.push(String(r.reason));
    }
    // 例外にすると Cloudflare のダッシュボードで「失敗」として記録される
    if (errors.length > 0) throw new Error(errors.join(" / "));
  },
} satisfies ExportedHandler<Env>;
