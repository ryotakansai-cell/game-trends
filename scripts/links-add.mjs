// 検索では見つからないチャンネルを、URLを直接指定して手動で紐付ける。
// 名前が別名・伏字・ローマ字表記の配信者は名前検索では絶対に当たらないので、
// その穴を確実に塞ぐための口。
//
// 使い方:
//   npm run links:add -- kato_junichi0817 https://www.youtube.com/@xxxx
//   npm run links:add -- 2 UCxxxxxxxxxxxxxxxxxxxxxx clip
//
// 第1引数はTwitchのログイン名でも account_id でもよい。
// 第3引数（関係）を省くと self（本人）になる。
//
// 消費: channels.list 1ユニットのみ（検索の100分の1）
import { createClient } from "@libsql/client";
import { linkAccount, printSummary } from "./link-core.mjs";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const apiKey = process.env.YOUTUBE_API_KEY;

const [source, target, relation = "self"] = process.argv.slice(2);

if (!source || !target) {
  console.error(
    "使い方: npm run links:add -- <ログイン名かaccount_id> <YouTubeのURLかチャンネルID> [self|clip|archive]",
  );
  process.exit(1);
}
if (!["self", "clip", "archive"].includes(relation)) {
  console.error(
    `関係は self / clip / archive のいずれかです（指定: ${relation}）`,
  );
  process.exit(1);
}

// ① 紐付け元のTwitchアカウントを特定する。
//    数字なら account_id、そうでなければログイン名として扱う
const isNumeric = /^\d+$/.test(source);
const found = await db.execute({
  sql: isNumeric
    ? `SELECT id, display_name FROM accounts WHERE id = ?`
    : `SELECT id, display_name FROM accounts WHERE platform = 'twitch' AND login = ?`,
  args: [isNumeric ? Number(source) : source],
});
const account = found.rows[0];
if (!account) {
  console.error(`紐付け元が見つかりません: ${source}`);
  process.exit(1);
}

// ② 入力からチャンネルを特定する。3つの形を受け付ける
//    - UCxxxx                        … チャンネルIDそのもの
//    - .../channel/UCxxxx            … 昔からのURL
//    - .../@handle                   … 今のYouTubeのURL（要API問い合わせ）
let query;
const channelMatch = target.match(/(UC[\w-]{20,})/);
const handleMatch = target.match(/@([\w.\-]+)/);

if (channelMatch) {
  query = `id=${channelMatch[1]}`;
} else if (handleMatch) {
  // ハンドル(@xxx)からチャンネルIDを引く。forHandle は1ユニットで済む
  query = `forHandle=%40${handleMatch[1]}`;
} else {
  console.error(`チャンネルIDもハンドルも読み取れません: ${target}`);
  process.exit(1);
}

// ③ チャンネルの正式名を取りに行く（表示名をDBに入れるため）
const res = await fetch(
  `https://www.googleapis.com/youtube/v3/channels?part=snippet&${query}&key=${apiKey}`,
);
const json = await res.json();
if (json.error) {
  console.error(`YouTube APIエラー: ${json.error.message}`);
  process.exit(1);
}
const channel = json.items?.[0];
if (!channel) {
  console.error("そのチャンネルは見つかりませんでした。");
  process.exit(1);
}

// ④ 紐付ける（共通部品に任せる）
const { creatorId, created } = await linkAccount(db, {
  sourceAccountId: Number(account.id),
  sourceName: account.display_name,
  platform: "youtube",
  platformId: channel.id,
  title: channel.snippet.title,
  relation,
});

if (created)
  console.log(`creator作成: ${account.display_name} (creator_id=${creatorId})`);
console.log(
  `紐付け[${relation}]: ${account.display_name} ← ${channel.snippet.title}`,
);
console.log(`  https://www.youtube.com/channel/${channel.id}`);

await printSummary(db);
