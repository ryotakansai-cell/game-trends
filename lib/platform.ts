// プラットフォームをまたいで同じ形で扱うための「共通の型」だけを置く。
// 処理は書かない。型だけのファイル。
//
// ツイキャスなどを追加するときは、この形に変換する関数を1つ書けば
// ページ側のコードは一切変更しなくてよい。

/** creators に紐付いた1アカウント（accounts テーブルの1行ぶん） */
export type PlatformAccount = {
  id: number;
  platform: string; // "twitch" | "youtube" | 将来のもの
  platform_id: string; // そのプラットフォーム内でのID
  login: string | null; // Twitchのログイン名。YouTubeには無いのでnull
  display_name: string;
  relation: string; // self=本人 / clip=切り抜き / archive=アーカイブ
};

/** 一覧に並べる1件ぶん（クリップでも動画でも同じ形にする） */
export type ContentItem = {
  id: string;
  title: string;
  url: string;
  thumbnailUrl: string;
  meta: string; // 「12,345回再生 ・ 2026/09/20」など、整形済みの説明1行
};

/** 今配信中の情報 */
export type LiveInfo = {
  title: string;
  url: string;
  thumbnailUrl: string;
  meta: string;
};

/** 1アカウントぶんの中身。プラットフォームが違っても形は同じ */
export type PlatformContent = {
  accountId: number;
  platform: string;
  label: string; // 画面に出す名前（"Twitch" / "YouTube"）
  relation: string;
  displayName: string;
  iconUrl: string | null;
  profileUrl: string; // そのアカウントへの外部リンク
  live: LiveInfo | null; // 配信していなければ null
  clips: ContentItem[];
  videos: ContentItem[];
};

/** relation を画面用の日本語にする */
export function relationLabel(relation: string) {
  if (relation === "clip") return "切り抜き";
  if (relation === "archive") return "アーカイブ";
  return "本人";
}
