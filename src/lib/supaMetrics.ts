// supaMetrics.ts
import { supabase } from "./supabase";

/** attempts に保存する snake_case メニューID */
export type MenuId =
  | "news_vocab"
  | "futsuken"
  | "nominalisation"
  | "verb_gym"
  | "freewrite";

/* ユーザーID取得 */
export async function getUid(): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.warn("[getSession] error:", error);
    return null;
  }
  return data?.session?.user?.id ?? null;
}

/* ========== セッション時間 ========== */
export async function startSession(): Promise<number> {
  return Date.now();
}

export async function endSession(
  menu: MenuId,
  sessionStartMs: number | null
): Promise<void> {
  try {
    const uid = await getUid();
    if (!uid || !sessionStartMs) return;
    const sec = Math.round((Date.now() - sessionStartMs) / 1000);
    const { error } = await supabase.from("study_sessions").insert({
      user_id: uid,
      menu, // snake_case 固定
      started_at: new Date(sessionStartMs).toISOString(),
      duration_sec: sec,
    });
    if (error) console.warn("[study_sessions.insert] error:", error);
  } catch (e) {
    console.warn("[endSession] failed:", e);
  }
}

/* ========== 正誤イベント（attempts に書く） ========== */
export async function recordAttempt(args: {
  menuId: MenuId; // ← snake_case で渡す
  itemId: number;
  isCorrect: boolean;
  skillTags?: string[]; // ※ attempts に無ければ無視（拡張用）
  meta?: Record<string, unknown>; // 同上
  /** 互換用（無視されます） */
  alsoLocal?: unknown;
}): Promise<void> {
  const uid = await getUid();
  if (!uid) {
    console.warn("[recordAttempt] no uid (not logged in)");
    return;
  }
  // attempts の最小カラムのみ確実に投入（余計なカラムは入れない）
  const { error } = await supabase.from("attempts").insert({
    user_id: uid,
    menu_id: args.menuId, // snake
    item_id: args.itemId,
    is_correct: args.isCorrect,
  });
  if (error) console.warn("[attempts.insert] error:", error);
}

/* ========== 進捗の保存/復元（kebab も snake もOKにする） ========== */
export async function saveProgress(args: {
  moduleId: string; // 例: "news-vocab" / "news_vocab" どちらでも
  context: Record<string, unknown>;
  lastItemId: number;
}): Promise<void> {
  const uid = await getUid();
  if (!uid) return;
  const { error } = await supabase.from("user_progress").upsert(
    {
      user_id: uid,
      menu: args.moduleId, // ここは UI 用IDをそのまま保存（画面側と一致させる）
      context: args.context,
      last_item_id: args.lastItemId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,menu,context" }
  );
  if (error) console.warn("[user_progress.upsert] error:", error);
}

export async function loadProgress(
  moduleId: string,
  context: Record<string, unknown>
): Promise<{
  last_item_id: number;
  context: unknown;
  updated_at: string;
} | null> {
  const uid = await getUid();
  if (!uid) return null;

  const { data, error } = await supabase
    .from("user_progress")
    .select("last_item_id, context, updated_at")
    .eq("user_id", uid)
    .eq("menu", moduleId) // 画面が保存したID（kebab/snake どちらでも）
    .contains("context", context)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (error || !data?.length) return null;
  return data[0]!;
}

/* ========== 集計RPC呼び出し（snake/kebab 合算） ========== */

type ItemStatRow = {
  item_id: number;
  correct: number;
  wrong: number;
  last_at?: string | null; // ない想定なので任意
};

type Stat = { correct: number; wrong: number; lastAt: string | null };

function idVariants(id: string): string[] {
  const a = id.replace(/-/g, "_");
  const b = id.replace(/_/g, "-");
  const set = new Set([id, a, b]);
  return [...set];
}

function mergeMap<
  A extends { correct: number; wrong: number; lastAt: string | null }
>(base: Map<number, A>, add: Map<number, A>): Map<number, A> {
  const out = new Map(base);
  for (const [k, v] of add) {
    const cur = out.get(k);
    if (!cur) {
      out.set(k, v);
    } else {
      out.set(k, {
        correct: cur.correct + v.correct,
        wrong: cur.wrong + v.wrong,
        lastAt:
          cur.lastAt && v.lastAt
            ? cur.lastAt > v.lastAt
              ? cur.lastAt
              : v.lastAt
            : cur.lastAt ?? v.lastAt,
      } as A);
    }
  }
  return out;
}

async function callItemStatsOnce(
  menuId: string,
  itemIds: number[]
): Promise<Map<number, Stat>> {
  if (itemIds.length === 0) return new Map();
  try {
    const { data, error } = await supabase.rpc("rpc_get_item_stats", {
      menu_id: menuId,
      item_ids: itemIds,
    });
    if (error || !data) return new Map();
    const m = new Map<number, Stat>();
    (data as ItemStatRow[]).forEach((r) => {
      m.set(r.item_id, {
        correct: r.correct,
        wrong: r.wrong,
        lastAt: r.last_at ?? null,
      });
    });
    return m;
  } catch (e) {
    console.warn("[rpc_get_item_stats] error:", e);
    return new Map();
  }
}
// rpc_get_item_stats_by_dir の戻り
type ItemStatRowByDir = {
  item_id: number;
  correct_count: number;
  wrong_count: number;
  last_at: string | null;
};

async function callItemStatsByDirOnce(
  menuId: string,
  itemIds: number[],
  dir: "JA2FR" | "FR2JA"
): Promise<Map<number, Stat>> {
  if (itemIds.length === 0) return new Map();
  try {
    const { data, error } = await supabase.rpc("rpc_get_item_stats_by_dir", {
      p_menu_id: menuId,
      p_item_ids: itemIds,
      p_dir: dir,
    });
    if (error || !data) return new Map();
    const m = new Map<number, Stat>();
    (data as ItemStatRowByDir[]).forEach((r) =>
      m.set(r.item_id, {
        correct: r.correct_count,
        wrong: r.wrong_count,
        lastAt: r.last_at,
      })
    );
    return m;
  } catch (e) {
    console.warn("[rpc_get_item_stats_by_dir] error:", e);
    return new Map();
  }
}

/** 方向なしの正誤合計を取得（kebab/snake を合算） */
export async function getCountsForItems(
  moduleId: string,
  itemIds: number[]
): Promise<Map<number, { correct: number; wrong: number }>> {
  let acc = new Map<number, Stat>();
  for (const v of idVariants(moduleId)) {
    const part = await callItemStatsOnce(v, itemIds);
    acc = mergeMap(acc, part);
  }
  // lastAt は UI で不要なので落として返す
  const simple = new Map<number, { correct: number; wrong: number }>();
  for (const [k, v] of acc)
    simple.set(k, { correct: v.correct, wrong: v.wrong });
  return simple;
}

/** 方向ありの正誤合計を取得（必要なら） */
export async function getItemStatsByDir(
  moduleId: string,
  itemIds: number[],
  dir: "JA2FR" | "FR2JA"
): Promise<Map<number, Stat>> {
  let acc = new Map<number, Stat>();
  for (const v of idVariants(moduleId)) {
    const part = await callItemStatsByDirOnce(v, itemIds, dir);
    acc = mergeMap(acc, part);
  }
  return acc;
}

/** 方向なし（lastAt も欲しい場合はこちら） */
export async function getItemStats(
  moduleId: string,
  itemIds: number[]
): Promise<Map<number, Stat>> {
  let acc = new Map<number, Stat>();
  for (const v of idVariants(moduleId)) {
    const part = await callItemStatsOnce(v, itemIds);
    acc = mergeMap(acc, part);
  }
  return acc;
}

/* ========== 表示用の軽い集計（attempts から） ========== */
export async function getModuleAccuracy(menu: MenuId): Promise<{
  total: number;
  correct: number;
  acc: number;
}> {
  const uid = await getUid();
  if (!uid) return { total: 0, correct: 0, acc: 0 };

  const { data, error } = await supabase
    .from("attempts")
    .select("is_correct")
    .eq("user_id", uid)
    .eq("menu_id", menu);

  if (error || !data) return { total: 0, correct: 0, acc: 0 };

  const total = data.length;
  const correct = data.filter((r) => r.is_correct).length;
  const acc = total ? Math.round((correct / total) * 100) : 0;
  return { total, correct, acc };
}

export async function getDailyStudySeconds(
  days = 30
): Promise<Array<{ day: string; sec: number }>> {
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

  const bucket = new Map<string, number>();
  for (const r of data) {
    const day = new Date(r.started_at).toISOString().slice(0, 10);
    bucket.set(day, (bucket.get(day) ?? 0) + r.duration_sec);
  }
  return [...bucket.entries()].map(([day, sec]) => ({ day, sec }));
}

export async function getStudyTimeByMenu(): Promise<Record<string, number>> {
  const uid = await getUid();
  if (!uid) return {};

  const { data, error } = await supabase
    .from("study_sessions")
    .select("menu, duration_sec")
    .eq("user_id", uid);

  if (error || !data) return {};

  const byMenu: Record<string, number> = {};
  for (const r of data) {
    byMenu[r.menu] = (byMenu[r.menu] ?? 0) + r.duration_sec;
  }
  return byMenu;
}
