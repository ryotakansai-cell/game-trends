// 手元のスクリプト（links:* など）が使う DB の窓口。
// サイトの lib/db.ts と同じく、DB_BACKEND=d1 なら D1（HTTP API）、それ以外は Turso。
// スクリプトは Worker の外で動くので、D1 にはバインディングではなく HTTP API でつなぐ（lib/d1.mjs）
import { createClient } from "@libsql/client";
import { createD1HttpClient } from "../lib/d1.mjs";

export function getScriptDb() {
  if (process.env.DB_BACKEND === "d1") return createD1HttpClient();
  return createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
}
