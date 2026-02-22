// src/pages/Report.tsx
import { useEffect, useMemo, useState, useRef } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { getDailyStudySeconds } from "../lib/supaMetrics";
import {
  isLocalTopicId,
  loadLocalPairs,
  makeLocalPairId,
  LOCAL_PAIR_BLOCK,
  listLocalTopics,
} from "../lib/localNewsSets";

/* ========== 型 ========== */

// ①②④ 単語/問題ビュー（例: v_user_vocab_stats_14d 相当の形）
type VocabStat = {
  user_id: string;
  word?: string | null;
  lemma?: string | null;
  attempts: number;
  corrects: number;
  wrongs: number;
  accuracy_percent: number;
};

// ⑤ supaMetrics.getDailyStudySeconds() の返り値
type StudyBucket = {
  day: string; // 'YYYY-MM-DD'
  sec: number;
};

// 汎用Agg
type Agg = { attempts: number; corrects: number; wrongs: number };

type DrillDir = "JA2FR" | "FR2JA";

/* ========== ①（既存）時事単語の統計 ========== */

async function fetchNewsVocabStats(uid: string): Promise<VocabStat[]> {
  const SINCE_DAYS = 14;
  const sinceISO = new Date(
    Date.now() - SINCE_DAYS * 86400 * 1000
  ).toISOString();

  type AttemptRow = {
    item_id: number | null;
    is_correct: boolean;
    meta?: { dir?: DrillDir } | null;
    skill_tags?: string[] | null;
  };
  let rowsAttempt: AttemptRow[] = [];

  const tryWithCreated = await supabase
    .from("attempts")
    .select("item_id,is_correct,created_at,menu_id,meta,skill_tags")
    .eq("user_id", uid)
    .in("menu_id", ["news_vocab", "news-vocab"])
    .not("item_id", "is", null)
    .gte("created_at", sinceISO);

  if (!tryWithCreated.error && tryWithCreated.data) {
    rowsAttempt = tryWithCreated.data as AttemptRow[];
  } else {
    const fallback = await supabase
      .from("attempts")
      .select("item_id,is_correct,menu_id,meta,skill_tags")
      .eq("user_id", uid)
      .in("menu_id", ["news_vocab", "news-vocab"])
      .not("item_id", "is", null);
    rowsAttempt = (fallback.data as AttemptRow[]) ?? [];
  }

  const rows = rowsAttempt;
  if (!rows || rows.length === 0) return [];

  const resolveDir = (row: AttemptRow): DrillDir => {
    const metaDir = row.meta?.dir;
    if (metaDir === "FR2JA") return "FR2JA";
    if (metaDir === "JA2FR") return "JA2FR";
    const tagDir = row.skill_tags?.find((tag) => tag.startsWith("dir:"));
    if (tagDir === "dir:FR2JA") return "FR2JA";
    if (tagDir === "dir:JA2FR") return "JA2FR";
    return "JA2FR";
  };

  const resolveTopicId = (row: AttemptRow): number | null => {
    const tag = row.skill_tags?.find((t) => t.startsWith("topic:"));
    if (!tag) return null;
    const raw = Number(tag.slice("topic:".length));
    return Number.isFinite(raw) ? raw : null;
  };

  const aggMap = new Map<
    string,
    {
      itemId: number;
      dir: DrillDir;
      attempts: number;
      corrects: number;
      wrongs: number;
    }
  >();
  const itemIds = new Set<number>();
  for (const r of rows) {
    if (r.item_id == null) continue;
    const topicId = resolveTopicId(r);
    let itemId = Number(r.item_id);
    if (Number.isNaN(itemId)) continue;
    if (
      topicId != null &&
      Number.isFinite(topicId) &&
      isLocalTopicId(topicId) &&
      itemId > -LOCAL_PAIR_BLOCK
    ) {
      const legacyIdx = Math.max(0, itemId - 1);
      itemId = makeLocalPairId(topicId, legacyIdx);
    }
    const dir = resolveDir(r);
    const key = `${itemId}:${dir}`;
    const cur = aggMap.get(key) ?? {
      itemId,
      dir,
      attempts: 0,
      corrects: 0,
      wrongs: 0,
    };
    cur.attempts += 1;
    if (r.is_correct) cur.corrects += 1;
    else cur.wrongs += 1;
    aggMap.set(key, cur);
    itemIds.add(itemId);
  }
  const itemIdList = [...itemIds];
  if (itemIdList.length === 0) return [];

  // ラベル解決（ローカルニュースセットから）
  const labelMap = new Map<
    number,
    { ja?: string | null; fr?: string | null }
  >();
  const unresolved = new Set(itemIdList);
  const locals = listLocalTopics();
  for (const t of locals) {
    if (!isLocalTopicId(t.id)) continue;
    const pairs = await loadLocalPairs(t.id);
    for (const p of pairs) {
      if (unresolved.has(p.id)) {
        labelMap.set(p.id, { ja: p.ja, fr: p.fr });
        unresolved.delete(p.id);
      }
    }
    if (unresolved.size === 0) break;
  }

  // ローカルで解決できなかった ID は Supabase の vocab_pairs から取得
  if (unresolved.size > 0) {
    const unresolvedIds = [...unresolved];
    const chunkSize = 100;
    for (let idx = 0; idx < unresolvedIds.length; idx += chunkSize) {
      const chunk = unresolvedIds.slice(idx, idx + chunkSize);
      const { data, error } = await supabase
        .from("vocab_pairs")
        .select("id, ja, fr")
        .in("id", chunk);
      if (error || !data) continue;
      for (const row of data as {
        id: number;
        ja: string | null;
        fr: string | null;
      }[]) {
        labelMap.set(row.id, { ja: row.ja, fr: row.fr });
        unresolved.delete(row.id);
      }
      if (unresolved.size === 0) break;
    }
  }

  const makeWord = (
    entry: { itemId: number; dir: DrillDir },
    label?: { ja?: string | null; fr?: string | null }
  ) => {
    const ja = label?.ja?.trim();
    const fr = label?.fr?.trim();
    if (entry.dir === "FR2JA") {
      if (fr && ja) return `${fr} — ${ja}`;
      if (fr) return fr;
      if (ja) return ja;
    } else {
      if (ja && fr) return `${ja} — ${fr}`;
      if (ja) return ja;
      if (fr) return fr;
    }
    return null;
  };

  const stats: VocabStat[] = [...aggMap.values()].map((entry) => {
    const acc = entry.attempts
      ? Math.round((entry.corrects / entry.attempts) * 100)
      : 0;
    const label = labelMap.get(entry.itemId);
    return {
      user_id: uid,
      word: makeWord(entry, label),
      lemma: entry.dir === "FR2JA" ? "仏→日" : "日→仏",
      attempts: entry.attempts,
      corrects: entry.corrects,
      wrongs: entry.wrongs,
      accuracy_percent: acc,
    };
  });

  return stats.sort((x, y) =>
    x.accuracy_percent !== y.accuracy_percent
      ? x.accuracy_percent - y.accuracy_percent
      : (y.attempts ?? 0) - (x.attempts ?? 0)
  );
}

/* ========== 共通：attempts から任意メニューの集計 ========== */

async function fetchAggFromAttempts(
  uid: string,
  menuIds: string[]
): Promise<Map<number, Agg>> {
  type Row = { item_id: number | null; is_correct: boolean };
  const { data, error } = await supabase
    .from("attempts")
    .select("item_id,is_correct,menu_id")
    .eq("user_id", uid)
    .in("menu_id", menuIds)
    .not("item_id", "is", null);

  if (error || !data) return new Map();

  const agg = new Map<number, Agg>();
  (data as Row[]).forEach((r) => {
    if (r.item_id == null) return;
    const cur = agg.get(r.item_id) ?? { attempts: 0, corrects: 0, wrongs: 0 };
    cur.attempts += 1;
    if (r.is_correct) cur.corrects += 1;
    else cur.wrongs += 1;
    agg.set(r.item_id, cur);
  });
  return agg;
}

/* ========== ② 名詞化ローダ（既存） ========== */

async function loadNominalisationPart(n: number) {
  try {
    const url = new URL(
      `../data/nominalisations/nominalisations_part${n}.tsv`,
      import.meta.url
    ).toString();

    const text = await fetch(url).then((r) => {
      if (!r.ok) throw new Error(`TSV load failed: part${n}`);
      return r.text();
    });

    const lines = text.trim().split(/\r?\n/);
    if (lines.length === 0) return [];

    const firstLine = lines[0].replace(/^\uFEFF/, "");
    const header = firstLine.split("\t").map((h) => h.trim());

    const idxOf = (names: string[]) =>
      header.findIndex((h) =>
        names.some((nm) => h.toLowerCase() === nm.toLowerCase())
      );

    const iId = idxOf(["id", "item_id"]);
    const iBase = idxOf(["source", "元の単語（品詞）", "base", "原語"]);
    const iNom = idxOf(["nominal", "名詞化形", "名詞化", "noun"]);
    const iJa = idxOf(["ja", "日本語訳", "jp"]);

    const hasHeader = iBase !== -1 && iNom !== -1;
    const body = hasHeader ? lines.slice(1) : lines;

    const pairs: Array<{
      id: number;
      base: string;
      nominal: string;
      ja?: string;
    }> = [];

    body.forEach((row, lineIdx) => {
      const cols = row.split("\t");

      let base: string | undefined;
      let nominal: string | undefined;
      let ja: string | undefined;

      if (hasHeader) {
        base = cols[iBase]?.trim();
        nominal = cols[iNom]?.trim();
        ja = iJa !== -1 ? cols[iJa]?.trim() : undefined;
      } else {
        base = cols[0]?.trim();
        nominal = cols[1]?.trim();
        ja = cols[2]?.trim();
      }

      if (!base || !nominal) return;

      base = base.replace(/\*\*/g, "").replace(/\*/g, "").trim();

      let id: number;
      if (hasHeader) {
        const rawId = iId !== -1 ? cols[iId]?.trim() : undefined;
        const parsed = rawId ? Number(rawId) : NaN;
        id = Number.isFinite(parsed) ? parsed : n * 1_000_000 + lineIdx;
      } else {
        id = n * 1_000_000 + lineIdx;
      }
      pairs.push({ id, base, nominal, ja });
    });

    return pairs;
  } catch (e) {
    console.warn(`[loadNominalisationPart] part${n} failed:`, e);
    return [];
  }
}

async function resolveNominalisationLabels(
  ids: number[]
): Promise<Map<number, string>> {
  const m = new Map<number, string>();
  const allPairs: Array<{
    id: number;
    base: string;
    nominal: string;
    ja?: string;
  }> = [];

  for (let partNum = 1; partNum <= 7; partNum++) {
    const pairs = await loadNominalisationPart(partNum);
    allPairs.push(...pairs);
  }

  for (const p of allPairs) {
    if (ids.includes(p.id)) {
      m.set(p.id, `${p.base} → ${p.nominal}`);
    }
  }
  for (const id of ids) {
    if (!m.has(id)) m.set(id, `#${id}`);
  }
  return m;
}

/* ========== ③ 動詞（Verbe）ローダ & 集計 ========== */

type VerbeCategory = "normal" | "refl";
const VERBE_PARTS: Record<VerbeCategory, number[]> = {
  normal: [1, 2, 3, 4, 5],
  refl: [1, 2],
};

// 安定ID（Verbe.tsx と同一設計）
function verbeStableId(cat: VerbeCategory, part: number, lineIdx: number) {
  const catCode = cat === "normal" ? 1 : 2;
  return catCode * 1_000_000 + part * 10_000 + (lineIdx + 1);
}

function parseVerbeTsv(text: string): Array<{ fr: string; ja: string }> {
  const lines = text
    .replace(/^\uFEFF/, "")
    .trim()
    .split(/\r?\n/);
  if (!lines.length) return [];
  const head = lines[0].split("\t").map((h) => h.trim().toLowerCase());
  const hasHeader =
    ["fr", "français", "フランス語"].some((k) => head.includes(k)) &&
    ["ja", "japonais", "日本語"].some((k) => head.includes(k));
  const body = hasHeader ? lines.slice(1) : lines;

  const iFR = hasHeader
    ? head.findIndex((h) => ["fr", "français", "フランス語"].includes(h))
    : 0;
  const iJA = hasHeader
    ? head.findIndex((h) => ["ja", "japonais", "日本語"].includes(h))
    : 1;

  const out: Array<{ fr: string; ja: string }> = [];
  body.forEach((row) => {
    const cols = row.split("\t");
    const fr = (cols[iFR] ?? "").trim();
    const ja = (cols[iJA] ?? "").trim();
    if (fr && ja) out.push({ fr, ja });
  });
  return out;
}

async function loadVerbePart(cat: VerbeCategory, part: number) {
  const fname =
    cat === "normal"
      ? `verbesNormalesList-${part}.tsv`
      : `verbesProminauxList-${part}.tsv`; // Verbe.tsx と同じ綴り
  const url = new URL(`../data/verbe/${fname}`, import.meta.url).toString();
  try {
    const t = await fetch(url).then((r) => {
      if (!r.ok) throw new Error(`TSV load failed: ${fname}`);
      return r.text();
    });
    return parseVerbeTsv(t).map((p, idx) => ({
      id: verbeStableId(cat, part, idx),
      ja: p.ja,
      fr: p.fr,
    }));
  } catch {
    return [];
  }
}

type VerbeLabel = { jaFr: string; frJa: string };

async function resolveVerbeLabels(
  ids: number[]
): Promise<Map<number, VerbeLabel>> {
  const need = new Set(ids);
  const m = new Map<number, VerbeLabel>();
  for (const cat of ["normal", "refl"] as VerbeCategory[]) {
    for (const part of VERBE_PARTS[cat]) {
      const pairs = await loadVerbePart(cat, part);
      for (const p of pairs) {
        if (need.has(p.id)) {
          m.set(p.id, {
            jaFr: `${p.ja} — ${p.fr}`,
            frJa: `${p.fr} — ${p.ja}`,
          });
          need.delete(p.id);
        }
      }
      if (need.size === 0) return m;
    }
  }
  for (const id of need) m.set(id, { jaFr: `#${id}`, frJa: `#${id}` });
  return m;
}

async function fetchVerbeStats(uid: string): Promise<VocabStat[]> {
  type AttemptRow = {
    item_id: number | string | null;
    is_correct: boolean;
    meta?: { dir?: DrillDir };
  };
  const { data, error } = await supabase
    .from("attempts")
    .select("item_id,is_correct,meta")
    .eq("user_id", uid)
    .eq("menu_id", "verbe")
    .not("item_id", "is", null);
  if (error || !data) return [];

  const agg = new Map<
    string,
    {
      itemId: number;
      dir: DrillDir;
      attempts: number;
      corrects: number;
      wrongs: number;
    }
  >();
  const itemIds = new Set<number>();

  (data as AttemptRow[]).forEach((row) => {
    if (row.item_id == null) return;
    const numericId = Number(row.item_id);
    if (Number.isNaN(numericId)) return;
    const dir =
      (row.meta as { dir?: DrillDir } | null)?.dir === "FR2JA"
        ? "FR2JA"
        : "JA2FR";
    const key = `${numericId}:${dir}`;
    const cur = agg.get(key) ?? {
      itemId: numericId,
      dir,
      attempts: 0,
      corrects: 0,
      wrongs: 0,
    };
    cur.attempts += 1;
    if (row.is_correct) cur.corrects += 1;
    else cur.wrongs += 1;
    agg.set(key, cur);
    itemIds.add(numericId);
  });

  if (agg.size === 0) return [];

  const labels = await resolveVerbeLabels([...itemIds]);

  const rows: VocabStat[] = [...agg.values()].map((entry) => {
    const label = labels.get(entry.itemId);
    const word =
      entry.dir === "FR2JA"
        ? label?.frJa ?? `#${entry.itemId}`
        : label?.jaFr ?? `#${entry.itemId}`;
    const acc = entry.attempts
      ? Math.round((entry.corrects / entry.attempts) * 100)
      : 0;
    return {
      user_id: uid,
      word,
      lemma: entry.dir === "FR2JA" ? "仏→日" : "日→仏",
      attempts: entry.attempts,
      corrects: entry.corrects,
      wrongs: entry.wrongs,
      accuracy_percent: acc,
    };
  });

  return rows.sort((x, y) =>
    x.accuracy_percent !== y.accuracy_percent
      ? x.accuracy_percent - y.accuracy_percent
      : (y.attempts ?? 0) - (x.attempts ?? 0)
  );
}

/* ========== ④ 仏作文（Composition）ローダ & 集計 ========== */

type CompPair = { id: number; ja: string; fr: string };

function parseCompositionTsv(text: string): CompPair[] {
  const lines = text
    .replace(/^\uFEFF/, "")
    .trim()
    .split(/\r?\n/);
  if (!lines.length) return [];
  const head = lines[0].split("\t").map((h) => h.trim().toLowerCase());
  const hasHeader =
    ["fr", "français", "フランス語"].some((k) => head.includes(k)) &&
    ["ja", "japonais", "日本語"].some((k) => head.includes(k));
  const body = hasHeader ? lines.slice(1) : lines;

  const iFR = hasHeader
    ? head.findIndex((h) => ["fr", "français", "フランス語"].includes(h))
    : 1;
  const iJA = hasHeader
    ? head.findIndex((h) => ["ja", "japonais", "日本語"].includes(h))
    : 0;

  const out: CompPair[] = [];
  body.forEach((row, idx) => {
    const cols = row.split("\t");
    const fr = (cols[iFR] ?? "").trim();
    const ja = (cols[iJA] ?? "").trim();
    if (!fr || !ja) return;

    // ★ attempts 側と同じ桁（1000000台）で安定IDを付与
    const id = 1_000_000 + (idx + 1);
    out.push({ id, ja, fr });
  });
  return out;
}

async function loadCompositionPairs(): Promise<CompPair[]> {
  try {
    const url = new URL(
      `../data/Composition/compositionList.tsv`,
      import.meta.url
    ).toString();
    const text = await fetch(url).then((r) => {
      if (!r.ok) throw new Error("TSV load failed: compositionList.tsv");
      return r.text();
    });
    return parseCompositionTsv(text);
  } catch {
    return [];
  }
}

async function resolveCompositionLabels(
  ids: number[]
): Promise<Map<number, string>> {
  const m = new Map<number, string>();
  const pairs = await loadCompositionPairs();
  const need = new Set(ids);

  // ★ 両方式のIDをどちらも解決：
  //   - 1-based:            1, 2, ...
  //   - 1000000 + 1-based:  1000001, 1000002, ...
  pairs.forEach((p, idx) => {
    const id1 = idx + 1; // 1始まり
    const id2 = 1_000_000 + (idx + 1); // 1000001始まり
    const labelJaOnly = p.ja; // ★ 日本語のみ表示

    if (need.has(id1)) {
      m.set(id1, labelJaOnly);
      need.delete(id1);
    }
    if (need.has(id2)) {
      m.set(id2, labelJaOnly);
      need.delete(id2);
    }
  });

  // 未解決は #id のまま（データ外）
  for (const id of need) m.set(id, `#${id}`);
  return m;
}

async function fetchCompositionStats(uid: string): Promise<VocabStat[]> {
  // attempts から composition の集計
  const agg = await fetchAggFromAttempts(uid, ["composition"]);
  if (agg.size === 0) return [];

  const ids = [...agg.keys()];
  const labels = await resolveCompositionLabels(ids);

  const rows: VocabStat[] = ids.map((id) => {
    const a = agg.get(id)!;
    const acc = a.attempts ? Math.round((a.corrects / a.attempts) * 100) : 0;
    return {
      user_id: uid,
      word: labels.get(id) ?? `#${id}`,
      lemma: null,
      attempts: a.attempts,
      corrects: a.corrects,
      wrongs: a.wrongs,
      accuracy_percent: acc,
    };
  });

  // 「間違えた Best」らしく、wrongs 降順 → attempts 降順 → acc 昇順
  return rows.sort(
    (a, b) =>
      (b.wrongs ?? 0) - (a.wrongs ?? 0) ||
      (b.attempts ?? 0) - (a.attempts ?? 0) ||
      a.accuracy_percent - b.accuracy_percent
  );
}

/* ========== Report 本体 ========== */
export default function Report() {
  const [loading, setLoading] = useState(true);

  // ルートDOM参照（HTML保存で使用）
  const rootRef = useRef<HTMLDivElement | null>(null);

  // ① 時事単語
  const [vocabStats, setVocabStats] = useState<VocabStat[]>([]);
  // ③ 動詞
  const [verbeStats, setVerbeStats] = useState<VocabStat[]>([]);
  // ② 名詞化
  const [nominoStats, setNominoStats] = useState<VocabStat[]>([]);
  // ④ 仏作文
  const [compStats, setCompStats] = useState<VocabStat[]>([]);
  // ⑤ 学習時間（全体）
  const [studyBuckets, setStudyBuckets] = useState<StudyBucket[]>([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth.user?.id;
        if (!uid) {
          setVocabStats([]);
          setVerbeStats([]);
          setNominoStats([]);
          setCompStats([]);
          setStudyBuckets([]);
          return;
        }

        // ① 時事単語
        const vs = await fetchNewsVocabStats(uid);
        setVocabStats(vs);

        // ② 名詞化ジム
        {
          const agg = await fetchAggFromAttempts(uid, ["nominalisation"]);
          const ids = [...agg.keys()];
          const labels = await resolveNominalisationLabels(ids);
          const rows: VocabStat[] = ids
            .map((id) => {
              const a = agg.get(id)!;
              const acc = a.attempts
                ? Math.round((a.corrects / a.attempts) * 100)
                : 0;
              return {
                user_id: uid,
                word: labels.get(id) ?? `#${id}`,
                lemma: null,
                attempts: a.attempts,
                corrects: a.corrects,
                wrongs: a.wrongs,
                accuracy_percent: acc,
              };
            })
            .sort((x, y) =>
              x.accuracy_percent !== y.accuracy_percent
                ? x.accuracy_percent - y.accuracy_percent
                : (y.attempts ?? 0) - (x.attempts ?? 0)
            );
          setNominoStats(rows);
        }

        // ③ 動詞（Verbe）
        const vbs = await fetchVerbeStats(uid);
        setVerbeStats(vbs);

        // ④ 仏作文（Composition）
        const cs = await fetchCompositionStats(uid);
        setCompStats(cs);

        // ⑤ 勉強時間（全体）
        const buckets = await getDailyStudySeconds(14);
        setStudyBuckets(buckets ?? []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  /* ====== ① 集計まとめ（ニュース単語） ====== */
  const vocabTotals = useMemo(() => {
    const attempts = vocabStats.reduce((s, x) => s + (x.attempts ?? 0), 0);
    const corrects = vocabStats.reduce((s, x) => s + (x.corrects ?? 0), 0);
    const wrongs = vocabStats.reduce((s, x) => s + (x.wrongs ?? 0), 0);
    const acc = attempts ? Math.round((corrects / attempts) * 100) : 0;
    return { attempts, corrects, wrongs, acc };
  }, [vocabStats]);

  /* ====== ③ 動詞の集計まとめ ====== */
  const verbeTotals = useMemo(() => {
    const attempts = verbeStats.reduce((s, x) => s + (x.attempts ?? 0), 0);
    const corrects = verbeStats.reduce((s, x) => s + (x.corrects ?? 0), 0);
    const wrongs = verbeStats.reduce((s, x) => s + (x.wrongs ?? 0), 0);
    const acc = attempts ? Math.round((corrects / attempts) * 100) : 0;
    return { attempts, corrects, wrongs, acc };
  }, [verbeStats]);

  /* ====== ④ 仏作文の集計まとめ & Best3 ====== */
  const compTotals = useMemo(() => {
    const attempts = compStats.reduce((s, x) => s + (x.attempts ?? 0), 0);
    const corrects = compStats.reduce((s, x) => s + (x.corrects ?? 0), 0);
    const wrongs = compStats.reduce((s, x) => s + (x.wrongs ?? 0), 0);
    const acc = attempts ? Math.round((corrects / attempts) * 100) : 0;
    return { attempts, corrects, wrongs, acc };
  }, [compStats]);

  const hardestCompositions = useMemo(
    () =>
      compStats
        .filter((x) => (x.attempts ?? 0) >= 1)
        .slice()
        .sort(
          (a, b) =>
            (b.wrongs ?? 0) - (a.wrongs ?? 0) ||
            (b.attempts ?? 0) - (a.attempts ?? 0) ||
            a.accuracy_percent - b.accuracy_percent
        )
        .slice(0, 3),
    [compStats]
  );

  const vocabHasLabel = (x: VocabStat) => Boolean(x.word && x.word.trim());

  /* ====== 苦手な単語/動詞 Best 10（attempts >= 2） ====== */
  const hardestWords = useMemo(
    () =>
      vocabStats
        .filter((x) => (x.attempts ?? 0) >= 2)
        .filter((x) => vocabHasLabel(x))
        .sort((a, b) =>
          a.accuracy_percent !== b.accuracy_percent
            ? a.accuracy_percent - b.accuracy_percent
            : (b.attempts ?? 0) - (a.attempts ?? 0)
        )
        .slice(0, 10),
    [vocabStats]
  );

  const hardestVerbs = useMemo(
    () =>
      verbeStats
        .filter((x) => (x.attempts ?? 0) >= 2)
        .slice()
        .sort((a, b) =>
          a.accuracy_percent !== b.accuracy_percent
            ? a.accuracy_percent - b.accuracy_percent
            : (b.attempts ?? 0) - (a.attempts ?? 0)
        )
        .slice(0, 10),
    [verbeStats]
  );

  /* ====== 全体学習時間（⑤）の集計 ====== */
  const studyTotals = useMemo(() => {
    const totalSec = studyBuckets.reduce((s, d) => s + (d.sec ?? 0), 0);
    const dayCount = Math.max(studyBuckets.length, 14);
    const avgPerDayMin = dayCount ? Math.round(totalSec / 60 / dayCount) : 0;
    const totalHours = Math.floor(totalSec / 3600);
    const remMinutes = Math.round((totalSec % 3600) / 60);
    return { totalSec, totalHours, remMinutes, avgPerDayMin, dayCount };
  }, [studyBuckets]);

  return (
    <div ref={rootRef} className="min-h-svh bg-slate-50">
      {/* ヘッダー */}
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="mx-auto max-w-screen-xl px-4 py-4 flex items-center justify-between">
          <h1 className="text-xl font-bold">📄 学習レポート（直近14日）</h1>
          <div className="flex items-center gap-2">
            <Link
              to="/app/study-time"
              className="rounded-xl border bg-white/90 px-3 py-1.5 text-sm shadow hover:bg-slate-50"
            >
              ⏱ 学習時間ページへ
            </Link>
            <button
              onClick={() => exportReportHTML(rootRef.current)}
              className="rounded-xl border bg-white/90 px-3 py-1.5 text-sm shadow hover:bg-slate-50"
            >
              💾 HTML保存
            </button>
            {/* ホームボタン */}
            <Link
              to="/app"
              className="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-sm font-medium text-rose-600 hover:bg-rose-100 transition-colors"
            >
              🏠 ホーム
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-screen-xl px-4 py-6 space-y-6">
        {/* ① 時事単語（ニュース単語） */}
        <section id="news-vocab" className="glass-card p-4 scroll-mt-24">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">① 時事単語</h2>
          </div>

          {loading ? (
            <p className="text-slate-600 text-sm mt-2">読み込み中…</p>
          ) : vocabTotals.attempts === 0 ? (
            <p className="text-slate-600 text-sm mt-2">
              データがありません。まずは学習を始めましょう。
            </p>
          ) : (
            <div className="mt-3 flex flex-col gap-4">
              <div className="rounded-xl border p-3 bg-white">
                <h3 className="text-sm font-semibold">単語の正答率のまとめ</h3>
                <div className="mt-2 grid sm:grid-cols-2 gap-3">
                  <StatItem
                    label="今まで学習した単語"
                    value={vocabTotals.attempts}
                  />
                  <StatItem label="正答（単語）" value={vocabTotals.corrects} />
                  <StatItem label="誤答（単語）" value={vocabTotals.wrongs} />
                  <StatItem
                    label="正答率（単語）"
                    value={`${vocabTotals.acc}%`}
                  />
                </div>
              </div>

              <div className="rounded-xl border p-3 bg-white">
                <h3 className="text-sm font-semibold">苦手な単語 Best 10</h3>

                {hardestWords.length === 0 ? (
                  <p className="text-slate-600 text-sm mt-2">
                    データがありません。
                  </p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {hardestWords.map((w, i) => {
                      const label =
                        (w.word && w.word.trim()) ||
                        (w.lemma && w.lemma.trim()) ||
                        "（不明な語）";
                      return (
                        <li
                          key={`${label}-${i}`}
                          className="rounded-lg border p-2 bg-white"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-medium">
                              {i + 1}. {label}
                            </div>
                            <div className="text-xs text-slate-600">
                              正答率 {w.accuracy_percent}%（{w.corrects}/
                              {w.attempts}）
                            </div>
                          </div>
                          <ProgressBar
                            percent={safePercent(w.accuracy_percent)}
                          />
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          )}
        </section>

        {/* ② 名詞化ジム */}
        <section id="nominalisation" className="glass-card p-4 scroll-mt-24">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">② 名詞化ジム</h2>
          </div>

          {loading ? (
            <p className="text-slate-600 text-sm mt-2">読み込み中…</p>
          ) : nominoStats.length === 0 ? (
            <p className="text-slate-600 text-sm mt-2">
              データがありません。まずは学習を始めましょう。
            </p>
          ) : (
            <div className="mt-3 flex flex-col gap-4">
              <div className="rounded-xl border p-3 bg-white">
                <h3 className="text-sm font-semibold">単語の正答率のまとめ</h3>
                <div className="mt-2 grid sm:grid-cols-2 gap-3">
                  <StatItem
                    label="今まで学習した問題"
                    value={nominoStats.reduce(
                      (s, x) => s + (x.attempts ?? 0),
                      0
                    )}
                  />
                  <StatItem
                    label="正答（回）"
                    value={nominoStats.reduce(
                      (s, x) => s + (x.corrects ?? 0),
                      0
                    )}
                  />
                  <StatItem
                    label="誤答（回）"
                    value={nominoStats.reduce((s, x) => s + (x.wrongs ?? 0), 0)}
                  />
                  <StatItem
                    label="正答率（全体）"
                    value={`${(() => {
                      const a = nominoStats.reduce(
                        (s, x) => s + (x.attempts ?? 0),
                        0
                      );
                      const c = nominoStats.reduce(
                        (s, x) => s + (x.corrects ?? 0),
                        0
                      );
                      return a ? Math.round((c / a) * 100) : 0;
                    })()}%`}
                  />
                </div>
              </div>

              <div className="rounded-xl border p-3 bg-white">
                <h3 className="text-sm font-semibold">
                  苦手な問題 Best 10（二回以上学習したもの）
                </h3>
                {nominoStats.filter((x) => (x.attempts ?? 0) >= 2).length ===
                0 ? (
                  <p className="text-slate-600 text-sm mt-2">
                    データがありません。
                  </p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {nominoStats
                      .filter((x) => (x.attempts ?? 0) >= 2)
                      .sort((a, b) =>
                        a.accuracy_percent !== b.accuracy_percent
                          ? a.accuracy_percent - b.accuracy_percent
                          : (b.attempts ?? 0) - (a.attempts ?? 0)
                      )
                      .slice(0, 10)
                      .map((w, i) => {
                        const label =
                          (w.word && w.word.trim()) ||
                          (w.lemma && w.lemma.trim()) ||
                          "（不明）";
                        return (
                          <li
                            key={`${label}-${i}`}
                            className="rounded-lg border p-2 bg-white"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-sm font-medium">
                                {i + 1}. {label}
                              </div>
                              <div className="text-xs text-slate-600">
                                正答率 {w.accuracy_percent}%（{w.corrects}/
                                {w.attempts}）
                              </div>
                            </div>
                            <ProgressBar
                              percent={safePercent(w.accuracy_percent)}
                            />
                          </li>
                        );
                      })}
                  </ul>
                )}
              </div>
            </div>
          )}
        </section>

        {/* ③ 動詞（Verbe） */}
        <section id="verbe" className="glass-card p-4 scroll-mt-24">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">③ 動詞（Verbe）</h2>
          </div>

          {loading ? (
            <p className="text-slate-600 text-sm mt-2">読み込み中…</p>
          ) : verbeStats.length === 0 ? (
            <p className="text-slate-600 text-sm mt-2">
              データがありません。まずは学習を始めましょう。
            </p>
          ) : (
            <div className="mt-3 flex flex-col gap-4">
              {/* 正答率のまとめ */}
              <div className="rounded-xl border p-3 bg-white">
                <h3 className="text-sm font-semibold">動詞の正答率のまとめ</h3>
                <div className="mt-2 grid sm:grid-cols-2 gap-3">
                  <StatItem
                    label="今まで学習した動詞"
                    value={verbeTotals.attempts}
                  />
                  <StatItem label="正答（動詞）" value={verbeTotals.corrects} />
                  <StatItem label="誤答（動詞）" value={verbeTotals.wrongs} />
                  <StatItem
                    label="正答率（動詞）"
                    value={`${verbeTotals.acc}%`}
                  />
                </div>
              </div>

              {/* 苦手な動詞 Best 10 */}
              <div className="rounded-xl border p-3 bg-white">
                <h3 className="text-sm font-semibold">
                  苦手な動詞 Best 10（二回以上学習したもの）
                </h3>
                {hardestVerbs.length === 0 ? (
                  <p className="text-slate-600 text-sm mt-2">
                    該当データがありません。
                  </p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {hardestVerbs.map((w, i) => {
                      const label =
                        (w.word && w.word.trim()) ||
                        (w.lemma && w.lemma.trim()) ||
                        "（不明）";
                      return (
                        <li
                          key={`${label}-${i}`}
                          className="rounded-lg border p-2 bg-white"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-medium">
                              {i + 1}. {label}
                            </div>
                            <div className="text-xs text-slate-600">
                              正答率 {w.accuracy_percent}%（{w.corrects}/
                              {w.attempts}）
                            </div>
                          </div>
                          <ProgressBar
                            percent={safePercent(w.accuracy_percent)}
                          />
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          )}
        </section>

        {/* ④ 仏作文（Composition） */}
        <section id="composition" className="glass-card p-4 scroll-mt-24">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">④ 仏作文（Composition）</h2>
          </div>

          {loading ? (
            <p className="text-slate-600 text-sm mt-2">読み込み中…</p>
          ) : compStats.length === 0 ? (
            <p className="text-slate-600 text-sm mt-2">
              データがありません。まずは学習を始めましょう。
            </p>
          ) : (
            <div className="mt-3 flex flex-col gap-4">
              {/* 正答率のまとめ */}
              <div className="rounded-xl border p-3 bg-white">
                <h3 className="text-sm font-semibold">正答率のまとめ</h3>
                <div className="mt-2 grid sm:grid-cols-2 gap-3">
                  <StatItem
                    label="今まで学習した問題"
                    value={compTotals.attempts}
                  />
                  <StatItem label="正答（回）" value={compTotals.corrects} />
                  <StatItem label="誤答（回）" value={compTotals.wrongs} />
                  <StatItem
                    label="正答率（全体）"
                    value={`${compTotals.acc}%`}
                  />
                </div>
              </div>

              {/* 間違えた Best 3 */}
              <div className="rounded-xl border p-3 bg-white">
                <h3 className="text-sm font-semibold">
                  苦手な問題 Best 3（二回以上学習したもの）
                </h3>
                {hardestCompositions.length === 0 ? (
                  <p className="text-slate-600 text-sm mt-2">
                    該当データがありません。
                  </p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {hardestCompositions.map((w, i) => {
                      const label =
                        (w.word && w.word.trim()) ||
                        (w.lemma && w.lemma.trim()) ||
                        "（不明）";
                      return (
                        <li
                          key={`${label}-${i}`}
                          className="rounded-lg border p-2 bg-white"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-medium">
                              {i + 1}. {label}
                            </div>
                            <div className="text-xs text-slate-600">
                              正答率 {w.accuracy_percent}%（{w.corrects}/
                              {w.attempts}）
                            </div>
                          </div>
                          <ProgressBar
                            percent={safePercent(w.accuracy_percent)}
                          />
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          )}
        </section>

        {/* ⑤ 勉強時間（全体） */}
        <section className="glass-card p-4">
          <h2 className="font-semibold">⑤ 勉強時間（直近14日・全体）</h2>
          {loading ? (
            <p className="text-slate-600 text-sm mt-2">読み込み中…</p>
          ) : studyBuckets.length === 0 ? (
            <p className="text-slate-600 text-sm mt-2">
              勉強時間のデータがありません。
            </p>
          ) : (
            <>
              <div className="mt-2 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <StatItem
                  label="合計時間"
                  value={`${studyTotals.totalHours}時間 ${studyTotals.remMinutes}分`}
                />
                <StatItem
                  label="平均（/日）"
                  value={`${studyTotals.avgPerDayMin}分`}
                />
                <StatItem
                  label="対象日数"
                  value={`${studyTotals.dayCount}日`}
                />
                <StatItem label="記録日数" value={`${studyBuckets.length}日`} />
              </div>
              <div className="mt-4 grid md:grid-cols-2 lg:grid-cols-3 gap-2">
                {studyBuckets
                  .slice()
                  .sort((a, b) => a.day.localeCompare(b.day))
                  .map((d) => {
                    const minutes = Math.round(d.sec / 60);
                    return (
                      <div
                        key={d.day}
                        className="rounded-lg border p-2 bg-white text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{d.day}</span>
                          <span>{minutes}分</span>
                        </div>
                        <ProgressBar percent={toPercent(minutes, 180)} />
                      </div>
                    );
                  })}
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}

/* ====== UI 小物 ====== */

function StatItem({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border p-3 bg-white">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function ProgressBar({ percent }: { percent: number }) {
  const p = safePercent(percent);
  return (
    <div className="mt-2 h-2 w-full rounded-full bg-slate-200 overflow-hidden">
      <div
        className="h-full bg-emerald-500"
        style={{ width: `${p}%` }}
        aria-label={`progress ${p}%`}
      />
    </div>
  );
}

/* ====== Utils ====== */

function safePercent(n: number) {
  if (Number.isNaN(n) || !Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** 分 → 基準値を100%とした割合（0-100） */
function toPercent(valueMin: number, baseMin: number) {
  if (baseMin <= 0) return 0;
  return safePercent((valueMin / baseMin) * 100);
}

/**
 * 現在表示中のレポートを独立HTMLとして保存
 * - Tailwind CDNを読み込み（オンライン時は本番に近い見た目）
 * - 簡易フォールバックCSS（.glass-card, body背景）を同梱
 * - 完全オフラインでの本番同等見た目が必要なら、ビルド済みCSSをインラインに差し替えてください
 */
function exportReportHTML(root: HTMLElement | null) {
  if (!root) return;

  const contentHTML = root.outerHTML;

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const fname = `report-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate()
  )}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(
    now.getSeconds()
  )}.html`;

  const htmlDoc = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>学習レポート</title>
  <!-- Tailwind CDN（オンライン時にスタイル適用） -->
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    /* アプリ専用のクラス等がCDNに無い場合のフォールバック */
    .glass-card{background:rgba(255,255,255,0.9);border:1px solid rgba(15,23,42,0.08);border-radius:0.75rem;box-shadow:0 1px 2px rgba(0,0,0,0.06);} 
    body{background:#f8fafc;}
  </style>
</head>
<body>
${contentHTML}
</body>
</html>`;

  const blob = new Blob([htmlDoc], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
