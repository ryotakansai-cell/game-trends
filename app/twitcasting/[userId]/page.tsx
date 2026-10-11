import { cache } from "react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getAccountInfo } from "@/lib/account-stats";
import { AccountRecordPage } from "@/components/AccountRecordPage";

export const revalidate = 300;

type Props = {
  params: Promise<{ userId: string }>;
  // ?day=2026-10-08：グラフで選んだ日。その日の配信をグラフの下に出す
  searchParams: Promise<{ day?: string }>;
};

// ツイキャスのユーザーIDは数字。形が違うURLは DB を引かずに404にする
const USER_ID = /^\d{1,24}$/;

const loadAccount = cache((userId: string) =>
  USER_ID.test(userId) ? getAccountInfo("twitcasting", userId) : null,
);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { userId } = await params;
  const account = await loadAccount(userId);
  if (!account) return { title: "見つかりません" };

  const name = account.displayName;
  const title = `${name}の同接・配信時間`;
  const description = `${name}（ツイキャス）の直近30日の平均同接・最高同接・配信時間と、最近のライブ配信。`;
  return {
    title,
    description,
    alternates: { canonical: `/twitcasting/${userId}` },
    openGraph: { title, description, url: `/twitcasting/${userId}` },
  };
}

/** ツイキャスだけで配信している人のページ。中身は YouTube と共通（components/AccountRecordPage.tsx） */
export default async function TwitcastingUserPage({
  params,
  searchParams,
}: Props) {
  const { userId } = await params;
  const { day } = await searchParams;
  const account = await loadAccount(userId);
  // 記録に無い人はページを作らない
  if (!account) notFound();
  // 名寄せ済みなら、ほかの配信元もまとめた人物のページへ
  if (account.creatorId !== null) redirect(`/creators/${account.creatorId}`);

  return <AccountRecordPage account={account} day={day} />;
}
