// src/lib/metricsClient.ts

import {
  startSession as startSessionSrv,
  endSession as endSessionSrv,
  recordAttempt as recordAttemptSrv,
  saveProgress as saveProgressSrv,
  loadProgress as loadProgressSrv,
  getItemStatsByDir as getItemStatsByDirSrv,
  getItemStats as getItemStatsSrv,
} from "./supaMetrics";

/** サーバー（attempts に書き込む）側のメニューID = snake_case */
export type MenuId =
  | "news_vocab"
  | "futsuken"
  | "nominalisation"
  | "verbe"
  | "composition";

/** UI で使うID（kebab-case） */
export type UIModuleId =
  | "news-vocab"
  | "nominalisation"
  | "verbe"
  | "composition"
  | "futsuken";

/** kebab-case のエイリアス */
export type KebabId = UIModuleId;

/* =========================================================
 * 1) セッション時間
 * =======================================================*/
export function startSession() {
  return startSessionSrv();
}

export function endSession(menu: MenuId, sessionStartMs: number | null) {
  return endSessionSrv(menu, sessionStartMs);
}

/* =========================================================
 * 2) 正誤イベント（サーバー保存のみ）
 * =======================================================*/
type RecordAttemptArgs = {
  /** サーバー保存用（必須 / snake_case） */
  menuId: MenuId;
  isCorrect: boolean;
  itemId?: number;
  skillTags?: string[];
  meta?: Record<string, unknown>;
  /** ユーザーID（必須） */
  userId: string;
};

/** サーバー → attempts に記録 */
export async function recordAttempt(args: RecordAttemptArgs): Promise<void> {
  const uid = args.userId;

  // ログインしているユーザーのみサーバー保存
  if (uid && uid !== "local") {
    await recordAttemptSrv({
      uid: uid,
      menuId: args.menuId,
      itemId: args.itemId ?? 0,
      isCorrect: args.isCorrect,
      skillTags: args.skillTags,
      meta: args.meta,
    });
  } else {
    console.warn(
      "[recordAttempt] uid is 'local' or missing. Skipping server save."
    );
  }
}

/* =========================================================
 * 3) 進捗保存・復元（kebab のまま渡す）
 * ※ supaMetrics 側で kebab をそのまま user_progress.menu に保存
 * =======================================================*/
export function saveProgress(args: {
  moduleId: KebabId; // kebab でOK
  context: Record<string, unknown>;
  lastItemId: number;
}) {
  return saveProgressSrv({
    moduleId: args.moduleId,
    context: args.context,
    lastItemId: args.lastItemId,
  });
}

export function loadProgress(
  moduleId: KebabId,
  context: Record<string, unknown>
) {
  return loadProgressSrv(moduleId, context);
}

/* =========================================================
 * 4) 表示用の集計（kebab のまま渡せば OK。supaMetrics 側で kebab/snake を吸収）
 * =======================================================*/

type DrillDirUi = "JA2FR" | "FR2JA"; // UI で使う向き

export async function getCountsForItemsByDir(
  moduleId: UIModuleId,
  itemIds: number[],
  dir: DrillDirUi
): Promise<Map<number, { correct: number; wrong: number }>> {
  if (itemIds.length === 0) return new Map();
  // supaMetrics は Map<number, {correct, wrong, lastAt}> を返す前提
  const m = await getItemStatsByDirSrv(moduleId, itemIds, dir);

  // supaMetrics (getItemStatsByDir) は lastAt を含む Map を返す
  // この関数 (getCountsForItemsByDir) は lastAt を含まない Map を期待されている
  const simple = new Map<number, { correct: number; wrong: number }>();
  if (m) {
    for (const [k, v] of m) {
      simple.set(k, { correct: v.correct, wrong: v.wrong });
    }
  }
  return simple;
}

export function getCountsForItems(moduleId: KebabId, itemIds: number[]) {
  // supaMetrics の getItemStats は lastAt を含む
  // (コメントと異なり、supaMetrics に getCountsForItems は無いので getItemStats を呼ぶ)
  return getItemStatsSrv(moduleId, itemIds);
}
