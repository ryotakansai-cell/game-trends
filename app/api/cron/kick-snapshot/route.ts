import { NextRequest, NextResponse } from "next/server";
import {
  getLivestreams,
  getChannels,
  getUsers,
  thumbnailId,
  type KickLivestream,
} from "@/lib/kick";
import { getGamesByNames } from "@/lib/twitch";
import { getDbClient, batchInChunks } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 毎時、Kick の配信中の記録を live_snapshots に保存する（cron-worker から呼ばれる）。
// 日本語の上位100件（同接10人以上は全部入る）＋ 全世界の上位100件（Global のタブと急上昇用）
// ＋ 名寄せ済みでそこに入っていない人。?dryRun=1 は保存せずに件数だけ返す
export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "権限がありません" }, { status: 401 });
  }

  try {
    const db = getDbClient();
    const [ja, global] = await Promise.all([
      getLivestreams("ja", 0),
      getLivestreams(undefined, 0),
    ]);
    const byUser = new Map<number, KickLivestream>();
    for (const s of [...global, ...ja]) byUser.set(s.broadcaster_user_id, s);

    // 名寄せ済みの人で、上の2つに入っていない人は直接確かめる（少ない時間帯も欠けなく記録するため）
    const linked = await db.execute(`
      SELECT platform_id FROM accounts
      WHERE platform = 'kick' AND creator_id IS NOT NULL
    `);
    const notCovered = linked.rows
      .map((r) => Number(r.platform_id))
      .filter((id) => !byUser.has(id));
    const channels = notCovered.length
      ? await getChannels("broadcaster_user_id", notCovered).catch(() => [])
      : [];
    let linkedLive = 0;
    for (const c of channels) {
      if (!c.stream?.is_live) continue;
      linkedLive++;
      byUser.set(c.broadcaster_user_id, {
        broadcaster_user_id: c.broadcaster_user_id,
        channel_id: 0,
        slug: c.slug,
        stream_title: c.stream_title,
        language: c.stream.language,
        viewer_count: c.stream.viewer_count,
        thumbnail: c.stream.thumbnail,
        started_at: c.stream.start_time,
        category: c.category,
        profile_picture: null,
      });
    }

    // 視聴者0の配信は記録しない（Twitch と同じ）
    const streams = [...byUser.values()].filter((s) => s.viewer_count > 0);

    // 名前とアイコン（Kick は表示名とユーザー名が同じ。大文字小文字はこちらが正しい）
    const users = await getUsers(streams.map((s) => s.broadcaster_user_id));
    // カテゴリ名を Twitch のゲームに結び付ける（ゲームランキング・日ごとの集計の「一番遊んだゲーム」・同じゲームの人に使う）
    const games = await getGamesByNames(
      streams.map((s) => s.category?.name ?? ""),
    ).catch(() => new Map());
    const capturedAt = new Date().toISOString();

    if (request.nextUrl.searchParams.get("dryRun") === "1") {
      const categories = [
        ...new Set(streams.map((s) => s.category?.name).filter(Boolean)),
      ] as string[];
      return NextResponse.json({
        dry_run: true,
        ja: ja.length,
        global: global.length,
        linked_checked: notCovered.length,
        linked_live: linkedLive,
        streams: streams.length,
        names_found: users.size,
        categories: categories.length,
        categories_matched: categories.filter((c) => games.has(c)).length,
        top5_ja: ja
          .slice(0, 5)
          .map(
            (s) =>
              `${users.get(s.broadcaster_user_id)?.name ?? s.slug} ${s.viewer_count}`,
          ),
      });
    }

    // accounts を UPSERT。名前・アイコンなどが前回と同じなら書き込まない（書き込み枠の節約。Twitch と同じ）
    await batchInChunks(
      db,
      streams.map((s) => {
        const u = users.get(s.broadcaster_user_id);
        return {
          sql: `
            INSERT INTO accounts (platform, platform_id, login, display_name, language, icon_url, updated_at)
            VALUES ('kick', ?, ?, ?, ?, ?, ?)
            ON CONFLICT(platform, platform_id) DO UPDATE SET
              login = excluded.login,
              display_name = excluded.display_name,
              language = excluded.language,
              icon_url = COALESCE(excluded.icon_url, accounts.icon_url),
              updated_at = excluded.updated_at
            WHERE accounts.login IS NOT excluded.login
               OR accounts.display_name IS NOT excluded.display_name
               OR accounts.language IS NOT excluded.language
               OR (excluded.icon_url IS NOT NULL AND accounts.icon_url IS NOT excluded.icon_url)
          `,
          args: [
            String(s.broadcaster_user_id),
            s.slug,
            u?.name ?? s.slug,
            s.language || null,
            u?.profile_picture ?? s.profile_picture ?? null,
            capturedAt,
          ],
        };
      }),
    );

    // live_snapshots を INSERT。content_id にはサムネイルの URL の一部（配信ごとのID）を入れる
    // （急上昇などで、あとから同じサムネイルを出すため。配信が変わると ID も変わるので、配信ごとのまとめにも使える）
    await batchInChunks(
      db,
      streams.map((s) => ({
        sql: `
          INSERT INTO live_snapshots (account_id, viewers, title, content_id, game_id, captured_at)
          VALUES (
            (SELECT id FROM accounts WHERE platform = 'kick' AND platform_id = ?),
            ?, ?, ?, ?, ?
          )
        `,
        args: [
          String(s.broadcaster_user_id),
          s.viewer_count,
          s.stream_title,
          thumbnailId(s.thumbnail),
          games.get(s.category?.name ?? "")?.id ?? null,
          capturedAt,
        ],
      })),
    );

    return NextResponse.json({
      ja: ja.length,
      global: global.length,
      linked_live: linkedLive,
      snapshots: streams.length,
      captured_at: capturedAt,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
