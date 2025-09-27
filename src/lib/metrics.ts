// src/lib/metrics.ts
// v2: snake_case の menuId を採用（supaMetrics に合わせる）

export type LocalModuleId =
  | "news-vocab"
  | "nominalisation"
  | "verb-gym"
  | "freewrite"
  | "futsuken";

export type Attempt = {
  id: string;
  userId: string;
  moduleId: LocalModuleId; // ← ここも LocalModuleId に
  skillTags: string[];
  correct: boolean;
  ts: number;
  meta?: {
    itemId?: number;
    [key: string]: unknown;
  };
};
export const MODULE_IDS: LocalModuleId[] = [
  "news-vocab",
  "nominalisation",
  "verb-gym",
  "freewrite",
  "futsuken",
];
const VERSION = "v2";
const KEY = (userId: string) => `lingua_metrics_${VERSION}:${userId}`;

function safeParse<T>(raw: string | null): T[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

function load(userId: string): Attempt[] {
  return safeParse<Attempt>(localStorage.getItem(KEY(userId)));
}

function save(userId: string, data: Attempt[]) {
  localStorage.setItem(KEY(userId), JSON.stringify(data));
}

export function recordAttempt(args: Omit<Attempt, "id" | "ts">) {
  const ts = Date.now();
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${ts}-${Math.random().toString(36).slice(2)}`;
  const arr = load(args.userId);
  arr.push({ id, ts, ...args });
  save(args.userId, arr);
}

export function getAllAttempts(userId: string): Attempt[] {
  return load(userId);
}

export function clearUserData(userId: string) {
  localStorage.removeItem(KEY(userId));
}

type ModuleStat = { total: number; correct: number };

function zeroModuleStats(): Record<LocalModuleId, ModuleStat> {
  return MODULE_IDS.reduce((acc, m) => {
    acc[m] = { total: 0, correct: 0 };
    return acc;
  }, {} as Record<LocalModuleId, ModuleStat>);
}

export function getModuleStats(
  userId: string
): Record<LocalModuleId, ModuleStat> {
  const rows = load(userId);
  const by = zeroModuleStats();
  for (const a of rows) {
    by[a.moduleId].total++;
    if (a.correct) by[a.moduleId].correct++;
  }
  return by;
}

export function getSkillStats(userId: string) {
  const rows = load(userId);
  const by: Record<string, { total: number; correct: number }> = {};
  for (const a of rows) {
    for (const tag of a.skillTags) {
      by[tag] ??= { total: 0, correct: 0 };
      by[tag].total++;
      if (a.correct) by[tag].correct++;
    }
  }
  return by;
}

export function getReport(userId: string) {
  const mod = getModuleStats(userId);
  const skill = getSkillStats(userId);

  const detail = Object.entries(skill).map(([tag, v]) => ({
    tag,
    total: v.total,
    acc: v.total ? Math.round((v.correct / v.total) * 100) : 0,
  }));

  const minN = 3;
  const weak = detail
    .filter((d) => d.total >= minN)
    .sort((a, b) => a.acc - b.acc)
    .slice(0, 5);

  const strong = detail
    .filter((d) => d.total >= minN)
    .sort((a, b) => b.acc - a.acc)
    .slice(0, 5);

  return { mod, weak, strong, totalAttempts: load(userId).length };
}

// 便利タグ定義（任意）
export const Skill = {
  VocabNews: "vocab:news",
  Topic: (id: number | string) => `topic:${id}`,
  Dir: (d: "JA2FR" | "FR2JA") => `dir:${d}`,
} as const;
