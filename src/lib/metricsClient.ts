// src/lib/metricsClient.ts
import type { LocalModuleId } from "./metrics"; // ← metrics.ts 側で export しておいてください
import { recordAttempt as recordAttemptLocal } from "./metrics";
import {
  startSession as startSessionSrv,
  endSession as endSessionSrv,
  logEvent,
  saveProgress as saveProgressSrv,
  loadProgress as loadProgressSrv,
  getItemStatsByDir,
  getItemStats,
} from "./supaMetrics";

/** サーバー（Supabase）側のメニューID = snake_case */
export type MenuId =
  | "news_vocab"
  | "futsuken"
  | "nominalisation"
  | "verb_gym"
  | "freewrite";

/** ローカル（metrics.ts）側のモジュールID = kebab-case */
export type KebabId = LocalModuleId; // "news-vocab" | "nominalisation" | "verb-gym" | "freewrite" | "futsuken"

/** snake → kebab のマッピング（片方向） */
const SNAKE_TO_KEBAB: Record<MenuId, KebabId> = {
  news_vocab: "news-vocab",
  futsuken: "futsuken",
  nominalisation: "nominalisation",
  verb_gym: "verb-gym",
  freewrite: "freewrite",
};

/** kebab → snake のマッピング（必要なら） */
const KEBAB_TO_SNAKE: Record<KebabId, MenuId> = {
  "news-vocab": "news_vocab",
  futsuken: "futsuken",
  nominalisation: "nominalisation",
  "verb-gym": "verb_gym",
  freewrite: "freewrite",
};

/* =========================================================
 * 1) セッション時間（そのままサーバーAPIに委譲）
 * =======================================================*/
export function startSession() {
  return startSessionSrv();
}

export function endSession(menu: MenuId, sessionStartMs: number | null) {
  return endSessionSrv(menu, sessionStartMs);
}

/* =========================================================
 * 2) 正誤イベント（サーバー保存 + 必要ならローカル保存）
 * =======================================================*/
type RecordAttemptArgs = {
  /** サーバー保存用（必須 / snake_case） */
  menuId: MenuId;
  isCorrect: boolean;
  itemId?: number;
  skillTags?: string[]; // サーバー側に積む任意タグ
  meta?: Record<string, unknown>; // サーバー側メタ

  /** ついでのローカル保存（任意 / kebab-case） */
  alsoLocal?: {
    userId: string; // ローカル保存用のキー（未ログインなら "local" 等）
    localModuleId?: KebabId; // 省略時は menuId を kebab に変換
    localSkillTags?: string[]; // ローカル用のタグ
  };
};

/**
 * サーバー → Supabase.learning_events
 * ローカル → metrics.ts の localStorage
 */
export async function recordAttempt(args: RecordAttemptArgs): Promise<void> {
  // 1) サーバー保存
  await logEvent({
    menu: args.menuId,
    itemId: args.itemId ?? null,
    isCorrect: args.isCorrect,
    skillTags: args.skillTags ?? [],
    meta: args.meta ?? {},
  });

  // 2) ローカル保存（任意）
  if (args.alsoLocal) {
    const moduleId: KebabId =
      args.alsoLocal.localModuleId ?? SNAKE_TO_KEBAB[args.menuId];

    recordAttemptLocal({
      userId: args.alsoLocal.userId,
      moduleId, // ← kebab-case
      correct: args.isCorrect,
      skillTags: args.alsoLocal.localSkillTags ?? [],
      meta: args.itemId != null ? { itemId: args.itemId } : undefined,
    });
  }
}

/* =========================================================
 * 3) 進捗保存・復元（サーバー）
 * =======================================================*/
export function saveProgress(args: {
  moduleId: KebabId; // 呼び出し側は kebab でOK
  context: Record<string, unknown>;
  lastItemId: number;
}) {
  const menu = KEBAB_TO_SNAKE[args.moduleId];
  return saveProgressSrv({
    menu,
    context: args.context,
    lastItemId: args.lastItemId,
  });
}

export function loadProgress(
  moduleId: KebabId,
  context: Record<string, unknown>
) {
  const menu = KEBAB_TO_SNAKE[moduleId];
  return loadProgressSrv(menu, context);
}

/* =========================================================
 * 4) 表示用の集計（サーバーのRPCを薄くラップ）
 * =======================================================*/

/** 方向つき（JA2FR/FR2JA）のアイテム別カウント */
export function getCountsForItemsByDir(
  moduleId: KebabId,
  itemIds: number[],
  dir: "JA2FR" | "FR2JA"
) {
  const menu = KEBAB_TO_SNAKE[moduleId];
  return getItemStatsByDir(menu, itemIds, dir);
}

/** 方向なしのアイテム別カウント */
export function getCountsForItems(moduleId: KebabId, itemIds: number[]) {
  const menu = KEBAB_TO_SNAKE[moduleId];
  return getItemStats(menu, itemIds);
}
