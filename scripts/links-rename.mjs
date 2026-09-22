// creators の表示名を直す。
// Twitchの表示名をそのまま使っているため、伏字（加藤純一うん〇ちゃん）や
// 「〇〇_チャンネル」のような配信タイトル寄りの名前が入ってしまうことがある。
//
// 使い方: npm run links:rename -- 10 加藤純一
import { createClient } from "@libsql/client";
import { printSummary } from "./link-core.mjs";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const [idPart, ...nameParts] = process.argv.slice(2);
// 名前に空白が入っても拾えるよう、残りの引数を全部つなげる
const newName = nameParts.join(" ");

if (!idPart || !newName) {
  console.error("使い方: npm run links:rename -- <creator_id> <新しい名前>");
  process.exit(1);
}

const creatorId = Number(idPart);
const before = await db.execute({
  sql: `SELECT display_name FROM creators WHERE id = ?`,
  args: [creatorId],
});
if (!before.rows[0]) {
  console.error(`creator_id=${creatorId} は見つかりません`);
  process.exit(1);
}

await db.execute({
  sql: `UPDATE creators SET display_name = ? WHERE id = ?`,
  args: [newName, creatorId],
});

console.log(`改名: ${before.rows[0].display_name} → ${newName}`);
await printSummary(db);
