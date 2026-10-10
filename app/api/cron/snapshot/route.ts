import { NextRequest, NextResponse } from "next/server";
import {
  getTopGames,
  getViewerCountByGame,
  getTopStreamsPaged,
  getStreamsByUserIds,
  getJapaneseStreams,
  isRealGame,
  type TwitchStreamFull,
} from "@/lib/twitch";
import { getDbClient, batchInChunks } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  // ① 合言葉チェック
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "権限がありません" }, { status: 401 });
  }

  try {
    // ② Twitchからデータを取得（並列）
    const [topGames, viewerCounts, topStreams, jpStreams] = await Promise.all([
      getTopGames(60),
      getViewerCountByGame(4),
      getTopStreamsPaged(8),
      // 日本語の配信は10人以上を全部。新人も含めて分析の対象にするため
      getJapaneseStreams(10),
    ]);

    const games = topGames.filter(isRealGame);
    const db = getDbClient();

    // 全世界の上位800と日本語の配信は重なるので、配信者IDで1つにまとめる。
    // Map は C# の Dictionary と同じで、同じキーを set すると上書きになる
    const byUser = new Map<string, TwitchStreamFull>();
    for (const s of [...topStreams, ...jpStreams]) byUser.set(s.user_id, s);

    // ②' 名寄せ済みの配信者で、上の2つに入っていない人は直接確かめる。
    // 配信の言語を日本語以外にしている人や、10人を割った時間帯も欠けなく記録するため
    const linked = await db.execute(`
      SELECT platform_id FROM accounts
      WHERE platform = 'twitch' AND creator_id IS NOT NULL
    `);
    const notCovered = linked.rows
      .map((r) => String(r.platform_id))
      .filter((id) => !byUser.has(id));
    const linkedStreams = await getStreamsByUserIds(notCovered);
    for (const s of linkedStreams) byUser.set(s.user_id, s);

    const allStreams = [...byUser.values()];

    // ?dryRun=1 のときは保存せずに結果だけ返す。
    // 手元から試すたびに本番のDBへ余分な記録が増えるのを防ぐ（DBは本番の1つだけなので）
    if (request.nextUrl.searchParams.get("dryRun") === "1") {
      return NextResponse.json({
        dry_run: true,
        top_streams: topStreams.length,
        jp_streams: jpStreams.length,
        linked: linked.rows.length,
        linked_live_outside: linkedStreams.length,
        total: allStreams.length,
      });
    }

    // ③ games を UPSERT
    const gameRows = games.map((g) => ({
      id: g.id,
      name: g.name,
      box_art_url: g.box_art_url,
      igdb_id: g.igdb_id || null,
      updated_at: new Date().toISOString(),
    }));

    await db.batch(
      gameRows.map((g) => ({
        sql: `
      INSERT INTO games (id, name, box_art_url, igdb_id, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        box_art_url = excluded.box_art_url,
        igdb_id = excluded.igdb_id,
        updated_at = excluded.updated_at
    `,
        args: [g.id, g.name, g.box_art_url, g.igdb_id, g.updated_at],
      })),
      "write",
    );
    // ④ snapshots を INSERT
    const capturedAt = new Date().toISOString();

    const snapshotRows = games
      .map((g) => ({
        game_id: g.id,
        viewers: viewerCounts.get(g.id) ?? 0,
        captured_at: capturedAt,
      }))
      .filter((row) => row.viewers > 0);
    await db.batch(
      snapshotRows.map((s) => ({
        sql: `
      INSERT INTO snapshots (game_id, viewers, captured_at)
      VALUES (?,?,?)
    `,
        args: [s.game_id, s.viewers, s.captured_at],
      })),
      "write",
    );

    // ⑤ 配信者ごとの記録を組み立てる（視聴者0の配信は除外）
    const streamerSnapshotRows = allStreams
      .map((s) => ({
        streamer_id: s.user_id,
        viewers: s.viewer_count,
        game_id: s.game_id || null,
        title: s.title, // 配信タイトル（急上昇ページで表示するため保存する）
        captured_at: capturedAt,
      }))
      .filter((row) => row.viewers > 0);

    // ⑥ accounts を UPSERT（全プラットフォーム共通テーブル）。
    // 名前などが前回と同じなら書き込まない（末尾の WHERE）。毎時2,000件以上を
    // 同じ値で上書きすると、Turso の書き込み枠（月1,000万行）の約3割をそれだけで使うため。
    // IS NOT は「NULL どうしも等しいとみなす !=」（language が NULL の行があるので必要）
    await batchInChunks(
      db,
      allStreams.map((s) => ({
        sql: `
          INSERT INTO accounts (platform, platform_id, login, display_name, language, updated_at)
          VALUES ('twitch', ?, ?, ?, ?, ?)
          ON CONFLICT(platform, platform_id) DO UPDATE SET
            login = excluded.login,
            display_name = excluded.display_name,
            language = excluded.language,
            updated_at = excluded.updated_at
          WHERE accounts.login IS NOT excluded.login
             OR accounts.display_name IS NOT excluded.display_name
             OR accounts.language IS NOT excluded.language
        `,
        args: [s.user_id, s.user_login, s.user_name, s.language, capturedAt],
      })),
    );

    // ⑦ live_snapshots を INSERT
    await batchInChunks(
      db,
      streamerSnapshotRows.map((s) => ({
        sql: `
          INSERT INTO live_snapshots (account_id, viewers, title, game_id, captured_at)
          VALUES (
            -- 新テーブルは内部ID(accounts.id)で管理しているので、
            -- 「TwitchのID → 内部ID」の変換をDB側にやらせている。
            -- ⑥で先にaccountsを更新済みなので必ず見つかる
            (SELECT id FROM accounts WHERE platform = 'twitch' AND platform_id = ?),
            ?, ?, ?, ?
          )
        `,
        args: [s.streamer_id, s.viewers, s.title, s.game_id, s.captured_at],
      })),
    );

    return NextResponse.json({
      games: gameRows.length,
      snapshots: snapshotRows.length,
      streamers: allStreams.length,
      jp_streams: jpStreams.length,
      linked_live_outside: linkedStreams.length,
      streamer_snapshots: streamerSnapshotRows.length,
      captured_at: capturedAt,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
