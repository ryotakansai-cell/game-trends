// ツイキャスのアカウントを名寄せするための候補集めと判定。
//
// Twitch のログイン名をそのままツイキャスの ID（screen_id）として引いてみる。
// ツイキャスの ID は X（Twitter）の ID と同じことが多く、配信者は各サービスで名前をそろえがちなので、
// 安く当たりを付けられる（1人1回。上限は1分60回なので、1.1秒ずつ空けて呼ぶ）。
// ただし YouTube の @ハンドルと違い、同じ ID でも別人の可能性がある（早い者勝ちで取れるため）。
// そこで「最近ツイキャスで配信しているか」と名前の似ている度合いで判定を付けて、人が確認してから確定する。
// 2026-10-11 に上位100人で試すと、同じ ID は19人で見つかったが、ほとんどが X でログインしただけの
// 配信していないアカウントだった（k4sen は最後の配信が2016年）。配信していないアカウントを紐付けても
// 記録もグラフも増えないので、紐付けない。サポーター数は鍵だけで読むと常に0なので判定に使えない
//
// 使い方:
//   npm run links:twitcasting -- 50     上位50人を新しく試し、未確定の候補を一覧にする（既定30人）
//   npm run links:twitcasting -- 0      新しくは試さず、未確定の候補の一覧だけ
// 確定は YouTube と同じく npm run links:confirm -- <候補id> …（却下は <候補id>:reject）
import { createClient } from "@libsql/client";
import { normalize, similarity } from "./name-match.mjs";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const id = process.env.TWITCASTING_CLIENT_ID;
const secret = process.env.TWITCASTING_CLIENT_SECRET;
if (!id || !secret) {
  console.error("TWITCASTING_CLIENT_ID / SECRET が読み込めませんでした。");
  process.exit(1);
}
const headers = {
  Accept: "application/json",
  "X-Api-Version": "2.0",
  Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 配信1本の情報（最後に配信した日を見るため） */
async function getMovie(movieId) {
  await sleep(1100);
  const res = await fetch(`https://apiv2.twitcasting.tv/movies/${movieId}`, {
    headers,
  });
  if (!res.ok) return null;
  return (await res.json()).movie;
}

/** ツイキャスのユーザー情報。いなければ null */
async function getUser(idOrScreenId) {
  await sleep(1100); // 上限（1分60回）を超えないように
  const res = await fetch(
    `https://apiv2.twitcasting.tv/users/${encodeURIComponent(idOrScreenId)}`,
    { headers },
  );
  if (res.status === 404) return null;
  if (!res.ok)
    throw new Error(`ツイキャス API ${res.status}: ${await res.text()}`);
  return (await res.json()).user;
}

const LIMIT = Number(process.argv[2] ?? 30);
const now = new Date().toISOString();

// ① 試す人を選ぶ。日本語の Twitch 配信者を、直近7日の最高同接が大きい順に。
//    名寄せ済みの人も含める（ツイキャスを既存の人物に足すのが主な目的なので）。
//    ツイキャスの候補を一度でも作った人と、既にツイキャスが紐付いている人は飛ばす
if (LIMIT > 0) {
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
  const targets = await db.execute({
    sql: `
      SELECT a.id, a.login, a.display_name, a.creator_id, MAX(d.peak_viewers) AS peak
      FROM daily_stats d
      JOIN accounts a ON a.id = d.account_id
      WHERE d.day >= ? AND a.platform = 'twitch' AND a.language = 'ja'
        AND NOT EXISTS (
          SELECT 1 FROM link_candidates c
          WHERE c.account_id = a.id AND c.platform = 'twitcasting'
        )
        AND NOT EXISTS (
          SELECT 1 FROM accounts t
          WHERE t.platform = 'twitcasting' AND t.creator_id IS NOT NULL
            AND t.creator_id = a.creator_id
        )
      GROUP BY a.id
      ORDER BY peak DESC
      LIMIT ?
    `,
    args: [since, LIMIT],
  });
  console.log(
    `対象: ${targets.rows.length}人（約${Math.ceil(targets.rows.length * 1.1)}秒）\n`,
  );

  let found = 0;
  for (const t of targets.rows) {
    const user = await getUser(t.login);
    // 見つからなかった人も「試した」記録を残すと二度と試さずに済むが、link_candidates は
    // 候補の表なので、見つかった人だけ入れる（見つからない人は次回また1回分かかる）
    if (!user) continue;
    found++;
    console.log(
      `★ ${t.display_name}（${t.peak}人）→ ${user.name} @${user.screen_id}`,
    );
    await db.execute({
      sql: `
        INSERT INTO link_candidates
          (account_id, platform, platform_id, title, source, status, created_at)
        VALUES (?, 'twitcasting', ?, ?, 'handle', 'pending', ?)
        ON CONFLICT(account_id, platform, platform_id) DO NOTHING
      `,
      args: [t.id, user.id, user.name, now],
    });
  }
  console.log(
    `\n${targets.rows.length}人中 ${found}人でツイキャスの同じ ID が見つかりました。`,
  );
}

// ② 未確定のツイキャスの候補を、判定の根拠つきで並べる
const rows = await db.execute(`
  SELECT c.id, c.platform_id, c.title, a.display_name AS from_name,
         a.login AS from_login, a.creator_id,
         cr.display_name AS creator_name
  FROM link_candidates c
  JOIN accounts a ON a.id = c.account_id
  LEFT JOIN creators cr ON cr.id = a.creator_id
  WHERE c.status = 'pending' AND c.platform = 'twitcasting'
  ORDER BY c.id
`);
if (rows.rows.length === 0) {
  console.log("\n未確定のツイキャスの候補はありません。");
  process.exit(0);
}

console.log(
  `\n未確定の候補 ${rows.rows.length}件（判定のためにユーザー情報を読み直します）`,
);
const strong = [];
const weak = [];
const reject = [];
for (const r of rows.rows) {
  const user = await getUser(r.platform_id);
  if (!user) {
    console.log(`\n[${r.id}] × アカウントが消えている → 却下`);
    reject.push(`${r.id}:reject`);
    continue;
  }
  // Twitch の表示名と、名寄せ済みなら人物の名前の、似ている方で比べる
  const names = [r.from_name, r.creator_name].filter(Boolean);
  const sim = Math.max(
    ...names.map((n) => similarity(normalize(n), normalize(user.name))),
  );
  const contains = names.some((n) => {
    const a = normalize(n);
    const b = normalize(user.name);
    return a.length >= 2 && b.length >= 2 && (a.includes(b) || b.includes(a));
  });
  // 最後に配信した日（一度も配信していなければ null）
  const lastMovie = user.last_movie_id ? await getMovie(user.last_movie_id) : null;
  const lastDay = lastMovie
    ? new Date(lastMovie.created * 1000).toISOString().slice(0, 10)
    : null;
  const active =
    lastMovie !== null &&
    Date.now() - lastMovie.created * 1000 < 90 * 24 * 3600 * 1000;

  let mark;
  const reasons = [
    `ID一致（@${user.screen_id}）`,
    `名前の類似度 ${sim.toFixed(2)}`,
    lastDay ? `最後の配信 ${lastDay}` : "配信したことがない",
  ];
  if (!active) {
    // 本人かどうかに関係なく、ツイキャスで配信していないので紐付けても何も増えない。
    // 却下として残すと、次回からこの人を試さずに済む
    mark = "－";
    reasons.push("最近ツイキャスで配信していない");
    reject.push(`${r.id}:reject`);
  } else if (sim >= 0.7 || contains) {
    mark = "◎";
    strong.push(`${r.id}`);
  } else {
    // ID は同じだが名前が違う。本人の可能性はあるので人が見る
    mark = "？";
    weak.push(`${r.id}`);
  }
  console.log(
    `\n[${r.id}] ${mark} ${r.creator_name ?? r.from_name}（twitch: ${r.from_login}）→ ツイキャス「${user.name}」`,
  );
  console.log(`     根拠: ${reasons.join(" ／ ")}`);
  console.log(`     https://twitcasting.tv/${user.screen_id}`);
}

console.log("\n────────────────────────────────────────");
if (strong.length + reject.length > 0) {
  console.log("【◎を本人として確定し、－（配信していない）を却下する】");
  console.log(`npm run links:confirm -- ${[...strong, ...reject].join(" ")}`);
}
if (weak.length > 0) {
  console.log(
    `\n？の ${weak.length}件は、ツイキャスのページを開いて本人か確かめてから候補idを指定してください。`,
  );
}
