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

// ツイキャスのユーザーIDは数字だけとは限らない。X・Google・Instagram・Facebook で
// ログインしている人は「c:名前」「g:数字」「i:数字」「f:数字」の形になる（2026-11-11 に DB で確認：
// 3,126人のうち839人がこの形で、数字だけと決めつけていたため全員のページが404だった）。
// 形が明らかに違うURLは、これまでどおり DB を引かずに404にする
const USER_ID = /^(?:[a-z]:)?[A-Za-z0-9_]{1,40}$/;

/** URL の ID を DB と同じ形に戻す。Next.js は同じリクエストの中でも、generateMetadata には
 *  「c:mwmwm_」、ページ本体には「c%3Amwmwm_」（: を %3A にした形）を渡すことがあった
 *  （2026-11-11 に next dev で確認）。戻さないとページ本体だけ ID の形のチェックで落ちて404になる */
function normalizeUserId(raw: string) {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw; // 壊れた %xx は戻せないので、そのまま形のチェックで落とす
  }
}

const loadAccount = cache((userId: string) =>
  USER_ID.test(userId) ? getAccountInfo("twitcasting", userId) : null,
);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const userId = normalizeUserId((await params).userId);
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
  const userId = normalizeUserId((await params).userId);
  const { day } = await searchParams;
  const account = await loadAccount(userId);
  // 記録に無い人はページを作らない
  if (!account) notFound();
  // 名寄せ済みなら、ほかの配信元もまとめた人物のページへ
  if (account.creatorId !== null) redirect(`/creators/${account.creatorId}`);

  return <AccountRecordPage account={account} day={day} />;
}
