import { NextRequest, NextResponse } from "next/server";
import {
  searchLiveVideos,
  checkVideos,
  getRecentVideoIdsFromFeeds,
  JP_LIVE_KEYWORDS,
  GLOBAL_LIVE_KEYWORDS,
  pickKeyword,
} from "@/lib/youtube";
import { getDbClient, batchInChunks } from "@/lib/db";
import { jstDay } from "@/lib/snapshot-range";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 最後の配信からこの日数が過ぎたチャンネルは、監視リストから外す */
const WATCH_DAYS = 30;

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

    // ③ 3回検索して発見（並列実行）。新しい配信者を見つける入口はここ
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
    const searchedIds = new Set(found.keys());
    const jpSearchedIds = new Set([...jpA, ...jpB].map((v) => v.videoId));

    const db = getDbClient();
    const now = new Date();
    const capturedAt = now.toISOString();

    // ⑤ 監視リスト：検索に頼らず、毎時 RSS で直接確かめるチャンネル。
    //   - 日本向けの検索で2日以上見つかり、30日以内に配信していたチャンネル（新人も自動で入る）
    //   - 名寄せ済みの本人チャンネル（配信者ページの統計を欠けなく出すため）
    // 切り抜き・アーカイブは投稿が多いのに配信はほぼしないので含めない
    const watchSince = new Date(
      now.getTime() - WATCH_DAYS * 24 * 3600 * 1000,
    ).toISOString();
    const watch = await db.execute({
      sql: `
        SELECT a.platform_id
        FROM youtube_watch w JOIN accounts a ON a.id = w.account_id
        WHERE w.seen_days >= 2 AND w.last_live_at >= ?
        UNION
        SELECT platform_id FROM accounts
        WHERE platform = 'youtube' AND relation = 'self' AND creator_id IS NOT NULL
      `,
      args: [watchSince],
    });
    const feeds = await getRecentVideoIdsFromFeeds(
      watch.rows.map((r) => String(r.platform_id)),
    );

    // ⑥ RSS の動画のうち、前に確かめて「済み」だったもの（普通の動画・配信終了）は除く。
    // 配信のたびに新しい動画IDが振られるので、新しい配信は必ず「初めて見るID」として残る
    const feedIds = [...new Set(feeds.videoIds)].filter((id) => !found.has(id));
    const done = new Set<string>();
    for (let i = 0; i < feedIds.length; i += 500) {
      const chunk = feedIds.slice(i, i + 500);
      const r = await db.execute({
        sql: `SELECT video_id FROM youtube_video_checks
              WHERE status = 'done' AND video_id IN (${chunk.map(() => "?").join(",")})`,
        args: chunk,
      });
      r.rows.forEach((row) => done.add(String(row.video_id)));
    }
    const toCheck = feedIds.filter((id) => !done.has(id));
    // 監視リストは日本向けの検索から作っているので、日本向けで見つけた扱いにする
    toCheck.forEach((id) => found.set(id, { region: "jp" }));

    // ⑦ 配信中か・配信予定か・済みかを確かめる（50件で1ユニット）
    const videoIds = [...found.keys()];
    const { live: videos, pending } = await checkVideos(videoIds);
    const liveFromFeeds = videos.filter((v) => !searchedIds.has(v.videoId));

    const summary = {
      jp_keywords: [jpKeywordA, jpKeywordB],
      global_keyword: globalKeyword,
      searched: searchedIds.size,
      watch_channels: watch.rows.length,
      // feed_failed が増えたら RSS が弾かれている
      feed_failed: feeds.failed,
      feed_videos: feedIds.length,
      feed_skipped_done: done.size,
      videos_list_units: Math.ceil(videoIds.length / 50),
      live: videos.length,
      live_from_feeds: liveFromFeeds.length,
      captured_at: capturedAt,
    };

    // ?dryRun=1 のときは保存せずに結果だけ返す。
    // 手元から試すたびに本番のDBへ余分な記録が増えるのを防ぐ（DBは本番の1つだけなので）
    if (request.nextUrl.searchParams.get("dryRun") === "1") {
      return NextResponse.json({ dry_run: true, ...summary });
    }

    // ⑧ accounts を UPSERT（全プラットフォーム共通テーブル）。名前が同じなら書き込まない
    await batchInChunks(
      db,
      videos.map((v) => ({
        sql: `
          INSERT INTO accounts (platform, platform_id, login, display_name, updated_at)
          VALUES ('youtube', ?, NULL, ?, ?)
          ON CONFLICT(platform, platform_id) DO UPDATE SET
            display_name = excluded.display_name,
            updated_at = excluded.updated_at
          WHERE accounts.display_name IS NOT excluded.display_name
        `,
        // YouTubeにはlogin相当が無いのでNULL、languageも取得していない
        args: [v.channelId, v.channelTitle, capturedAt],
      })),
    );

    // ⑨ live_snapshots を INSERT
    await batchInChunks(
      db,
      videos.map((v) => ({
        sql: `
          INSERT INTO live_snapshots (account_id, viewers, title, content_id, region, captured_at)
          VALUES (
            (SELECT id FROM accounts WHERE platform = 'youtube' AND platform_id = ?),
            ?, ?, ?, ?, ?
          )
        `,
        // content_id にYouTubeのvideo_idが入る（Twitchでは使わない列）
        args: [
          v.channelId,
          v.viewers,
          v.title,
          v.videoId,
          found.get(v.videoId)!.region,
          capturedAt,
        ],
      })),
    );

    // ⑩ RSS から確かめた動画の結果を覚える。状態が前回と同じなら書き込まない
    // （配信予定のまま・配信中のままの動画を毎時上書きしないため）
    await batchInChunks(
      db,
      toCheck.map((id) => ({
        sql: `
          INSERT INTO youtube_video_checks (video_id, status, checked_at)
          VALUES (?, ?, ?)
          ON CONFLICT(video_id) DO UPDATE SET
            status = excluded.status,
            checked_at = excluded.checked_at
          WHERE youtube_video_checks.status IS NOT excluded.status
        `,
        args: [id, pending.has(id) ? "pending" : "done", capturedAt],
      })),
    );

    // ⑪ 監視リストを更新する
    const today = jstDay(now);
    await batchInChunks(db, [
      // 日本向けの検索で見つかった配信：見つかった日数を数える（同じ日なら増やさない）
      ...videos
        .filter((v) => jpSearchedIds.has(v.videoId))
        .map((v) => ({
          sql: `
            INSERT INTO youtube_watch (account_id, seen_days, last_seen_day, last_live_at)
            VALUES ((SELECT id FROM accounts WHERE platform = 'youtube' AND platform_id = ?), 1, ?, ?)
            ON CONFLICT(account_id) DO UPDATE SET
              -- SQLite では比較の結果が 1 / 0 になるので、日が変わったときだけ +1 される
              seen_days = youtube_watch.seen_days + (youtube_watch.last_seen_day <> excluded.last_seen_day),
              last_seen_day = excluded.last_seen_day,
              last_live_at = excluded.last_live_at
          `,
          args: [v.channelId, today, capturedAt],
        })),
      // RSS で配信中だと分かったチャンネル：最後に配信していた時刻だけ更新する（監視を続けるため）
      ...liveFromFeeds.map((v) => ({
        sql: `
          UPDATE youtube_watch SET last_live_at = ?
          WHERE account_id = (SELECT id FROM accounts WHERE platform = 'youtube' AND platform_id = ?)
        `,
        args: [capturedAt, v.channelId],
      })),
    ]);

    return NextResponse.json(summary);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
