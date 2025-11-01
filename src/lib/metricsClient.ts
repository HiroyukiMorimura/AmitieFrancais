// src/lib/metricsClient.ts

import type { LocalModuleId } from "./metrics";
import { recordAttempt as recordAttemptLocal } from "./metrics";

import {
  startSession as startSessionSrv,
  endSession as endSessionSrv,
  recordAttempt as recordAttemptSrv, // supaMetrics.recordAttempt
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

/** ローカル（metrics.ts）側のモジュールID = kebab-case */
export type KebabId = LocalModuleId; // "news-vocab" | "nominalisation" | "verb-gym" | "freewrite" | "futsuken"

/** UI で使うID（= kebab のエイリアス） */
export type UIModuleId = KebabId;

/** snake → kebab のマッピング（ローカル保存の既定に使用） */
const SNAKE_TO_KEBAB: Record<MenuId, KebabId> = {
  news_vocab: "news-vocab",
  futsuken: "futsuken",
  nominalisation: "nominalisation",
  verbe: "verbe",
  composition: "composition",
};

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
 * 2) 正誤イベント（サーバー保存 + 任意でローカル保存）
 * =======================================================*/
type RecordAttemptArgs = {
  /** サーバー保存用（必須 / snake_case） */ menuId: MenuId;
  isCorrect: boolean;
  itemId?: number;
  skillTags?: string[];
  meta?: Record<
    string,
    unknown
  > /** ついでのローカル保存（任意 / kebab-case） */;

  alsoLocal?: {
    userId: string; // 未ログインなら "local" 等
    localModuleId?: KebabId; // 省略時は snake→kebab 変換
    localSkillTags?: string[];
  };
};

/** サーバー → attempts に記録、必要ならローカルにも鏡写し保存 */
export async function recordAttempt(args: RecordAttemptArgs): Promise<void> {
  // ★★★ 修正点: alsoLocal から uid を取得 ★★★
  const uid = args.alsoLocal?.userId;

  // ★★★ 修正点: uid が "local" や null/undefined の場合はサーバー保存をスキップ ★★★
  if (uid && uid !== "local") {
    // 1) サーバー保存（supaMetrics.recordAttempt を使用）
    await recordAttemptSrv({
      uid: uid, // ★★★ 修正点: uid を supaMetrics に渡す ★★★
      menuId: args.menuId, // snake_case
      itemId: args.itemId ?? 0,
      isCorrect: args.isCorrect,
      skillTags: args.skillTags,
      meta: args.meta,
    });
  } else if (!uid || uid === "local") {
    // ログイン前に押された場合など（ローカル保存のみ行われる）
    console.warn(
      "[recordAttempt] uid is 'local' or missing. Skipping server save."
    );
  }

  // 2) ローカル保存（任意）
  if (args.alsoLocal) {
    const moduleId: KebabId =
      args.alsoLocal.localModuleId ?? SNAKE_TO_KEBAB[args.menuId];

    recordAttemptLocal({
      userId: args.alsoLocal.userId, // ここは "local" でもOK
      moduleId, // kebab-case
      correct: args.isCorrect,
      skillTags: args.alsoLocal.localSkillTags ?? [],
      meta: args.itemId != null ? { itemId: args.itemId } : undefined,
    });
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
