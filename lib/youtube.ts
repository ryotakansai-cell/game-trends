import { getDbClient } from "@/lib/db";

const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";

function getApiKey() {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    throw new Error("YOUTUBE_API_KEY が未設定です");
  }
  return apiKey;
}

export type YouTubeSearchResult = {
  videoId: string;
  channelId: string;
  channelTitle: string;
  title: string;
  thumbnailUrl: string;
};

export type YouTubeLiveVideo = YouTubeSearchResult & {
  viewers: number;
};

/** 今ライブ中の動画を検索する（キーワード必須。地域は任意） */
export async function searchLiveVideos(
  query: string,
  regionCode?: string,
): Promise<YouTubeSearchResult[]> {
  const apiKey = getApiKey();

  const params = new URLSearchParams({
    part: "snippet",
    type: "video",
    eventType: "live",
    order: "viewCount",
    maxResults: "25",
    q: query,
    key: apiKey,
  });
  if (regionCode) params.set("regionCode", regionCode);

  const res = await fetch(`${YOUTUBE_API}/search?${params}`);
  const json = await res.json();

  if (json.error) {
    throw new Error(`YouTube search.list エラー: ${json.error.message}`);
  }

  return (json.items ?? [])
    .filter((item: { id?: { videoId?: string } }) => item.id?.videoId)
    .map((item: any) => ({
      videoId: item.id.videoId as string,
      channelId: item.snippet.channelId as string,
      channelTitle: item.snippet.channelTitle as string,
      title: item.snippet.title as string,
      thumbnailUrl:
        item.snippet.thumbnails?.high?.url ??
        item.snippet.thumbnails?.default?.url ??
        "",
    }));
}

async function fetchViewerCounts(
  videoIds: string[],
): Promise<YouTubeLiveVideo[]> {
  const apiKey = getApiKey();

  const params = new URLSearchParams({
    part: "snippet,liveStreamingDetails",
    id: videoIds.join(","),
    key: apiKey,
  });

  const res = await fetch(`${YOUTUBE_API}/videos?${params}`);
  const json = await res.json();

  if (json.error) {
    throw new Error(`YouTube videos.list エラー: ${json.error.message}`);
  }

  return (json.items ?? [])
    .filter((item: any) => item.liveStreamingDetails?.concurrentViewers)
    .map((item: any) => ({
      videoId: item.id as string,
      channelId: item.snippet.channelId as string,
      channelTitle: item.snippet.channelTitle as string,
      title: item.snippet.title as string,
      thumbnailUrl:
        item.snippet.thumbnails?.high?.url ??
        item.snippet.thumbnails?.default?.url ??
        "",
      // concurrentViewers は文字列で返ってくるので数値に変換する
      viewers: Number(item.liveStreamingDetails.concurrentViewers),
    }));
}

/** 動画IDから今の同時接続数を取得する（配信が終わっていたら除外される） */
export async function getViewerCounts(
  videoIds: string[],
): Promise<YouTubeLiveVideo[]> {
  if (videoIds.length === 0) return [];

  // videos.list は一度に指定できるIDが50件までなので分割する
  const chunks: string[][] = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    chunks.push(videoIds.slice(i, i + 50));
  }

  const results = await Promise.all(chunks.map(fetchViewerCounts));
  return results.flat();
}

/** 日本向け検索で使うキーワードのローテーション候補 */
export const JP_LIVE_KEYWORDS = ["配信", "ゲーム実況", "vtuber", "雑談"];

/** 全世界向け検索で使うキーワードのローテーション候補 */
export const GLOBAL_LIVE_KEYWORDS = [
  "esports",
  "gameplay",
  "playthrough",
  "vtuber",
];

/** 時刻（0-23）に応じてキーワードを1つ選ぶ（順番に一周する） */
export function pickKeyword(keywords: string[], hour: number) {
  return keywords[hour % keywords.length];
}

/** 動画IDからサムネイル画像のURLを組み立てる（保存不要、その場で作れる） */
export function youtubeThumbnail(videoId: string) {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

export type YouTubeLiveRankingRow = {
  video_id: string;
  title: string;
  viewers: number;
  region: "jp" | "global";
  channel_id: string;
  channel_title: string;
};

/** チャンネルIDから、アイコン画像のURLをまとめて取得する（表示時にその場で取得。TwitchのgetUsersByLoginと同じ考え方） */
export async function getChannelIcons(
  channelIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const uniqueIds = [...new Set(channelIds)];
  if (uniqueIds.length === 0) return map;

  const apiKey = getApiKey();

  // channels.listも一度に指定できるIDが50件までなので分割する
  const chunks: string[][] = [];
  for (let i = 0; i < uniqueIds.length; i += 50) {
    chunks.push(uniqueIds.slice(i, i + 50));
  }

  await Promise.all(
    chunks.map(async (chunk) => {
      const params = new URLSearchParams({
        part: "snippet",
        id: chunk.join(","),
        key: apiKey,
      });
      const res = await fetch(`${YOUTUBE_API}/channels?${params}`);
      const json = await res.json();
      if (json.error) return;

      for (const item of json.items ?? []) {
        const url =
          item.snippet?.thumbnails?.default?.url ??
          item.snippet?.thumbnails?.medium?.url;
        if (url) map.set(item.id, url);
      }
    }),
  );

  return map;
}

/** DBに貯めた直近の収集結果から、ランキングを読み出す */
export async function getTopYouTubeLive(
  region?: "jp" | "global",
  limit = 40,
): Promise<YouTubeLiveRankingRow[]> {
  const db = getDbClient();

  const sql = `
    -- live_snapshots は全プラットフォーム混在なので、YouTube分だけに絞る
    WITH yt AS (
      SELECT l.*
      FROM live_snapshots l
      JOIN accounts a ON a.id = l.account_id
      WHERE a.platform = 'youtube'
    )
    -- 列名は移行前と同じにする（呼び出し側は変更不要）
    SELECT
      s.content_id AS video_id,
      s.title,
      s.viewers,
      s.region,
      a.platform_id AS channel_id,
      a.display_name AS channel_title
    FROM yt s
    JOIN accounts a ON a.id = s.account_id
    -- 「最新バッチ」の判定もYouTube分だけで行う
    WHERE s.captured_at = (SELECT MAX(captured_at) FROM yt)
      ${region ? "AND s.region = ?" : ""}
    ORDER BY s.viewers DESC
    LIMIT ?
  `;
  const args = region ? [region, limit] : [limit];

  const result = await db.execute({ sql, args });
  return result.rows as unknown as YouTubeLiveRankingRow[];
}

// ============================================
// 急上昇ランキング用（DBに貯めた履歴を読む）
// ============================================

export type RisingYouTubeChannel = {
  channel_id: string;
  channel_title: string; // チャンネル名（youtube_streamersから取得）
  video_id: string; // 今ライブ中の動画ID（サムネとリンクに使う）
  video_title: string; // 今の配信タイトル
  region: "jp" | "global"; // どちらの検索で見つかったか
  current_viewers: number;
  past_viewers: number;
  current_at: string;
  past_at: string;
  growth_rate: number; // 0.35 なら 35%増
};

/** 24時間前と比べて視聴者数が伸びているYouTubeチャンネルを取得する */
export async function getRisingYouTubeLive(
  minViewers = 50, // YouTubeは11人規模から収集できているので広めに拾う
  limit = 20,
  region?: "jp" | "global", // "jp"を渡すと日本向け検索で見つけた配信だけ
): Promise<RisingYouTubeChannel[]> {
  const db = getDbClient();

  const sql = `
    -- ⓪ live_snapshots は全プラットフォーム混在なので、YouTube分だけに絞る
    WITH yt AS (
      SELECT l.*
      FROM live_snapshots l
      JOIN accounts a ON a.id = l.account_id
      WHERE a.platform = 'youtube'
    ),

    -- ① チャンネルごとに「一番新しい記録」を特定する
    latest AS (
      SELECT
        account_id,
        content_id,
        title AS video_title,
        region,
        viewers AS current_viewers,
        captured_at AS current_at,
        -- 同じ時刻に複数の動画を配信している場合は、視聴者が多い方を採用
        ROW_NUMBER() OVER (
          PARTITION BY account_id
          ORDER BY captured_at DESC, viewers DESC
        ) AS rn
      FROM yt
    ),

    -- ② チャンネルごとに「24時間前に一番近い記録」を特定する
    past AS (
      SELECT
        account_id,
        viewers AS past_viewers,
        captured_at AS past_at,
        ROW_NUMBER() OVER (
          PARTITION BY account_id
          ORDER BY ABS(strftime('%s', captured_at) - strftime('%s', 'now', '-24 hours')), viewers DESC
        ) AS rn
      FROM yt
    )

    -- ③ ①と②を突き合わせて増加率を計算する
    SELECT
      -- 列名は移行前と同じにする（呼び出し側は変更不要）
      a.platform_id AS channel_id,
      a.display_name AS channel_title,
      l.content_id AS video_id,
      l.video_title,
      l.region,
      l.current_viewers,
      p.past_viewers,
      l.current_at,
      p.past_at,
      (CAST(l.current_viewers AS REAL) - p.past_viewers) / p.past_viewers AS growth_rate
    FROM latest l
    JOIN past p ON p.account_id = l.account_id AND p.rn = 1
    JOIN accounts a ON a.id = l.account_id
    WHERE l.rn = 1
      AND l.current_viewers >= ?
      AND p.past_viewers > 0
      -- 増えている人だけ（急上昇ページなので、減っている人は載せない）
      AND l.current_viewers > p.past_viewers
      -- 21600秒 = 6時間。YouTubeはキーワードローテーションのため記録が
      -- 飛び飛びになるので、Twitch(3時間)より広く取る
      AND ABS(strftime('%s', p.past_at) - strftime('%s', 'now', '-24 hours')) < 21600
      -- 最新の収集バッチに含まれている人だけ（＝最後の観測時点で配信中）。
      -- ★MAXもYouTube分だけで取る（全体のMAXだとTwitchのcron後に0件になる）
      AND l.current_at = (SELECT MAX(captured_at) FROM yt)
      ${region ? "AND l.region = ?" : ""}
    ORDER BY growth_rate DESC
    LIMIT ?
  `;

  // ?の数に合わせて渡す値を変える。順番はSQL内の ? の出現順と一致させる
  const args = region ? [minViewers, region, limit] : [minViewers, limit];

  const result = await db.execute({ sql, args });
  return result.rows as unknown as RisingYouTubeChannel[];
}
