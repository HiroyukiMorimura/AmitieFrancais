// src/lib/metricsClient.ts

import type { LocalModuleId } from "./metrics";
import { recordAttempt as recordAttemptLocal } from "./metrics";

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
  | "verb_gym"
  | "freewrite";

/** ローカル（metrics.ts）側のモジュールID = kebab-case */
export type KebabId = LocalModuleId; // "news-vocab" | "nominalisation" | "verb-gym" | "freewrite" | "futsuken"

/** UI で使うID（= kebab のエイリアス） */
export type UIModuleId = KebabId;

/** snake → kebab のマッピング（ローカル保存の既定に使用） */
const SNAKE_TO_KEBAB: Record<MenuId, KebabId> = {
  news_vocab: "news-vocab",
  futsuken: "futsuken",
  nominalisation: "nominalisation",
  verb_gym: "verb-gym",
  freewrite: "freewrite",
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
  // 1) サーバー保存（supaMetrics.recordAttempt を使用）
  await recordAttemptSrv({
    menuId: args.menuId, // snake_case
    itemId: args.itemId ?? 0,
    isCorrect: args.isCorrect,
    skillTags: args.skillTags,
    meta: args.meta,
  }); // 2) ローカル保存（任意）

  if (args.alsoLocal) {
    const moduleId: KebabId =
      args.alsoLocal.localModuleId ?? SNAKE_TO_KEBAB[args.menuId];

    recordAttemptLocal({
      userId: args.alsoLocal.userId,
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
export function getCountsForItemsByDir(
  moduleId: KebabId,
  itemIds: number[],
  dir: "JA2FR" | "FR2JA"
) {
  return getItemStatsByDirSrv(moduleId, itemIds, dir);
}

export function getCountsForItems(moduleId: KebabId, itemIds: number[]) {
  // supaMetrics の getCountsForItems は lastAt を含まない形式を返す
  // getItemStats は lastAt を含む形式を返すので、ここでは getCountsForItems を使用
  return getItemStatsSrv(moduleId, itemIds);
}
