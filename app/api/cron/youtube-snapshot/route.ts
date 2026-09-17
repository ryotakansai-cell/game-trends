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

    // ⑥ youtube_streamers を UPSERT
    const streamerRows = videos.map((v) => ({
      channel_id: v.channelId,
      title: v.channelTitle,
      thumbnail_url: v.thumbnailUrl,
      updated_at: capturedAt,
    }));

    await db.batch(
      streamerRows.map((s) => ({
        sql: `
          INSERT INTO youtube_streamers (channel_id, title, thumbnail_url, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(channel_id) DO UPDATE SET
            title = excluded.title,
            thumbnail_url = excluded.thumbnail_url,
            updated_at = excluded.updated_at
        `,
        args: [s.channel_id, s.title, s.thumbnail_url, s.updated_at],
      })),
      "write",
    );

    // ⑦ youtube_live_snapshots を INSERT
    const snapshotRows = videos.map((v) => ({
      channel_id: v.channelId,
      video_id: v.videoId,
      title: v.title,
      region: found.get(v.videoId)!.region,
      viewers: v.viewers,
      captured_at: capturedAt,
    }));

    await db.batch(
      snapshotRows.map((s) => ({
        sql: `
          INSERT INTO youtube_live_snapshots (channel_id, video_id, title, region, viewers, captured_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
        args: [
          s.channel_id,
          s.video_id,
          s.title,
          s.region,
          s.viewers,
          s.captured_at,
        ],
      })),
      "write",
    );

    return NextResponse.json({
      jp_keywords: [jpKeywordA, jpKeywordB],
      global_keyword: globalKeyword,
      found: videos.length,
      streamers: streamerRows.length,
      captured_at: capturedAt,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
