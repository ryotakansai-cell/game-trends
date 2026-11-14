import { NextRequest, NextResponse } from "next/server";
import { getDbClient } from "@/lib/db";
import { PLATFORM_IDS } from "@/lib/platforms";

export const dynamic = "force-dynamic";

// 収集の見張り用。配信元ごとに「いちばん新しい毎時の記録の時刻」を返す（cron-worker が毎時呼ぶ）。
//
// 2026-10-28 からツイキャスの収集が2週間以上止まっていたのに、失敗が cron-worker のログに
// 出るだけで誰も気づかなかった。そこで「失敗したか」ではなく「新しい記録が入っているか」を見る。
// こうすると、API の失敗・成功したのに0件・cron-worker が動いていない、のどれでも気づける。
//
// ここは時刻を返すだけで、「止まっている」かの判定と知らせ（healthchecks.io）は cron-worker 側でやる。
// サイトが落ちているときも、cron-worker が「サイトに届かない」と分かるようにするため。
// 何分空いたら止まったとみなすかを、サイトではなく cron-worker 側に置くのも同じ理由
// （判定を変えるたびにサイトをデプロイし直さなくてよい）。

// 何時間前までさかのぼって探すか。これより古ければ「記録なし（null）」として返す。
// 範囲を決めないと、記録が無い配信元を探して live_snapshots を全部読んでしまう（CLAUDE.md の予定 9）
const LOOKBACK_HOURS = 6;

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "権限がありません" }, { status: 401 });
  }

  try {
    const db = getDbClient();
    const now = Date.now();
    // captured_at は toISOString() の形で保存しているので、同じ形の文字列で比べる（lib/snapshot-range.ts）
    const since = new Date(now - LOOKBACK_HOURS * 3600 * 1000).toISOString();

    // 配信元ごとに、captured_at の索引を新しい方から読み、その配信元の行が見つかった所で止める（LIMIT 1）。
    // 1回の SQL で GROUP BY すると直近1時間だけでも約5.7万行を読むが、こうすると
    // 4つ合わせて約5,000行で済む（2026-11-14 の実測。CLAUDE.md の「収集の見張り」）。
    // 記録が無い配信元は LOOKBACK_HOURS の範囲を読み切るので多くなるが、それは止まっているときだけ
    const results = await db.batch(
      PLATFORM_IDS.map((p) => ({
        sql: `SELECT s.captured_at AS at
              FROM live_snapshots s INDEXED BY idx_live_snapshots_time
              CROSS JOIN accounts a ON a.id = s.account_id
              WHERE s.captured_at >= ? AND a.platform = ?
              ORDER BY s.captured_at DESC
              LIMIT 1`,
        args: [since, p],
      })),
      "read",
    );

    const platforms = Object.fromEntries(
      PLATFORM_IDS.map((p, i) => {
        const at = results[i].rows[0]?.at;
        const latest = at ? String(at) : null;
        return [
          p,
          {
            latest,
            // 何分前か。cron-worker の判定と、知らせのメールに書く文に使う
            minutes_ago:
              latest === null
                ? null
                : Math.round((now - Date.parse(latest)) / 60000),
          },
        ];
      }),
    );

    return NextResponse.json({
      checked_at: new Date(now).toISOString(),
      lookback_hours: LOOKBACK_HOURS,
      platforms,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
