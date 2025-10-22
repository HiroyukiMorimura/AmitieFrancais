// src/pages/Report.tsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { getDailyStudySeconds } from "../lib/supaMetrics";
import { isLocalTopicId, loadLocalPairs } from "../lib/localNewsSets";
import { listLocalTopics } from "../lib/localNewsSets";

/* ========== 型 ========== */

// ①② 単語ビュー（例: v_user_vocab_stats_14d）
type VocabStat = {
  user_id: string;
  word?: string | null;
  lemma?: string | null;
  attempts: number;
  corrects: number;
  wrongs: number;
  accuracy_percent: number;
};

// ③ supaMetrics.getDailyStudySeconds() の返り値
type StudyBucket = {
  day: string; // 'YYYY-MM-DD'
  sec: number;
};

/* ========== ②の根本修正：単語統計の取得 ========== */

async function fetchNewsVocabStats(uid: string): Promise<VocabStat[]> {
  const SINCE_DAYS = 14;
  const sinceISO = new Date(
    Date.now() - SINCE_DAYS * 86400 * 1000
  ).toISOString();

  // --- 1) attempts から読む（created_at が無い環境にも対応） ---
  type AttemptRow = { item_id: number | null; is_correct: boolean };
  let rowsAttempt: AttemptRow[] = [];

  // まずは created_at 付きで試す
  const tryWithCreated = await supabase
    .from("attempts")
    .select("item_id,is_correct,created_at,menu_id")
    .eq("user_id", uid)
    .in("menu_id", ["news_vocab", "news-vocab"])
    .not("item_id", "is", null)
    .gte("created_at", sinceISO);

  if (!tryWithCreated.error && tryWithCreated.data) {
    rowsAttempt = tryWithCreated.data as AttemptRow[];
  } else {
    // created_at が無い or 列名違い → 期間フィルタ無しで再取得
    const fallback = await supabase
      .from("attempts")
      .select("item_id,is_correct,menu_id")
      .eq("user_id", uid)
      .in("menu_id", ["news_vocab", "news-vocab"])
      .not("item_id", "is", null);
    rowsAttempt = (fallback.data as AttemptRow[]) ?? [];
  }

  const rows = rowsAttempt; // ← legacyを合算しない場合はこちら

  if (!rows || rows.length === 0) return [];

  // --- 2) item_id ごとに集計 ---
  const aggMap = new Map<
    number,
    { attempts: number; corrects: number; wrongs: number }
  >();
  for (const r of rows) {
    if (r.item_id == null) continue;
    const cur = aggMap.get(r.item_id) ?? {
      attempts: 0,
      corrects: 0,
      wrongs: 0,
    };
    cur.attempts += 1;
    if (r.is_correct) cur.corrects += 1;
    else cur.wrongs += 1;
    aggMap.set(r.item_id, cur);
  }
  const itemIds = [...aggMap.keys()];
  if (itemIds.length === 0) return [];

  // --- 3) ラベル解決（まずは remote: vocab_pairs） ---
  const labelMap = new Map<number, string>();
  const unresolved = new Set(itemIds);

  // すべてのローカルトピックを走査
  const locals = listLocalTopics();
  for (const t of locals) {
    if (!isLocalTopicId(t.id)) continue;
    const pairs = await loadLocalPairs(t.id);
    for (const p of pairs) {
      if (unresolved.has(p.id)) {
        labelMap.set(p.id, `${p.ja} — ${p.fr}`);
        unresolved.delete(p.id);
      }
    }
    if (unresolved.size === 0) break;
  }

  // --- 5) VocabStat に整形して、正答率の低い順に返す ---
  const stats: VocabStat[] = itemIds.map((id) => {
    const a = aggMap.get(id)!;
    const acc = a.attempts ? Math.round((a.corrects / a.attempts) * 100) : 0;
    return {
      user_id: uid,
      word: labelMap.get(id) ?? null,
      lemma: null,
      attempts: a.attempts,
      corrects: a.corrects,
      wrongs: a.wrongs,
      accuracy_percent: acc,
    };
  });

  return stats.sort((x, y) => x.accuracy_percent - y.accuracy_percent);
}

// types
type Agg = { attempts: number; corrects: number; wrongs: number };

// attempts から任意の menu_id 群を集計（snake/kebab 両方渡してもOK）
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

// 名詞化ジムのTSVローダー（Report.tsx用）
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

      // **...** を除去
      base = base.replace(/\*\*/g, "").replace(/\*/g, "").trim();

      // IDの生成（Nominalisation.tsxと同じロジック）
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

  // 全7パートを読み込み
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

  // IDをキーにラベルを設定
  for (const p of allPairs) {
    if (ids.includes(p.id)) {
      // 「元の単語 → 名詞化」の形式で表示
      m.set(p.id, `${p.base} → ${p.nominal}`);
    }
  }

  // 見つからなかったIDは#番号で表示
  for (const id of ids) {
    if (!m.has(id)) {
      m.set(id, `#${id}`);
    }
  }

  return m;
}

/* ========== Report 本体 ========== */

export default function Report() {
  const [loading, setLoading] = useState(true);

  // ①②
  const [vocabStats, setVocabStats] = useState<VocabStat[]>([]);
  // ③
  const [studyBuckets, setStudyBuckets] = useState<StudyBucket[]>([]);

  const [nominoStats, setNominoStats] = useState<VocabStat[]>([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth.user?.id;
        if (!uid) {
          setVocabStats([]);
          setNominoStats([]);
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
            .sort((x, y) => x.accuracy_percent - y.accuracy_percent);
          setNominoStats(rows);
        }

        // ③ 勉強時間
        const buckets = await getDailyStudySeconds(14);
        setStudyBuckets(buckets ?? []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  /* ====== ① 単語の正答率のまとめ ====== */
  const vocabTotals = useMemo(() => {
    const attempts = vocabStats.reduce((s, x) => s + (x.attempts ?? 0), 0);
    const corrects = vocabStats.reduce((s, x) => s + (x.corrects ?? 0), 0);
    const wrongs = vocabStats.reduce((s, x) => s + (x.wrongs ?? 0), 0);
    const acc = attempts ? Math.round((corrects / attempts) * 100) : 0;
    return { attempts, corrects, wrongs, acc };
  }, [vocabStats]);

  /* ====== ② 苦手な単語 Best 10（attempts >= 2） ====== */
  const hardestWords = useMemo(
    () =>
      vocabStats
        .filter((x) => (x.attempts ?? 0) >= 2)
        .sort((a, b) => {
          if (a.accuracy_percent !== b.accuracy_percent) {
            return a.accuracy_percent - b.accuracy_percent; // 低い順
          }
          return (b.attempts ?? 0) - (a.attempts ?? 0); // 同率なら試行多い方を先に
        })
        .slice(0, 10),
    [vocabStats]
  );

  const studyTotals = useMemo(() => {
    const totalSec = studyBuckets.reduce((s, d) => s + (d.sec ?? 0), 0);
    const dayCount = Math.max(studyBuckets.length, 14); // 欠損日のための見かけの日数
    const avgPerDayMin = dayCount ? Math.round(totalSec / 60 / dayCount) : 0;
    const totalHours = Math.floor(totalSec / 3600);
    const remMinutes = Math.round((totalSec % 3600) / 60);
    return { totalSec, totalHours, remMinutes, avgPerDayMin, dayCount };
  }, [studyBuckets]);
  return (
    <div className="min-h-svh bg-slate-50">
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
            // ★ 常に縦並び（1カラム）に変更：左右に並べない
            <div className="mt-3 flex flex-col gap-4">
              {/* 上：単語の正答率のまとめ */}
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

              {/* 下：苦手な単語 Best 10 */}
              <div className="rounded-xl border p-3 bg-white">
                <h3 className="text-sm font-semibold">
                  苦手な単語 Best 10（attempts ≥ 2）
                </h3>
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
              {/* 概要 */}
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

              {/* 苦手 Best 10 */}
              <div className="rounded-xl border p-3 bg-white">
                <h3 className="text-sm font-semibold">
                  苦手な問題 Best 10（attempts ≥ 2）
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
        {/* ③ 勉強時間 */}
        <section className="glass-card p-4">
          <h2 className="font-semibold">③ 勉強時間（直近14日）</h2>
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
                        {/* 1日180分を100%として進捗バー表示（必要に応じて基準変更） */}
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
