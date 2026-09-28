import { cache } from "react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getGameById,
  getTopStreams,
  getUsersByLogin,
  boxArt,
  streamThumb,
  elapsedSince,
  formatViewers,
} from "@/lib/twitch";
import { getGameDetails } from "@/lib/igdb";
import { SegmentedTabs } from "@/components/SegmentedTabs";

export const revalidate = 180;

type Props = {
  params: Promise<{ id: string }>;
  // ?lang=all のときだけ全世界。指定なしは日本（トップページと同じ規則）
  searchParams: Promise<{ lang?: string }>;
};

// generateMetadata と本体で同じゲーム情報が必要なので、
// cache() で1リクエスト内の呼び出しを1回にまとめる
const loadGame = cache((id: string) => getGameById(id));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const game = await loadGame(id);
  if (!game) return { title: "見つかりません" };

  const title = `${game.name}の配信者ランキング`;
  const description = `${game.name}をいま配信している配信者を視聴者数順に表示。公式サイトや関連情報へのリンクもまとめています。`;

  return {
    title,
    description,
    alternates: { canonical: `/games/${id}` },
    openGraph: { title, description, url: `/games/${id}` },
  };
}

export default async function GameDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { lang } = await searchParams;
  const isJapanese = lang !== "all"; // デフォルトは日本

  // 言語で絞るかどうかだけが JP / Global の違い。
  // Twitchの /streams は game_id と language を同時に指定できるので、
  // 取得の段階で絞り込める（取ってから捨てるより無駄がない）
  const [game, streams] = await Promise.all([
    loadGame(id),
    getTopStreams({
      gameId: id,
      language: isJapanese ? "ja" : undefined,
      limit: 30,
    }),
  ]);

  if (!game) notFound();

  // IGDBの詳細。Twitchのレスポンスに入っている igdb_id を手がかりに引く。
  // 「Just Chatting」のような非ゲームカテゴリは igdb_id が空なので null が返る。
  // 取れなくてもページは従来どおり表示する（配信者一覧が主役なので）
  const details = await getGameDetails(game.igdb_id).catch(() => null);

  // 配信者アイコンは表示時にその場で取得する（DBには保存しない方針）。
  // getUsersByLogin は100件までまとめて1回で引ける
  const users = await getUsersByLogin(streams.map((s) => s.user_login)).catch(
    () => new Map(),
  );

  const totalViewers = streams.reduce((sum, s) => sum + s.viewer_count, 0);
  const query = encodeURIComponent(game.name);

  // IGDBから取れた「本物のリンク」。公式サイトやSteamのページそのもの
  const officialLinks = details?.links ?? [];

  // IGDBがSteamのページを持っていないときだけ、Steamの検索を足す
  const hasSteam = officialLinks.some((l) => l.label === "Steam");

  // 検索に飛ばすリンク。日本語の攻略サイトはゲーム別のURLがAPIで取れないので、
  // 各サイトの検索ページに渡す。URLは実際に叩いて200が返ることを確認したものだけ
  // （Game8と4Gamerは確認できなかったため入れていない）
  const searchLinks = [
    { label: "GameWith", url: `https://gamewith.jp/search?keyword=${query}` },
    { label: "ファミ通", url: `https://www.famitsu.com/search/?q=${query}` },
    ...(hasSteam
      ? []
      : [
          {
            label: "Steamで検索",
            url: `https://store.steampowered.com/search/?term=${query}`,
          },
        ]),
    {
      label: "YouTubeで検索",
      url: `https://www.youtube.com/results?search_query=${query}+実況`,
    },
    {
      label: "Twitchで開く",
      url: `https://www.twitch.tv/directory/game/${query}`,
    },
    {
      label: "Google検索",
      url: `https://www.google.com/search?q=${query}+攻略`,
    },
  ];

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-12">
      {/* ゲーム情報の帯 */}
      <div className="flex flex-wrap items-start gap-5 rounded-xl border border-white/10 bg-white/5 p-5">
        <Image
          src={boxArt(game.box_art_url, 144, 192)}
          alt={game.name}
          width={96}
          height={128}
          className="rounded-lg"
        />

        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-100">{game.name}</h1>
          <p className="mt-1 text-sm text-gray-400">
            {streams.length}配信 ・
            <span className="font-bold text-purple-300">
              {formatViewers(totalViewers)}人
            </span>
            が視聴中
          </p>

          {/* IGDBから取れたゲームそのものの情報。取れないときは丸ごと出さない */}
          {details &&
            (details.genres.length > 0 ||
              details.releaseDate ||
              details.rating !== null) && (
              <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                {details.genres.length > 0 && (
                  <span>{details.genres.join(" / ")}</span>
                )}
                {details.releaseDate && <span>{details.releaseDate} 発売</span>}
                {details.rating !== null && (
                  <span className="rounded bg-white/10 px-2 py-0.5 text-gray-300">
                    評価 {details.rating}
                  </span>
                )}
              </p>
            )}

          {/* 公式サイトなど、IGDBが持っている実際のページへのリンク。
              検索に飛ばすだけのリンクと区別できるよう、色を濃くしている */}
          {officialLinks.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {officialLinks.map((link) => (
                <a
                  key={link.label}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full border border-purple-400/40 bg-purple-500/10 px-3 py-1 text-xs text-purple-200 transition hover:border-purple-400 hover:bg-purple-500/20"
                >
                  {link.label}
                </a>
              ))}
            </div>
          )}

          {/* 検索に飛ばすリンク */}
          <div className="mt-2 flex flex-wrap gap-2">
            {searchLinks.map((link) => (
              <a
                key={link.label}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full border border-white/10 px-3 py-1 text-xs text-gray-400 transition hover:border-purple-400 hover:text-purple-300"
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* 配信者一覧。見出しの横に JP / Global の切り替え */}
      <div className="mt-10 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-gray-200">配信中</h2>
        <SegmentedTabs
          options={[
            { label: "JP", href: `/games/${id}`, active: isJapanese },
            {
              label: "Global",
              href: `/games/${id}?lang=all`,
              active: !isJapanese,
            },
          ]}
        />
      </div>

      {streams.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500">
          {isJapanese ? (
            <>
              今このゲームを日本語で配信している人はいません。
              {/* 日本で0件でも海外では配信されていることが多いので、切り替え先を示す */}
              <Link
                href={`/games/${id}?lang=all`}
                className="ml-2 text-gray-200 transition hover:text-purple-400"
              >
                Globalで見る
              </Link>
            </>
          ) : (
            "今このゲームを配信している人はいません。"
          )}
        </p>
      ) : (
        <ul className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {streams.map((stream, index) => (
            <li key={stream.id} className="group">
              <a
                href={`https://twitch.tv/${stream.user_login}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <div className="relative overflow-hidden rounded-lg border border-white/10">
                  <Image
                    src={streamThumb(stream.thumbnail_url)}
                    alt={stream.title}
                    width={440}
                    height={248}
                    className="w-full transition duration-300 group-hover:scale-105"
                    unoptimized
                  />
                  <span className="absolute left-2 top-2 rounded bg-black/70 px-2 py-0.5 text-xs font-bold text-white">
                    {index + 1}
                  </span>
                  <span className="absolute right-2 top-2 flex items-center gap-1 rounded bg-red-600/90 px-2 py-0.5 text-xs font-bold text-white">
                    <span className="h-1.5 w-1.5 rounded-full bg-white" />
                    {formatViewers(stream.viewer_count)}
                  </span>
                  <span className="absolute bottom-2 left-2 rounded bg-black/70 px-2 py-0.5 text-xs text-gray-200">
                    {elapsedSince(stream.started_at)}
                  </span>
                </div>
              </a>

              <p className="mt-3 line-clamp-2 text-sm font-bold text-gray-100">
                {stream.title}
              </p>
              <Link
                href={`/streamers/${stream.user_login}`}
                className="mt-1.5 flex items-center gap-2 text-sm text-gray-200 transition hover:text-purple-400"
              >
                {users.get(stream.user_login)?.profile_image_url && (
                  <Image
                    src={users.get(stream.user_login)!.profile_image_url}
                    alt={stream.user_name}
                    width={24}
                    height={24}
                    className="shrink-0 rounded-full ring-1 ring-white/10"
                  />
                )}
                <span className="truncate">{stream.user_name}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
