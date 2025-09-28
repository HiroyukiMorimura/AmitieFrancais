// src/pages/Report.tsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { getDailyStudySeconds } from "../lib/supaMetrics";
import { isLocalTopicId, loadLocalPairs } from "../lib/localNewsSets";

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

// 学習イベント（最低限）
type DrillDir = "JA2FR" | "FR2JA";
type EventMeta = {
  dir?: DrillDir;
  source?: "local" | "remote";
  topic_id?: number;
};
type RawLE = {
  item_id: number | null;
  is_correct: boolean;
  created_at?: string;
  meta?: EventMeta | Record<string, unknown> | null;
};

/* ========== ②の根本修正：単語統計の取得 ========== */

async function fetchNewsVocabStats(uid: string): Promise<VocabStat[]> {
  const SINCE_DAYS = 14;
  const sinceISO = new Date(
    Date.now() - SINCE_DAYS * 86400 * 1000
  ).toISOString();

  // 1) ビューがあれば使う
  try {
    const { data: vs, error } = await supabase
      .from("v_user_vocab_stats_14d")
      .select("*")
      .eq("user_id", uid);

    if (!error && vs && vs.length > 0) {
      return vs as VocabStat[];
    }
  } catch {
    // フォールバックへ
  }

  // 2) learning_events を直接読む（menu 揺れ対応）
  const { data: evsRaw, error: evErr } = await supabase
    .from("learning_events")
    .select("item_id,is_correct,created_at,meta,menu")
    .eq("user_id", uid)
    .in("menu", ["news_vocab", "news-vocab"])
    .not("item_id", "is", null)
    .gte("created_at", sinceISO);

  if (evErr || !evsRaw || evsRaw.length === 0) return [];

  const rows: RawLE[] = evsRaw as RawLE[];

  // 3) 集計（item_id ごと）
  const aggMap = new Map<
    number,
    {
      attempts: number;
      corrects: number;
      wrongs: number;
      metaSamples: EventMeta[];
    }
  >();
  for (const r of rows) {
    if (r.item_id == null) continue;
    const cur = aggMap.get(r.item_id) ?? {
      attempts: 0,
      corrects: 0,
      wrongs: 0,
      metaSamples: [],
    };
    cur.attempts += 1;
    if (r.is_correct) cur.corrects += 1;
    else cur.wrongs += 1;

    // メタの整形（unknown も EventMeta に寄せる）
    const meta = normalizeMeta(r.meta);
    if (meta) cur.metaSamples.push(meta);

    aggMap.set(r.item_id, cur);
  }
  const itemIds = [...aggMap.keys()];
  if (itemIds.length === 0) return [];

  // 4) ラベル逆引き：remote（vocab_pairs）を一括で
  const labelMap = new Map<number, string>();
  const { data: vp, error: vpErr } = await supabase
    .from("vocab_pairs")
    .select("id, ja, fr")
    .in("id", itemIds);

  if (!vpErr && vp) {
    for (const row of vp as Array<{ id: number; ja: string; fr: string }>) {
      if (Number.isFinite(row.id) && !labelMap.has(row.id)) {
        labelMap.set(row.id, `${row.ja} — ${row.fr}`);
      }
    }
  }

  // 5) remote で解決できなかった item を local で解決
  const unresolved = itemIds.filter((id) => !labelMap.has(id));
  if (unresolved.length > 0) {
    // item_id → topic_id の推定（metaSamples の先勝ち）
    const topicByItem = new Map<number, number>();
    for (const id of unresolved) {
      const m = aggMap.get(id)?.metaSamples ?? [];
      const topic = m.find(
        (x) => x.source === "local" && typeof x.topic_id === "number"
      )?.topic_id;
      if (typeof topic === "number" && isLocalTopicId(topic)) {
        topicByItem.set(id, topic);
      }
    }

    // topic_id ごとにローカルファイルを読んで逆引き
    const uniqueTopics = [...new Set(topicByItem.values())];
    for (const topicId of uniqueTopics) {
      const pairs = await loadLocalPairs(topicId);
      for (const [itemId, tId] of topicByItem.entries()) {
        if (tId !== topicId) continue;
        const p = pairs.find((x) => x.id === itemId);
        if (p && !labelMap.has(itemId)) {
          labelMap.set(itemId, `${p.ja} — ${p.fr}`);
        }
      }
    }
  }

  // 6) VocabStat に整形（label が無いものは null）
  const stats: VocabStat[] = itemIds.map((id) => {
    const a = aggMap.get(id)!;
    const acc = a.attempts ? Math.round((a.corrects / a.attempts) * 100) : 0;
    const label = labelMap.get(id) ?? null;
    return {
      user_id: uid,
      word: label,
      lemma: null,
      attempts: a.attempts,
      corrects: a.corrects,
      wrongs: a.wrongs,
      accuracy_percent: acc,
    };
  });

  // 正答率の低い順に返す（下流で slice する）
  return stats.sort((x, y) => x.accuracy_percent - y.accuracy_percent);
}

/* ========== メタ正規化（unknown → EventMeta） ========== */
function normalizeMeta(meta: RawLE["meta"]): EventMeta | null {
  if (!meta || typeof meta !== "object") return null;
  const src = (meta as Record<string, unknown>)["source"];
  const dir = (meta as Record<string, unknown>)["dir"];
  const topic = (meta as Record<string, unknown>)["topic_id"];

  const out: EventMeta = {};
  if (src === "local" || src === "remote") out.source = src;
  if (dir === "JA2FR" || dir === "FR2JA") out.dir = dir;
  if (typeof topic === "number") out.topic_id = topic;
  return Object.keys(out).length ? out : null;
}

/* ========== Report 本体（弱点トピックは削除済み） ========== */

export default function Report() {
  const [loading, setLoading] = useState(true);

  // ①②
  const [vocabStats, setVocabStats] = useState<VocabStat[]>([]);
  // ③
  const [studyBuckets, setStudyBuckets] = useState<StudyBucket[]>([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth.user?.id;
        if (!uid) {
          setVocabStats([]);
          setStudyBuckets([]);
          return;
        }

        // ①② 単語（直近14日）— 修正版フェッチ
        const vs = await fetchNewsVocabStats(uid);
        setVocabStats(vs);

        // ③ 勉強時間（直近14日ぶんを helper から秒で取得）
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
