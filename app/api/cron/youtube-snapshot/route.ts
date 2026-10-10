import { NextRequest, NextResponse } from "next/server";
import {
  searchLiveVideos,
  getViewerCounts,
  getRecentVideoIdsFromFeeds,
  JP_LIVE_KEYWORDS,
  GLOBAL_LIVE_KEYWORDS,
  pickKeyword,
} from "@/lib/youtube";
import { getDbClient } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  // ① 合言葉チェック
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "権限がありません" }, { status: 401 });
  }

  try {
    // ② 今の時刻に応じてキーワードを選ぶ（日本2回・全世界1回の配分）
    const hour = new Date().getHours();
    const jpKeywordA = pickKeyword(JP_LIVE_KEYWORDS, hour);
    const jpKeywordB = pickKeyword(JP_LIVE_KEYWORDS, hour + 1);
    const globalKeyword = pickKeyword(GLOBAL_LIVE_KEYWORDS, hour);

    // ③ 3回検索して発見（並列実行）
    const [jpA, jpB, global] = await Promise.all([
      searchLiveVideos(jpKeywordA, "JP"),
      searchLiveVideos(jpKeywordB, "JP"),
      searchLiveVideos(globalKeyword),
    ]);

    // ④ 重複した動画IDを除きつつ、どちらの検索で見つかったか(region)を記録
    const found = new Map<string, { region: "jp" | "global" }>();
    [...jpA, ...jpB].forEach((v) => found.set(v.videoId, { region: "jp" }));
    global.forEach((v) => {
      if (!found.has(v.videoId)) found.set(v.videoId, { region: "global" });
    });

    // RSS で足した分と区別して、結果の件数を出すために取っておく
    const searchedIds = new Set(found.keys());

    const db = getDbClient();

    // ④' 名寄せ済みの本人チャンネルは、検索に引っかからなくても直接確かめる。
    // 配信者ページの統計（同接・配信時間）を欠けなく出すため。
    // 切り抜き・アーカイブのチャンネルは投稿が多いのに配信はほぼしないので含めない
    // （含めると確認する動画が倍以上に増え、枠を無駄に使う）
    const linked = await db.execute(`
      SELECT platform_id FROM accounts
      WHERE platform = 'youtube' AND relation = 'self' AND creator_id IS NOT NULL
    `);
    const feeds = await getRecentVideoIdsFromFeeds(
      linked.rows.map((r) => String(r.platform_id)),
    );
    let feedCandidates = 0;
    for (const id of feeds.videoIds) {
      if (found.has(id)) continue;
      // 名寄せの対象は日本の配信者なので、日本向けの検索で見つけた扱いにする
      found.set(id, { region: "jp" });
      feedCandidates++;
    }

    // ⑤ 視聴者数を取得（配信中でない動画はここで落ちる）
    const videoIds = [...found.keys()];
    const videos = await getViewerCounts(videoIds);

    const capturedAt = new Date().toISOString();

    // ?dryRun=1 のときは保存せずに結果だけ返す。
    // 手元から試すたびに本番のDBへ余分な記録が増えるのを防ぐ（DBは本番の1つだけなので）
    if (request.nextUrl.searchParams.get("dryRun") === "1") {
      return NextResponse.json({
        dry_run: true,
        searched: jpA.length + jpB.length + global.length,
        linked_channels: linked.rows.length,
        feed_candidates: feedCandidates,
        feed_failed: feeds.failed,
        // videos.list は50件で1ユニット
        videos_list_units: Math.ceil(videoIds.length / 50),
        live: videos.length,
        live_from_feeds: videos.filter((v) => !searchedIds.has(v.videoId))
          .length,
      });
    }

    // ⑥ 配信ごとの記録を組み立てる
    const snapshotRows = videos.map((v) => ({
      channel_id: v.channelId,
      video_id: v.videoId,
      title: v.title,
      region: found.get(v.videoId)!.region,
      viewers: v.viewers,
      captured_at: capturedAt,
    }));

    // ⑦ accounts を UPSERT（全プラットフォーム共通テーブル）
    await db.batch(
      videos.map((v) => ({
        sql: `
          INSERT INTO accounts (platform, platform_id, login, display_name, updated_at)
          VALUES ('youtube', ?, NULL, ?, ?)
          ON CONFLICT(platform, platform_id) DO UPDATE SET
            display_name = excluded.display_name,
            updated_at = excluded.updated_at
        `,
        // YouTubeにはlogin相当が無いのでNULL、languageも取得していない
        args: [v.channelId, v.channelTitle, capturedAt],
      })),
      "write",
    );

    // ⑧ live_snapshots を INSERT
    await db.batch(
      snapshotRows.map((s) => ({
        sql: `
          INSERT INTO live_snapshots (account_id, viewers, title, content_id, region, captured_at)
          VALUES (
            (SELECT id FROM accounts WHERE platform = 'youtube' AND platform_id = ?),
            ?, ?, ?, ?, ?
          )
        `,
        // content_id にYouTubeのvideo_idが入る（Twitchでは使わない列）
        args: [
          s.channel_id,
          s.viewers,
          s.title,
          s.video_id,
          s.region,
          s.captured_at,
        ],
      })),
      "write",
    );

    return NextResponse.json({
      jp_keywords: [jpKeywordA, jpKeywordB],
      global_keyword: globalKeyword,
      found: videos.length,
      streamers: videos.length,
      // 名寄せ済みチャンネルの直接確認の結果。feed_failed が増えたら RSS が弾かれている
      feed_candidates: feedCandidates,
      feed_failed: feeds.failed,
      live_from_feeds: videos.filter((v) => !searchedIds.has(v.videoId)).length,
      captured_at: capturedAt,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
