import { cache } from "react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getAccountInfo } from "@/lib/account-stats";
import { AccountRecordPage } from "@/components/AccountRecordPage";

export const revalidate = 300;

type Props = {
  params: Promise<{ channelId: string }>;
  // ?day=2026-10-08：グラフで選んだ日。その日の配信をグラフの下に出す
  searchParams: Promise<{ day?: string }>;
};

// YouTube のチャンネルIDは「UC + 22文字」。形が違うURLは DB を引かずに404にする
const CHANNEL_ID = /^UC[\w-]{22}$/;

const loadAccount = cache((channelId: string) =>
  CHANNEL_ID.test(channelId) ? getAccountInfo("youtube", channelId) : null,
);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { channelId } = await params;
  const account = await loadAccount(channelId);
  if (!account) return { title: "見つかりません" };

  const name = account.displayName;
  const title = `${name}の同接・配信時間`;
  const description = `${name}（YouTube）の直近30日の平均同接・最高同接・配信時間と、最近のライブ配信。`;
  return {
    title,
    description,
    alternates: { canonical: `/youtube/${channelId}` },
    openGraph: { title, description, url: `/youtube/${channelId}` },
  };
}

/** YouTube だけで配信している人のページ。中身はツイキャスと共通（components/AccountRecordPage.tsx） */
export default async function YouTubeChannelPage({
  params,
  searchParams,
}: Props) {
  const { channelId } = await params;
  const { day } = await searchParams;
  const account = await loadAccount(channelId);
  // 記録に無いチャンネルはページを作らない（どんなIDでも表示すると、その分 API を呼ばれる）
  if (!account) notFound();
  // 名寄せ済みなら、Twitch などもまとめた人物のページへ。同じ内容のページを2つ作らない
  if (account.creatorId !== null) redirect(`/creators/${account.creatorId}`);

  return <AccountRecordPage account={account} day={day} />;
}
