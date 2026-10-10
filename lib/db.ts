import { createClient, type InStatement } from "@libsql/client";

// ============================================
// テーブルに対応する型
// ============================================
export type GameRow = {
  id: string;
  name: string;
  box_art_url: string;
  igdb_id: string | null;
  updated_at: string;
};

export type SnapshotRow = {
  id: number;
  game_id: string;
  viewers: number;
  captured_at: string;
};

/** 大量の書き込みを500件ずつに分けて batch する。
 *  日本語の配信を全部記録するようになり、毎時の書き込みが2,000件を超えた。
 *  1回の batch に詰め込みすぎて Turso の送信サイズの上限に当たるのを避ける */
export async function batchInChunks(
  db: ReturnType<typeof getDbClient>,
  statements: InStatement[],
  size = 500,
) {
  for (let i = 0; i < statements.length; i += size) {
    await db.batch(statements.slice(i, i + size), "write");
  }
}

export function getDbClient() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url || !authToken) {
    throw new Error("Tursoの接続情報が未設定です");
  }

  return createClient({ url, authToken });
}
