import Image from "next/image";
import Link from "next/link";
import { getCreators } from "@/lib/creators";
import { getUsersByLogin } from "@/lib/twitch";

// YouTube APIを使わない（Twitchのみ）ので短めでよい
export const revalidate = 600;

export default async function CreatorsPage() {
  const creators = await getCreators();

  // アイコンはTwitch本人アカウントのものを使う。
  // getUsersByLogin は100件まで1回のAPI呼び出しでまとめて取れる
  const logins = creators
    .map((c) => c.twitchLogin)
    .filter((l): l is string => l !== null);
  const users = await getUsersByLogin(logins);

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <Link href="/" className="text-sm text-gray-500 hover:text-purple-400">
        ← 配信ランキング
      </Link>

      <h1 className="mt-4 text-4xl font-bold text-purple-400">Creators</h1>
      <p className="mt-2 text-sm text-gray-400">
        プラットフォームをまたいで紐付けた配信者 ・ {creators.length}人
      </p>

      {creators.length === 0 ? (
        <p className="mt-8 text-sm text-gray-500">
          まだ紐付けが登録されていません。
        </p>
      ) : (
        <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {creators.map((creator) => {
            const icon = creator.twitchLogin
              ? users.get(creator.twitchLogin)?.profile_image_url
              : undefined;

            return (
              <li key={creator.id}>
                <Link
                  href={`/creators/${creator.id}`}
                  className="flex items-center gap-4 rounded-xl border border-white/10 bg-white/5 p-4 transition hover:border-purple-400/50"
                >
                  {icon && (
                    <Image
                      src={icon}
                      alt={creator.displayName}
                      width={56}
                      height={56}
                      className="shrink-0 rounded-full ring-2 ring-purple-500/30"
                    />
                  )}
                  {/* min-w-0 を付けないと truncate が効かない（flexの子の既定は縮まない） */}
                  <div className="min-w-0">
                    <p className="truncate font-bold text-gray-100">
                      {creator.displayName}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      {creator.accountCount}アカウント ・{" "}
                      {creator.platforms.join(" / ")}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
