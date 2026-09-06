import { createClient } from "@supabase/supabase-js";

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

// ============================================
// 読み取り用（RLSが効く。ブラウザでも使える）
// ============================================
export function createReadClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error("Supabaseの接続情報が未設定です");
  }

  return createClient(url, key);
}

// ============================================
// 書き込み用（RLSを無視する。サーバー内でのみ使う）
// ============================================
export function createWriteClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;

  if (!url || !key) {
    throw new Error("SUPABASE_SECRET_KEY が未設定です");
  }

  return createClient(url, key, {
    auth: { persistSession: false },
  });
}
