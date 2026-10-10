import Image from "next/image";
import Link from "next/link";
import {
  getRisingStreamers,
  getUsersByLogin,
  twitchThumbnailFromLogin,
  formatViewers,
} from "@/lib/twitch";
import {
  getRisingYouTubeLive,
  getChannelIcons,
  youtubeThumbnail,
} from "@/lib/youtube";
import { getCreatorIdMap } from "@/lib/creators";
import { SegmentedTabs } from "@/components/SegmentedTabs";
import { PageHeader } from "@/components/PageHeader";
import { FilterPills } from "@/components/FilterPills";
import { TwitchIcon, YouTubeIcon } from "@/components/PlatformIcons";
import { RelativeTime } from "@/components/RelativeTime";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "急上昇の配信者",
  description:
    "24時間前と比べて視聴者数が伸びている配信者のランキング。Twitch・YouTubeを横断して表示します。",
  alternates: { canonical: "/trending" },
};

// 5分間キャッシュする。cronが数時間おきなので、これ以上短くしても意味がない
export const revalidate = 300;

// URLの ?lang=all を受け取る（トップページと同じ規則）
type Props = {
  searchParams: Promise<{ lang?: string; platform?: string }>;
};

type Platform = "all" | "twitch" | "youtube";

/** 選んだタブを維持したまま、リンク先のURLを組み立てる（トップページと同じ規則） */
function buildHref(platform: Platform, isJapanese: boolean) {
  const params = new URLSearchParams();
  if (platform !== "all") params.set("platform", platform);
  if (!isJapanese) params.set("lang", "all");
  const qs = params.toString();
  return qs ? `/trending?${qs}` : "/trending";
}

// トップページの UnifiedEntry と同じ考え方。
// TwitchとYouTubeの形が違うので、表示用の共通の形に揃える
type RisingEntry = {
  key: string;
  platform: "twitch" | "youtube";
  title: string; // 配信タイトル
  channelName: string; // 配信者名
  channelIconUrl?: string; // 取得できないこともあるので ? 付き
  thumbnailUrl: string;
  watchHref: string; // 配信を見に行くリンク（外部）
  currentViewers: number;
  pastViewers: number;
  growthRate: number; // 0.35 なら 35%増
  creatorHref?: string; // 名寄せ済みなら統合ページへのリンク
};

export default async function TrendingPage({ searchParams }: Props) {
  const { lang, platform } = await searchParams;
  const isJapanese = lang !== "all"; // デフォルトは日本
  const selectedPlatform: Platform =
    platform === "twitch" || platform === "youtube" ? platform : "all";
  const showTwitch = selectedPlatform !== "youtube";
  const showYouTube = selectedPlatform !== "twitch";

  // 2つのDB問い合わせを同時に走らせる（順番に待つより速い）
  // 日本タブなら言語で絞り、Globalタブなら絞らない（＝全部）
  const [twitchRising, youtubeRising] = await Promise.all([
    // 絞り込みで選ばれていない方は問い合わせ自体をしない（DBの読み取りを減らす）
    showTwitch
      ? getRisingStreamers(200, 20, isJapanese ? "ja" : undefined)
      : Promise.resolve([]),
    showYouTube
      ? getRisingYouTubeLive(50, 20, isJapanese ? "jp" : undefined)
      : Promise.resolve([]),
  ]);

  // アイコンは表示時にその場で取得する（DBには保存しない方針）
  const [twitchIcons, youtubeIcons, creatorIds] = await Promise.all([
    getUsersByLogin(twitchRising.map((s) => s.login)),
    getChannelIcons(youtubeRising.map((v) => v.channel_id)),
    // 名寄せ済みの配信者は、アイコンから統合ページへ飛ばす
    getCreatorIdMap([
      ...twitchRising.map((s) => ({
        platform: "twitch",
        platformId: s.streamer_id,
      })),
      ...youtubeRising.map((v) => ({
        platform: "youtube",
        platformId: v.channel_id,
      })),
    ]),
  ]);

  // creator_id が見つかったときだけリンク先を作る小さな関数
  const creatorHref = (platform: string, platformId: string) => {
    const id = creatorIds.get(`${platform}:${platformId}`);
    return id ? `/creators/${id}` : undefined;
  };

  // Twitchの結果を共通の形に変換
  const twitchEntries: RisingEntry[] = twitchRising.map((s) => ({
    key: `twitch-${s.streamer_id}`,
    platform: "twitch",
    // ?? は「左がnullなら右を使う」（C#と同じ）。
    // title列を追加する前の古い行はnullなので、その場合は配信者名を出す
    title: s.title ?? s.display_name,
    channelName: s.display_name,
    channelIconUrl: twitchIcons.get(s.login)?.profile_image_url,
    thumbnailUrl: twitchThumbnailFromLogin(s.login),
    watchHref: `https://twitch.tv/${s.login}`,
    currentViewers: s.current_viewers,
    pastViewers: s.past_viewers,
    growthRate: s.growth_rate,
    creatorHref: creatorHref("twitch", s.streamer_id),
  }));

  // YouTubeの結果も同じ形に変換
  const youtubeEntries: RisingEntry[] = youtubeRising.map((v) => ({
    key: `youtube-${v.channel_id}`,
    platform: "youtube",
    title: v.video_title,
    channelName: v.channel_title,
    channelIconUrl: youtubeIcons.get(v.channel_id),
    thumbnailUrl: youtubeThumbnail(v.video_id),
    watchHref: `https://www.youtube.com/watch?v=${v.video_id}`,
    currentViewers: v.current_viewers,
    pastViewers: v.past_viewers,
    growthRate: v.growth_rate,
    creatorHref: creatorHref("youtube", v.channel_id),
  }));

  // 2つを混ぜて、増加率が高い順に並べ直す
  const entries = [...twitchEntries, ...youtubeEntries]
    .sort((a, b) => b.growthRate - a.growthRate)
    .slice(0, 30);

  // 最終集計の時刻（どちらも毎時の収集結果なので、新しい方を出す）
  const latestAt = [
    ...twitchRising.map((s) => s.current_at),
    ...youtubeRising.map((v) => v.current_at),
  ].sort()
    .at(-1);

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-6 sm:py-12">
      <PageHeader
        eyebrow="TRENDING"
        title="急上昇"
        summary={
          <>
            24時間前と比べて伸びている配信 ・ {entries.length}件
            <span className="mt-0.5 block text-gray-500">
              更新：毎時
              {latestAt && (
                <>
                  （<RelativeTime iso={latestAt} />）
                </>
              )}
            </span>
          </>
        }
        region={
          <SegmentedTabs
            options={[
              {
                label: "日本",
                href: buildHref(selectedPlatform, true),
                active: isJapanese,
              },
              {
                label: "Global",
                href: buildHref(selectedPlatform, false),
                active: !isJapanese,
              },
            ]}
          />
        }
        filters={
          <FilterPills
            options={[
              {
                label: "すべて",
                href: buildHref("all", isJapanese),
                active: selectedPlatform === "all",
              },
              {
                label: "Twitch",
                icon: <TwitchIcon />,
                href: buildHref("twitch", isJapanese),
                active: selectedPlatform === "twitch",
              },
              {
                label: "YouTube",
                icon: <YouTubeIcon />,
                href: buildHref("youtube", isJapanese),
                active: selectedPlatform === "youtube",
              },
            ]}
          />
        }
      />

      <ul className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map((entry, index) => (
          <li key={entry.key} className="group">
            <a href={entry.watchHref} target="_blank" rel="noopener noreferrer">
              {/* aspect-video で縦横比を固定。TwitchとYouTubeでサムネの
                  元サイズが違っても、カードの高さが揃う */}
              <div className="relative aspect-video overflow-hidden rounded-lg border border-white/10 bg-white/5">
                <Image
                  src={entry.thumbnailUrl}
                  alt={entry.title}
                  fill
                  className="object-cover transition duration-300 group-hover:scale-105"
                  unoptimized
                />
                <span className="absolute left-2 top-2 rounded bg-black/70 px-2 py-0.5 text-xs font-bold text-white">
                  {index + 1}
                </span>
                {/* 急上昇ページの主役なので、増加率を目立つ緑バッジで表示 */}
                <span className="absolute right-2 top-2 rounded bg-green-600/90 px-2 py-0.5 text-xs font-bold text-white">
                  +{Math.round(entry.growthRate * 100)}%
                </span>
                <span className="absolute bottom-2 right-2 rounded bg-black/70 px-2 py-0.5 text-xs text-gray-200">
                  {entry.platform === "twitch" ? "Twitch" : "YouTube"}
                </span>
              </div>
            </a>

            <p
              className="mt-3 truncate font-bold text-gray-100"
              title={entry.title}
            >
              {entry.title}
            </p>

            <div className="mt-2 flex items-center gap-2 text-sm text-gray-400">
              {/* 名寄せ済みなら統合ページへのリンクにする。
                  上のサムネの <a> は既に閉じているので入れ子にはならない */}
              {entry.creatorHref ? (
                <Link
                  href={entry.creatorHref}
                  className="flex min-w-0 items-center gap-2 transition hover:text-purple-300"
                >
                  {entry.channelIconUrl && (
                    <Image
                      src={entry.channelIconUrl}
                      alt={entry.channelName}
                      width={24}
                      height={24}
                      className="shrink-0 rounded-full ring-1 ring-purple-400/70"
                    />
                  )}
                  <span className="truncate">{entry.channelName}</span>
                </Link>
              ) : (
                <>
                  {entry.channelIconUrl && (
                    <Image
                      src={entry.channelIconUrl}
                      alt={entry.channelName}
                      width={24}
                      height={24}
                      className="shrink-0 rounded-full ring-1 ring-white/10"
                    />
                  )}
                  <span className="truncate">{entry.channelName}</span>
                </>
              )}
            </div>

            {/* 「1068人 → 3091人」という変化そのものを見せる */}
            <div className="mt-1 text-xs text-gray-500">
              {formatViewers(entry.pastViewers)}人 →{" "}
              <span className="font-bold text-purple-300">
                {formatViewers(entry.currentViewers)}人
              </span>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
