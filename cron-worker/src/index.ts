// 毎時のスナップショット収集を、Cloudflare の Cron Triggers から呼び出す。
//
// 以前は GitHub Actions の schedule で呼んでいたが、混雑時に実行が飛ばされ、
// 毎時のはずが実際は4〜6時間おきだった（2026/10 に実行履歴とDBで確認）。
// Cron Triggers は時刻どおりに動く。
//
// 収集の処理そのものはサイト側の API にあり、ここは「時間になったら叩く」だけ。
// 処理を移さないのは、DB や各APIのキーをサイトの1か所に置いたままにするため。

/** 1つの仕事。サイトの API を呼ぶか、GitHub Actions のワークフローを動かすか、収集の見張りをするか */
type Job =
  { path: string } | { githubWorkflow: string } | { healthCheck: true };

// cron式（wrangler.jsonc の triggers.crons）→ その時刻にやる仕事。
// 時刻をずらしているのは、同時に走らせてサイト側の処理が重ならないようにするため。
// 配信の収集の時刻を変えたら、サイト側の lib/platforms.ts の snapshotMinute も合わせる
// （急上昇などの作り置きを、収集が終わった頃に切り替えるのに使っている）
const JOBS: Record<string, Job[]> = {
  "23 * * * *": [
    { path: "/api/cron/snapshot" },
    // 毎時：収集が止まっていないかの見張り（checkHealth）。毎時1回動けばよいので、
    // cron 式を増やさず既存の仕事に相乗りさせている。読む行数は1回あたり約5,000行
    // （2026-11-14 の実測。1日約13万行で、D1 の読み取り全体の0.4%ほど）
    { healthCheck: true },
  ],
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
  // 手元で見張りだけを試す入口（`wrangler dev --test-scheduled` で /__scheduled?cron=health を開く）。
  // 23分の仕事ごと動かすと Twitch の収集まで本番の D1 に書き込んでしまうため分けた。
  // wrangler.jsonc の triggers に書いていないので、本番でこれが動くことはない
  health: [{ healthCheck: true }],
};

const REPO = "ryotakansai-cell/game-trends";

// ---- 収集の見張り（healthchecks.io） ----
//
// 2026-10-28 からツイキャスの収集が2週間以上止まっていたのに、失敗はここのログに出るだけで
// 誰も気づかなかった（CLAUDE.md の「収集の見張り」）。そこで毎時、配信元ごとに
// 「新しい記録が入っているか」を確かめ、healthchecks.io（https://healthchecks.io）に合図を送る。
//
// - 新しい記録がある → 成功の合図。healthchecks は「元気」のまま
// - 記録が古い・無い → 失敗の合図（/fail）。healthchecks がすぐメールを送る
// - サイトに届かない・この Worker 自体が動かない → 合図が来ない。決めた時間（間隔＋猶予）を
//   過ぎると healthchecks がメールを送る。「来ないこと」で気づけるのが、自前でメールを送る方式との違い
//
// 止まっている間に毎時メールしない仕組みは healthchecks 側にあるので、ここでは状態を持たない。

/** 見張る配信元。サイトの lib/platforms.ts の PLATFORM_IDS と合わせる。
 *  サイトの返事から読まずにここに書くのは、サイト側で1つ抜けたときも「記録なし」として気づくため */
const WATCHED_PLATFORMS = ["twitch", "youtube", "twitcasting", "kick"];

/** これより古い記録しか無ければ「止まった」とみなす（分）。毎時の収集なので、
 *  1回だけの失敗（一時的な API の不調）では知らせず、2回続けて記録が無いと知らせる。
 *  ツイキャスは収集に2〜3分かかり記録の時刻が少し遅れる（2026-11-14 の実測で48分の回が50分台）ので、
 *  ちょうど60分の倍数にはしない。試すときは `wrangler dev --var STALE_MINUTES:0` で全部を「止まった」にできる */
const DEFAULT_STALE_MINUTES = 90;

type HealthResponse = {
  platforms: Record<
    string,
    { latest: string | null; minutes_ago: number | null } | undefined
  >;
  lookback_hours: number;
};

async function checkHealth(env: Env): Promise<string> {
  // 鍵が無いあいだは何もしない（GITHUB_TOKEN と同じ扱い）
  if (!env.HEALTHCHECKS_PING_KEY) return "見張り: 鍵が無いので省略";

  // サイトに届かないときは throw して、合図は送らない。一時的な不調で
  // 「止まった」メールが4通届くのを避けるため。続けば合図が途切れて healthchecks が知らせる
  const res = await fetch(`${env.SITE_URL}/api/cron/health`, {
    headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
    redirect: "manual",
  });
  if (!res.ok) {
    throw new Error(
      `見張り: /api/cron/health が失敗しました: ${res.status} ${(await res.text()).slice(0, 200)}`,
    );
  }
  const health = (await res.json()) as HealthResponse;

  // 数字にならない値が入っていたら既定に戻す（NaN だと全部「元気」扱いになり、見張りが効かなくなる）
  const parsed = Number(env.STALE_MINUTES);
  const staleMinutes =
    env.STALE_MINUTES !== undefined && Number.isFinite(parsed)
      ? parsed
      : DEFAULT_STALE_MINUTES;

  const results = await Promise.allSettled(
    WATCHED_PLATFORMS.map(async (p) => {
      const h = health.platforms[p];
      const fresh = h?.minutes_ago != null && h.minutes_ago <= staleMinutes;
      // healthchecks の記録とメールに残る文。何が起きているかをメールだけで分かるようにする
      const body =
        h?.latest != null
          ? `${p}: 最新の記録 ${h.latest}（${h.minutes_ago}分前。${staleMinutes}分より古いと止まったとみなす）`
          : `${p}: 直近${health.lookback_hours}時間の記録がありません`;

      // 名前（slug）で送る形の URL。鍵1つで全部の配信元に送れるので、Secret が1つで済む。
      // ?create=1 は、healthchecks にまだその名前の見張りが無ければ作る（最初の1回だけ効く）
      const slug = `stream-trends-${p}`;
      const url = `https://hc-ping.com/${env.HEALTHCHECKS_PING_KEY}/${slug}${fresh ? "" : "/fail"}?create=1`;
      const ping = await fetch(url, { method: "POST", body });
      if (!ping.ok) {
        throw new Error(`見張り: ${slug} への合図が失敗: ${ping.status}`);
      }
      return `見張り: ${fresh ? "OK" : "止まっている"} ${body}`;
    }),
  );

  const errors: string[] = [];
  const lines: string[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") lines.push(r.value);
    else errors.push(String(r.reason));
  }
  if (errors.length > 0) throw new Error(errors.join(" / "));
  return lines.join("\n");
}

async function run(job: Job, env: Env): Promise<string> {
  if ("healthCheck" in job) return checkHealth(env);
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
