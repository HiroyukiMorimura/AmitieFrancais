import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL!;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY!;

// ランタイム検証（不足時は早めに気付く）
if (!url || !anon) {
  throw new Error("Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY");
}

export const supabase = createClient(url, anon, {
  global: {
    headers: {
      apikey: anon, // ← 明示的に送る（通常は不要だがトラブル時の保険）
    },
  },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
