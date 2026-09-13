import { createClient } from "@libsql/client";

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

export function getDbClient() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url || !authToken) {
    throw new Error("Tursoの接続情報が未設定です");
  }

  return createClient({ url, authToken });
}
