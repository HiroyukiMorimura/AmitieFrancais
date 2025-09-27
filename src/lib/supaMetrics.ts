// supaMetrics.ts
import { supabase } from "./supabase";

/** Supabaseに保存する「メニューID」（snake_case） */
export type MenuId =
  | "news_vocab"
  | "futsuken"
  | "nominalisation"
  | "verb_gym"
  | "freewrite";

export async function getUid() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data?.session?.user?.id ?? null;
}

/* ========== セッション時間 ========== */
export async function startSession() {
  // クライアントで開始時刻(ms)を返すだけ。保存はendSession側
  return Date.now();
}

export async function endSession(menu: MenuId, sessionStartMs: number | null) {
  try {
    const uid = await getUid();
    if (!uid || !sessionStartMs) return;
    const sec = Math.round((Date.now() - sessionStartMs) / 1000);
    await supabase.from("study_sessions").insert({
      user_id: uid,
      menu,
      started_at: new Date(sessionStartMs).toISOString(),
      duration_sec: sec,
    });
  } catch (e) {
    console.warn("[study_sessions] insert failed:", e);
  }
}

/* ========== 学習イベント（正誤） ========== */
export async function logEvent(args: {
  menu: MenuId;
  itemId?: number | null;
  isCorrect: boolean;
  skillTags?: string[];
  meta?: Record<string, unknown>;
}) {
  const uid = await getUid();
  if (!uid) {
    console.warn("[logEvent] no uid (not logged in)");
    return;
  }
  const { error } = await supabase.from("learning_events").insert({
    user_id: uid,
    menu: args.menu,
    item_id: args.itemId ?? null,
    is_correct: args.isCorrect,
    skill_tags: args.skillTags ?? [],
    meta: args.meta ?? {},
  });
  if (error) console.error("[logEvent] insert error:", error);
}

/* ========== どこまでやったか（前回の続き） ========== */
export async function saveProgress(args: {
  menu: MenuId;
  context: Record<string, unknown>; // 例: {topic_id, dir} / Futsuken: {}
  lastItemId: number;
}) {
  const uid = await getUid();
  if (!uid) return;
  await supabase.from("user_progress").upsert(
    {
      user_id: uid,
      menu: args.menu,
      context: args.context,
      last_item_id: args.lastItemId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,menu,context" }
  );
}

// supaMetrics.ts に追加
export async function getItemStatsByDir(
  menu: MenuId,
  itemIds: number[],
  dir: "JA2FR" | "FR2JA"
) {
  const uid = await getUid();
  if (!uid || itemIds.length === 0) {
    return new Map<
      number,
      { correct: number; wrong: number; lastAt: string | null }
    >();
  }
  const { data, error } = await supabase.rpc("rpc_get_item_stats_by_dir", {
    p_menu: menu,
    p_item_ids: itemIds,
    p_dir: dir,
  });
  if (error || !data) return new Map();

  const map = new Map<
    number,
    { correct: number; wrong: number; lastAt: string | null }
  >();
  for (const r of data as {
    item_id: number;
    correct_count: number;
    wrong_count: number;
    last_at: string | null;
  }[]) {
    map.set(r.item_id, {
      correct: r.correct_count,
      wrong: r.wrong_count,
      lastAt: r.last_at,
    });
  }
  return map;
}

// supaMetrics.ts に追加
export async function getItemStats(menu: MenuId, itemIds: number[]) {
  const uid = await getUid();
  if (!uid || itemIds.length === 0)
    return new Map<
      number,
      { correct: number; wrong: number; lastAt: string | null }
    >();
  const { data, error } = await supabase.rpc("rpc_get_item_stats", {
    p_menu: menu,
    p_item_ids: itemIds,
  });
  if (error || !data) return new Map();
  const map = new Map<
    number,
    { correct: number; wrong: number; lastAt: string | null }
  >();
  for (const r of data as {
    item_id: number;
    correct_count: number;
    wrong_count: number;
    last_at: string;
  }[]) {
    map.set(r.item_id, {
      correct: r.correct_count,
      wrong: r.wrong_count,
      lastAt: r.last_at,
    });
  }
  return map;
}

export async function loadProgress(
  menu: MenuId,
  context: Record<string, unknown>
) {
  const uid = await getUid();
  if (!uid) return null;

  // context の部分一致で最新1件（JSONB contains）
  const { data, error } = await supabase
    .from("user_progress")
    .select("last_item_id, context, updated_at")
    .eq("user_id", uid)
    .eq("menu", menu)
    .contains("context", context) // 例: {topic_id: 123}
    .order("updated_at", { ascending: false })
    .limit(1);

  if (error || !data?.length) return null;
  return data[0];
}

/* ========== 表示用の集計 ========== */
export async function getModuleAccuracy(menu: MenuId) {
  const uid = await getUid();
  if (!uid) return { total: 0, correct: 0, acc: 0 };

  const { data, error } = await supabase
    .from("learning_events")
    .select("is_correct")
    .eq("user_id", uid)
    .eq("menu", menu);

  if (error || !data) return { total: 0, correct: 0, acc: 0 };

  const total = data.length;
  const correct = data.filter((r) => r.is_correct).length;
  const acc = total ? Math.round((correct / total) * 100) : 0;
  return { total, correct, acc };
}

export async function getDailyStudySeconds(days = 30) {
  const uid = await getUid();
  if (!uid) return [];
  const since = new Date(Date.now() - days * 86400 * 1000).toISOString();

  const { data, error } = await supabase
    .from("study_sessions")
    .select("started_at, duration_sec")
    .eq("user_id", uid)
    .gte("started_at", since)
    .order("started_at", { ascending: true });

  if (error || !data) return [];

  // 日毎に合算
  const bucket = new Map<string, number>();
  for (const r of data) {
    const day = new Date(r.started_at).toISOString().slice(0, 10);
    bucket.set(day, (bucket.get(day) ?? 0) + r.duration_sec);
  }
  return [...bucket.entries()].map(([day, sec]) => ({ day, sec }));
}
