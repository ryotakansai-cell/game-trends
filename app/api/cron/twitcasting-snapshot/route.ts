import { NextRequest, NextResponse } from "next/server";
import {
  getRecommendedLives,
  getCurrentLive,
  getUser,
  toHttps,
  type TwitcastingLive,
} from "@/lib/twitcasting";
import { getDbClient, batchInChunks } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 名寄せ済みの人を直接確かめる上限。API は1分60回までなので、
// 「おすすめ」の1回と、表示側の呼び出しの分を残しておく
const MAX_DIRECT_CHECKS = 40;
// 名寄せで登録したばかりで screen_id（URL 用の名前）やアイコンが無いアカウントを埋める数（1回あたり）
const MAX_PROFILE_FILLS = 10;

// 毎時、ツイキャスの配信中の記録を live_snapshots に保存する（cron-worker から呼ばれる）。
// ?dryRun=1 は保存せずに件数だけ返す
export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "権限がありません" }, { status: 401 });
  }

  try {
    const db = getDbClient();
    // ① 「おすすめ」の上位100件（日本語）。同接30人以上はすべてここに入る（lib/twitcasting.ts）
    const recommended = await getRecommendedLives(0);
    const byUser = new Map<string, TwitcastingLive>();
    for (const l of recommended) byUser.set(l.broadcaster.id, l);

    // ② 名寄せ済みの人で、①に入っていない人は直接確かめる（人数が少ない時間帯も欠けなく記録するため）
    const linked = await db.execute(`
      -- creator_id の索引で名寄せ済みの人だけを引く（cron/snapshot と同じ理由）
      SELECT platform_id FROM accounts INDEXED BY idx_accounts_creator
      WHERE platform = 'twitcasting' AND creator_id IS NOT NULL
    `);
    const notCovered = linked.rows
      .map((r) => String(r.platform_id))
      .filter((id) => !byUser.has(id))
      .slice(0, MAX_DIRECT_CHECKS);
    const direct = await Promise.all(
      notCovered.map((id) => getCurrentLive(id, 0).catch(() => null)),
    );
    for (const l of direct) if (l) byUser.set(l.broadcaster.id, l);

    // ②' 名寄せで登録したアカウント（links:confirm）は screen_id とアイコンが空なので、
    // 配信していなくても少しずつ埋める（ページのリンク先とアイコンに使う）
    const missing = await db.execute({
      sql: `SELECT platform_id FROM accounts
            WHERE platform = 'twitcasting' AND (login IS NULL OR icon_url IS NULL)
            LIMIT ?`,
      args: [MAX_PROFILE_FILLS],
    });
    const profiles = (
      await Promise.all(
        missing.rows.map((r) =>
          getUser(String(r.platform_id)).catch(() => null),
        ),
      )
    ).filter((u) => u !== null);

    // 視聴者0の配信は記録しない（Twitch と同じ）
    const lives = [...byUser.values()].filter(
      (l) => l.movie.current_view_count > 0,
    );
    const capturedAt = new Date().toISOString();

    if (request.nextUrl.searchParams.get("dryRun") === "1") {
      const viewers = lives
        .map((l) => l.movie.current_view_count)
        .sort((a, b) => b - a);
      return NextResponse.json({
        dry_run: true,
        recommended: recommended.length,
        linked_checked: notCovered.length,
        linked_live: direct.filter(Boolean).length,
        profiles_to_fill: profiles.length,
        lives: lives.length,
        top5: lives
          .sort(
            (a, b) => b.movie.current_view_count - a.movie.current_view_count,
          )
          .slice(0, 5)
          .map((l) => `${l.broadcaster.name} ${l.movie.current_view_count}`),
        over_10: viewers.filter((v) => v >= 10).length,
      });
    }

    // ③ accounts を UPSERT。名前・アイコンなどが前回と同じなら書き込まない（Twitch と同じ。書き込み枠の節約）。
    // ツイキャスは日本語の配信だけを集めているので language は 'ja'
    await batchInChunks(
      db,
      lives.map(({ broadcaster: b }) => ({
        sql: `
          INSERT INTO accounts (platform, platform_id, login, display_name, language, icon_url, updated_at)
          VALUES ('twitcasting', ?, ?, ?, 'ja', ?, ?)
          ON CONFLICT(platform, platform_id) DO UPDATE SET
            login = excluded.login,
            display_name = excluded.display_name,
            icon_url = excluded.icon_url,
            updated_at = excluded.updated_at
          WHERE accounts.login IS NOT excluded.login
             OR accounts.display_name IS NOT excluded.display_name
             OR accounts.icon_url IS NOT excluded.icon_url
        `,
        args: [b.id, b.screen_id, b.name, toHttps(b.image), capturedAt],
      })),
    );

    // ③' 名寄せで登録したアカウントの screen_id・アイコンを埋める（名前は名寄せのときの表示名を残す）
    if (profiles.length > 0) {
      await db.batch(
        profiles.map((u) => ({
          sql: `UPDATE accounts SET login = ?, icon_url = ?, updated_at = ?
                WHERE platform = 'twitcasting' AND platform_id = ?`,
          args: [u.screen_id, toHttps(u.image), capturedAt, u.id],
        })),
        "write",
      );
    }

    // ④ live_snapshots を INSERT。content_id には配信（movie）のIDを入れる
    // （配信者ページの「最近の配信」で、配信ごとにまとめて録画へリンクするため）
    await batchInChunks(
      db,
      lives.map(({ movie: m, broadcaster: b }) => ({
        sql: `
          INSERT INTO live_snapshots (account_id, viewers, title, content_id, captured_at)
          VALUES (
            (SELECT id FROM accounts WHERE platform = 'twitcasting' AND platform_id = ?),
            ?, ?, ?, ?
          )
        `,
        args: [b.id, m.current_view_count, m.title, m.id, capturedAt],
      })),
    );

    return NextResponse.json({
      recommended: recommended.length,
      linked_checked: notCovered.length,
      profiles_filled: profiles.length,
      snapshots: lives.length,
      captured_at: capturedAt,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
