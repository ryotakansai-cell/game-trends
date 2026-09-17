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
