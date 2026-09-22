import { NextRequest, NextResponse } from "next/server";
import {
  searchLiveVideos,
  getViewerCounts,
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

    // ⑤ 視聴者数を取得
    const videoIds = [...found.keys()];
    const videos = await getViewerCounts(videoIds);

    const db = getDbClient();
    const capturedAt = new Date().toISOString();

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
      captured_at: capturedAt,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
