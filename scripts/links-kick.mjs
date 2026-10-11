// Kick のアカウントを名寄せするための候補集めと判定。
//
// Kick のユーザー名（slug）と Twitch のログイン名が同じ人を探す。両方とも英数字の ID で、
// 配信者は各サービスで ID をそろえがちなので、安く当たりを付けられる（どちらも1回でまとめて引ける）。
//   - Kick で実際に配信している日本の人（毎時の記録にいる人）→ 同じ名前の Twitch を引く
//   - 名寄せ済みの人の Twitch のログイン名 → 同じ名前の Kick を引く
//   - ツイキャスで配信している人の ID → 同じ名前の Kick を引く（石川典行はツイキャスも Kick も icchy8591）
// ツイキャスでは「同じ ID はあるが一度も配信していない」アカウントばかりだったので、
// Kick で実際に配信しているか（毎時の記録にいるか）を判定の決め手にする。人が確認してから確定する。
//
// 使い方:
//   npm run links:kick          候補を集めて、未確定の候補を一覧にする
// 確定は YouTube・ツイキャスと同じく npm run links:confirm -- <候補id> …（却下は <候補id>:reject）
import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const now = new Date().toISOString();

// ---- Kick と Twitch のトークン（アプリの鍵だけでもらう） ----
async function token(url, id, secret) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: id,
      client_secret: secret,
    }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error(`トークン取得に失敗: ${url}`);
  return json.access_token;
}
const kickToken = await token(
  "https://id.kick.com/oauth/token",
  process.env.KICK_CLIENT_ID,
  process.env.KICK_CLIENT_SECRET,
);
const twitchToken = await token(
  "https://id.twitch.tv/oauth2/token",
  process.env.TWITCH_CLIENT_ID,
  process.env.TWITCH_CLIENT_SECRET,
);

async function kickChannelsBySlug(slugs) {
  const out = [];
  for (let i = 0; i < slugs.length; i += 50) {
    const q = slugs
      .slice(i, i + 50)
      .map((s) => `slug=${encodeURIComponent(s)}`)
      .join("&");
    const res = await fetch(`https://api.kick.com/public/v1/channels?${q}`, {
      headers: { Authorization: `Bearer ${kickToken}` },
    });
    out.push(...((await res.json()).data ?? []));
  }
  return out;
}
async function twitchUsersByLogin(logins) {
  const out = [];
  for (let i = 0; i < logins.length; i += 100) {
    const q = logins
      .slice(i, i + 100)
      .map((l) => `login=${encodeURIComponent(l)}`)
      .join("&");
    const res = await fetch(`https://api.twitch.tv/helix/users?${q}`, {
      headers: {
        "Client-Id": process.env.TWITCH_CLIENT_ID,
        Authorization: `Bearer ${twitchToken}`,
      },
    });
    out.push(...((await res.json()).data ?? []));
  }
  return out;
}

// ① Kick で配信している日本の人（直近7日の毎時の記録にいる人）と、その一番多かった同接
const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
const kickActive = await db.execute({
  sql: `SELECT a.id, a.platform_id, a.login, a.display_name, a.creator_id, MAX(l.viewers) AS peak
        FROM live_snapshots l JOIN accounts a ON a.id = l.account_id
        WHERE a.platform = 'kick' AND a.language = 'ja' AND l.captured_at >= ?
        GROUP BY a.id`,
  args: [since],
});
const kickBySlug = new Map(
  kickActive.rows.map((r) => [String(r.login).toLowerCase(), r]),
);

// ② その人たちと同じ名前の Twitch を引く（Twitch API。100人ずつ）
const twitchUsers = await twitchUsersByLogin([...kickBySlug.keys()]);

// ③ 名寄せ済みの人の Twitch のログイン名と同じ名前の Kick を引く（Kick API。50人ずつ）
const linkedTwitch = await db.execute(`
  SELECT a.id, a.login, a.display_name, a.creator_id, c.display_name AS creator_name
  FROM accounts a JOIN creators c ON c.id = a.creator_id
  WHERE a.platform = 'twitch' AND a.relation = 'self'
    AND NOT EXISTS (
      SELECT 1 FROM accounts k WHERE k.platform = 'kick' AND k.creator_id = a.creator_id
    )
`);
const kickChannels = await kickChannelsBySlug(
  linkedTwitch.rows.map((r) => String(r.login)),
);
const kickChannelBySlug = new Map(
  kickChannels.map((c) => [c.slug.toLowerCase(), c]),
);

// ④ Twitch のアカウントを DB から引く（候補は「Twitch のアカウント → Kick のアカウント」の形で残す）
const twitchLogins = [
  ...new Set([
    ...twitchUsers.map((u) => u.login),
    ...linkedTwitch.rows
      .map((r) => String(r.login))
      .filter((l) => kickChannelBySlug.has(l.toLowerCase())),
  ]),
];
const twitchAccounts = twitchLogins.length
  ? (
      await db.execute({
        sql: `SELECT id, login, display_name, creator_id FROM accounts
              WHERE platform = 'twitch' AND login IN (${twitchLogins.map(() => "?").join(",")})`,
        args: twitchLogins,
      })
    ).rows
  : [];
const twitchAccountByLogin = new Map(
  twitchAccounts.map((r) => [String(r.login).toLowerCase(), r]),
);

// ⑤ 候補として保存する（Twitch のアカウントが DB に無い人は、まだ記録に出てこない小さな Twitch なので飛ばす）
let added = 0;
for (const login of twitchLogins) {
  const tw = twitchAccountByLogin.get(login.toLowerCase());
  if (!tw) continue;
  const kickRow = kickBySlug.get(login.toLowerCase());
  const kickChannel = kickChannelBySlug.get(login.toLowerCase());
  const kickId = kickRow
    ? String(kickRow.platform_id)
    : kickChannel
      ? String(kickChannel.broadcaster_user_id)
      : null;
  if (!kickId) continue;
  const r = await db.execute({
    sql: `INSERT INTO link_candidates
            (account_id, platform, platform_id, title, source, status, created_at)
          VALUES (?, 'kick', ?, ?, 'handle', 'pending', ?)
          ON CONFLICT(account_id, platform, platform_id) DO NOTHING`,
    args: [tw.id, kickId, login, now],
  });
  added += r.rowsAffected;
}
console.log(
  `Kick で配信している日本の人: ${kickBySlug.size}人 / 同じ名前の Twitch: ${twitchUsers.length}人 / 名寄せ済みの人の同じ名前の Kick: ${kickChannels.length}人`,
);
console.log(`新しい候補: ${added}件`);

// ⑤' ツイキャスで配信している人（直近7日の記録にいる人）と同じ名前の Kick を引く
const tcActive = await db.execute({
  sql: `SELECT DISTINCT a.id, a.login FROM live_snapshots l JOIN accounts a ON a.id = l.account_id
        WHERE a.platform = 'twitcasting' AND a.login IS NOT NULL AND l.captured_at >= ?
          AND NOT EXISTS (
            SELECT 1 FROM accounts k WHERE k.platform = 'kick' AND k.creator_id IS NOT NULL
              AND k.creator_id = a.creator_id
          )`,
  args: [since],
});
const tcKick = await kickChannelsBySlug(
  tcActive.rows.map((r) => String(r.login)),
);
const tcByLogin = new Map(
  tcActive.rows.map((r) => [String(r.login).toLowerCase(), r]),
);
let tcAdded = 0;
for (const c of tcKick) {
  const tc = tcByLogin.get(c.slug.toLowerCase());
  if (!tc) continue;
  const res = await db.execute({
    sql: `INSERT INTO link_candidates
            (account_id, platform, platform_id, title, source, status, created_at)
          VALUES (?, 'kick', ?, ?, 'handle', 'pending', ?)
          ON CONFLICT(account_id, platform, platform_id) DO NOTHING`,
    args: [tc.id, String(c.broadcaster_user_id), c.slug, now],
  });
  tcAdded += res.rowsAffected;
}
console.log(
  `ツイキャスで配信している人: ${tcActive.rows.length}人 / 同じ名前の Kick: ${tcKick.length}人（新しい候補 ${tcAdded}件）`,
);

// ⑥ 未確定の Kick の候補を、判定の根拠つきで並べる
const pending = await db.execute(`
  SELECT c.id, c.platform_id, c.title, a.platform AS from_platform,
         a.login AS twitch_login, a.display_name AS twitch_name,
         a.creator_id, cr.display_name AS creator_name,
         (SELECT MAX(l.viewers) FROM live_snapshots l JOIN accounts k ON k.id = l.account_id
          WHERE k.platform = 'kick' AND k.platform_id = c.platform_id) AS kick_peak,
         (SELECT MAX(d.peak_viewers) FROM daily_stats d WHERE d.account_id = a.id) AS twitch_peak
  FROM link_candidates c
  JOIN accounts a ON a.id = c.account_id
  LEFT JOIN creators cr ON cr.id = a.creator_id
  WHERE c.status = 'pending' AND c.platform = 'kick'
  ORDER BY COALESCE(kick_peak, 0) DESC
`);
const strong = [];
const weak = [];
for (const r of pending.rows) {
  // 決め手は「Kick で実際に配信している（毎時の記録にいる）か」。同じ ID を取っただけのアカウントは紐付けない
  const active = r.kick_peak !== null;
  const mark = active ? "◎" : "？";
  (active ? strong : weak).push(String(r.id));
  console.log(
    `\n[${r.id}] ${mark} ${r.creator_name ?? r.twitch_name}（${r.from_platform}: ${r.twitch_login}${r.twitch_peak ? ` 最高${r.twitch_peak}人` : ""}）→ Kick: ${r.title}`,
  );
  console.log(
    `     根拠: ID一致 ／ ${active ? `Kick で配信を確認（最高${r.kick_peak}人）` : "Kick での配信をまだ記録していない"}`,
  );
  console.log(`     https://kick.com/${r.title}`);
}
console.log("\n────────────────────────────────────────");
if (strong.length > 0) {
  console.log("【◎（Kick で配信している人）を本人として確定する】");
  console.log(`npm run links:confirm -- ${strong.join(" ")}`);
}
if (weak.length > 0) {
  console.log(
    `\n？の ${weak.length}件は Kick での配信をまだ記録していない。数日たってから npm run links:kick でもう一度見る`,
  );
}
