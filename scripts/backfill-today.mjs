// today_peaks（今日これまでの最高同接）を、今日の毎時の記録から埋める。
// 使い方: node --env-file=.env.local scripts/backfill-today.mjs
//
// today_peaks は毎時の収集が配信を記録するたびに更新するが、作ったばかりのときや、
// 収集のコードを出す前の時間の分は空になる。そのときに1回だけ流す（今日の毎時の記録を読むので、夜だと約10万行）。
// 前より同接が多いときだけ書き換える形なので、何度流しても結果は変わらない。
// 日本の配信への絞り込みはページで読むときにやるので、ここでは全部入れる
const url = process.env.TURSO_DATABASE_URL.replace(/^libsql:/, "https:");
const token = process.env.TURSO_AUTH_TOKEN;

// 日本時間の今日の0時（UTC の ISO 文字列）と、日付
const jstNow = new Date(Date.now() + 9 * 3600 * 1000);
const day = jstNow.toISOString().slice(0, 10);
const from = new Date(`${day}T00:00:00+09:00`).toISOString();

const sql = `
  WITH t AS (
    SELECT account_id, viewers, title, content_id, game_id, captured_at,
      ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY viewers DESC, captured_at) AS rn
    FROM live_snapshots INDEXED BY idx_live_snapshots_time
    WHERE captured_at >= ?
  )
  INSERT INTO today_peaks
    (day, account_id, peak_viewers, peak_title, peak_content_id, peak_game_id, peak_at)
  SELECT ?, account_id, viewers, title, content_id, game_id, captured_at
  FROM t WHERE rn = 1 AND viewers > 0
  ON CONFLICT(day, account_id) DO UPDATE SET
    peak_viewers = excluded.peak_viewers,
    peak_title = excluded.peak_title,
    peak_content_id = excluded.peak_content_id,
    peak_game_id = excluded.peak_game_id,
    peak_at = excluded.peak_at
  WHERE excluded.peak_viewers > today_peaks.peak_viewers`;

const res = await fetch(`${url}/v2/pipeline`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    requests: [
      {
        type: "execute",
        stmt: {
          sql,
          args: [
            { type: "text", value: from },
            { type: "text", value: day },
          ],
        },
      },
      { type: "close" },
    ],
  }),
});
const r = (await res.json()).results[0];
if (r.type !== "ok") throw new Error(JSON.stringify(r.error));
const out = r.response.result;
console.log(
  `${day}（${from} から）: ${out.affected_row_count} 行を入れた・書き換えた / 読み取り ${out.rows_read} 行・書き込み ${out.rows_written} 行`,
);
