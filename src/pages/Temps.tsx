import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import type { MenuId } from "../lib/metricsClient";
import {
  startSession,
  endSession,
  recordAttempt as recordAttemptSrv,
  saveProgress as saveProgressSrv,
  loadProgress as loadProgressSrv,
  getCountsForItems as getCountsForItemsSrv,
} from "../lib/metricsClient";
import { getStudyTimeByMenu } from "../lib/supaMetrics";
import { useDrillHotkeys } from "../hooks/useDrillHotkeys";

/* =========================================================
   動詞選択＋活用（TSV: /src/data/Futsuken/Futsuken_temps.tsv）
   GUIは NewsVocab/Nominalisation と同等。
   問題文を提示し、「答えを表示」で解答をめくる。
   正誤の優先出題ロジックは NewsVocab と同じ。
   ========================================================= */

// Supabase/メトリクス用ID
const MENU_ID: MenuId = "verb_gym";
const UI_MODULE_ID = "verb_gym" as const;

// 1セッション当たりの上限
const LIMIT_PAIRS = 100;
// 直近抑制（直前カードの重複出現を防ぐ）
const COOLDOWN_N = 1;

// TSV の1行をアプリ内部のペアに
export type TempsPair = {
  id: number;
  question: string; // 問題文
  answer: string; // 答え
};

// UI内の統計
export type Stat = { correct: number; wrong: number };

async function fetchServerCounts(itemIds: number[]) {
  try {
    const map = await getCountsForItemsSrv("verb_gym", itemIds);
    return map as Map<number, { correct: number; wrong: number }>;
  } catch (e) {
    console.warn("[getCountsForItemsSrv] failed:", e);
    return new Map<number, { correct: number; wrong: number }>();
  }
}

// TSV ローダ
async function loadTempsData(): Promise<TempsPair[]> {
  const url = new URL(
    `../data/Futsuken/Futsuken_temps.tsv`,
    import.meta.url
  ).toString();

  const text = await fetch(url).then((r) => {
    if (!r.ok) throw new Error(`TSV load failed: Futsuken_temps.tsv`);
    return r.text();
  });

  const lines = text.trim().split(/\r?\n/);
  if (lines.length === 0) return [];

  // 先頭行のBOMを除去
  const firstLine = lines[0].replace(/^\uFEFF/, "");
  const header = firstLine.split("\t").map((h) => h.trim());

  // ヘッダー行は「問題文（動詞は( )で示す）」「答え」
  const hasHeader = header.length >= 2;
  const body = hasHeader ? lines.slice(1) : lines;
  const pairs: TempsPair[] = [];

  body.forEach((row, lineIdx) => {
    const cols = row.split("\t");
    if (cols.length < 2) return;

    const question = cols[0]?.trim();
    const answer = cols[1]?.trim();

    if (!question || !answer) return;

    // IDは行番号ベース（1から開始）
    const id = lineIdx + 1;

    pairs.push({ id, question, answer });
  });

  return pairs;
}

export default function Temps() {
  // 認証
  const [uid, setUid] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getSession().then((res) => {
      setUid(res.data.session?.user?.id ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUid(session?.user?.id ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // セッション開始/終了
  const sessionStartRef = useRef<number | null>(null);
  useEffect(() => {
    (async () => {
      const t0 = await startSession();
      sessionStartRef.current = t0;
    })();
    return () => {
      void endSession(MENU_ID, sessionStartRef.current);
    };
  }, []);

  // モード
  const [mode, setMode] = useState<"drill" | "list">("drill");

  // ペア & ローディング
  const [pairs, setPairs] = useState<TempsPair[]>([]);
  const [loadingPairs, setLoadingPairs] = useState(false);

  // ドリル状態
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);

  // セッション内の正誤
  const [stats, setStats] = useState<Record<number, Stat>>({});

  // 直近の出題抑制
  const recentRef = useRef<number[]>([]);
  const pushRecent = (id: number | null) => {
    if (id == null) return;
    const arr = recentRef.current;
    const i = arr.indexOf(id);
    if (i !== -1) arr.splice(i, 1);
    arr.push(id);
    while (arr.length > COOLDOWN_N) arr.shift();
  };
  const clearRecent = () => {
    recentRef.current = [];
  };

  const [ready, setReady] = useState(false);

  // 学習時間の統計（全モジュール合算）
  const [studyTimeByMenu, setStudyTimeByMenu] = useState<
    Record<string, number>
  >({});
  const [loadingStudyTime, setLoadingStudyTime] = useState(false);

  // 初回読み込み
  useEffect(() => {
    setPairs([]);
    setStats({});
    setReady(false);
    setIdx(-1);
    setRevealed(false);
    clearRecent();
    setLoadingPairs(true);

    (async () => {
      try {
        const data = await loadTempsData();
        const limited = data.slice(0, LIMIT_PAIRS);
        setPairs(limited);

        // ゼロ初期化
        const zeroInit: Record<number, Stat> = {};
        for (const p of limited) zeroInit[p.id] = { correct: 0, wrong: 0 };

        // サーバ counts マージ
        const mergedStats: Record<number, Stat> = { ...zeroInit };
        try {
          const ids = limited.map((p) => p.id);
          const serverMap = await fetchServerCounts(ids);
          for (const p of limited) {
            const s = serverMap.get(p.id);
            if (s) mergedStats[p.id] = { correct: s.correct, wrong: s.wrong };
          }
        } catch (err: unknown) {
          console.warn("[fetchServerCounts] merge failed:", err);
        }
        setStats(mergedStats);

        // 進捗復元
        let restored = false;
        if (uid) {
          try {
            const prog = await loadProgressSrv(UI_MODULE_ID, {});
            if (prog?.last_item_id) {
              const i = limited.findIndex((x) => x.id === prog.last_item_id);
              if (i >= 0) {
                setIdx(i);
                restored = true;
              }
            }
          } catch (err: unknown) {
            console.warn("[loadProgressSrv] failed:", err);
          }
        }

        // 未復元なら優先順の先頭で開始
        if (!restored) {
          const first = pickFirstIndexByPriority(limited, mergedStats);
          setIdx(first);
        }

        setRevealed(false);
        setReady(true);
      } finally {
        setLoadingPairs(false);
      }
    })();
  }, [uid]);

  // 学習時間の取得（ユーザー認証後）
  useEffect(() => {
    if (!uid) {
      setStudyTimeByMenu({});
      return;
    }
    (async () => {
      setLoadingStudyTime(true);
      try {
        const timeByMenu = await getStudyTimeByMenu();
        setStudyTimeByMenu(timeByMenu);
      } catch (e) {
        console.warn("[getStudyTimeByMenu] failed:", e);
      } finally {
        setLoadingStudyTime(false);
      }
    })();
  }, [uid]);

  // 学習時間の合計計算
  const totalStudyTime = useMemo(() => {
    const totalSec = Object.values(studyTimeByMenu).reduce(
      (sum, sec) => sum + sec,
      0
    );
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.round((totalSec % 3600) / 60);
    return { totalSec, hours, minutes };
  }, [studyTimeByMenu]);

  // 苦手な問題（正答率が低いもの）
  const weakProblems = useMemo(() => {
    return pairs
      .map((p) => {
        const s = stats[p.id] ?? { correct: 0, wrong: 0 };
        const attempts = s.correct + s.wrong;
        const acc = attempts ? Math.round((s.correct / attempts) * 100) : 0;
        return { ...p, stat: s, attempts, acc };
      })
      .filter((p) => p.attempts >= 2) // 2回以上試行したもの
      .sort((a, b) => {
        if (a.acc !== b.acc) return a.acc - b.acc; // 正答率の低い順
        return b.attempts - a.attempts; // 同率なら試行回数の多い順
      })
      .slice(0, 10); // 上位10件
  }, [pairs, stats]);

  // 現カード
  const card = pairs[idx] ?? null;

  // 出題優先（NewsVocabと同様の2フェーズ）
  const sortedIndices = () => {
    const attempts = (s: Stat) => s.correct + s.wrong;
    const indices = pairs.map((_, i) => i);

    const allHaveAtLeastOneCorrect = pairs.every(
      (p) => (stats[p.id]?.correct ?? 0) >= 1
    );

    if (!allHaveAtLeastOneCorrect) {
      return indices.sort((a, b) => {
        const sa = stats[pairs[a].id] ?? { correct: 0, wrong: 0 };
        const sb = stats[pairs[b].id] ?? { correct: 0, wrong: 0 };

        const aAtt = attempts(sa);
        const bAtt = attempts(sb);
        const aUnseen = aAtt === 0;
        const bUnseen = bAtt === 0;
        if (aUnseen !== bUnseen) return aUnseen ? -1 : 1;

        const aZeroCorrect = sa.correct === 0;
        const bZeroCorrect = sb.correct === 0;
        if (aZeroCorrect !== bZeroCorrect) return aZeroCorrect ? -1 : 1;

        if (aAtt !== bAtt) return aAtt - bAtt;
        if (sa.wrong !== sb.wrong) return sb.wrong - sa.wrong;
        return a - b;
      });
    } else {
      return indices.sort((a, b) => {
        const sa = stats[pairs[a].id] ?? { correct: 0, wrong: 0 };
        const sb = stats[pairs[b].id] ?? { correct: 0, wrong: 0 };

        const accA = sa.correct / Math.max(1, sa.correct + sa.wrong);
        const accB = sb.correct / Math.max(1, sb.correct + sb.wrong);
        if (accA !== accB) return accA - accB;

        const aAtt = sa.correct + sa.wrong;
        const bAtt = sb.correct + sb.wrong;
        if (aAtt !== bAtt) return aAtt - bAtt;
        return a - b;
      });
    }
  };

  const goNextPrioritized = () => {
    if (pairs.length === 0) return;

    const order = sortedIndices();
    const recentIds = new Set(recentRef.current);

    const baseCandidates = order.filter((i) => {
      const id = pairs[i]?.id;
      return i !== idx && id != null && !recentIds.has(id);
    });

    let nextIdx: number | null = null;

    if (baseCandidates.length > 0) {
      nextIdx = baseCandidates[0];
    } else {
      const relax = [...recentRef.current];
      while (relax.length > 0 && nextIdx == null) {
        relax.shift();
        const relaxedSet = new Set(relax);
        const cands = order.filter((i) => {
          const id = pairs[i]?.id;
          return i !== idx && id != null && !relaxedSet.has(id);
        });
        if (cands.length > 0) nextIdx = cands[0];
      }
      if (nextIdx == null) nextIdx = order.find((i) => i !== idx) ?? idx;
    }

    const currentId = pairs[idx]?.id ?? null;
    pushRecent(currentId);
    setIdx(nextIdx);
    setRevealed(false);
  };

  const onPrev = () => {
    if (idx <= 0) return;
    setIdx((v) => Math.max(0, v - 1));
    setRevealed(false);
  };
  const onNext = () => {
    if (idx < pairs.length - 1) {
      pushRecent(pairs[idx]?.id ?? null);
      setIdx((v) => v + 1);
      setRevealed(false);
    } else {
      goNextPrioritized();
    }
  };

  const onMark = async (kind: "correct" | "wrong") => {
    if (!card) return;
    setStats((prev) => {
      const cur = prev[card.id] ?? { correct: 0, wrong: 0 };
      const updated: Stat =
        kind === "correct"
          ? { correct: cur.correct + 1, wrong: cur.wrong }
          : { correct: cur.correct, wrong: cur.wrong + 1 };
      return { ...prev, [card.id]: updated };
    });

    try {
      await recordAttemptSrv({
        menuId: MENU_ID,
        isCorrect: kind === "correct",
        itemId: card.id,
        skillTags: ["temps", "verb_conjugation"],
        meta: {},
        alsoLocal: {
          userId: uid ?? "local",
          localSkillTags: ["vocab:temps"],
        },
      });
    } catch (e) {
      console.warn("[recordAttempt] failed", e);
    }
    goNextPrioritized();
  };

  // 進捗保存
  useEffect(() => {
    if (!card || !uid) return;
    void saveProgressSrv({
      moduleId: UI_MODULE_ID,
      context: {},
      lastItemId: card.id,
    });
  }, [card, uid]);

  // ===== ヘッダー表示用：サーバ上の累計 正解/試行 =====
  const [sessionTotal, setSessionTotal] = useState<{
    correct: number;
    tried: number;
  }>({
    correct: 0,
    tried: 0,
  });
  useEffect(() => {
    if (!uid) {
      setSessionTotal({ correct: 0, tried: 0 });
      return;
    }
    (async () => {
      try {
        const { data, error } = await supabase
          .from("attempts")
          .select("is_correct, menu_id")
          .eq("user_id", uid)
          .eq("menu_id", MENU_ID);
        if (error) throw error;
        const correct = data?.filter((a) => a.is_correct).length ?? 0;
        const tried = data?.length ?? 0;
        setSessionTotal({ correct, tried });
      } catch (e) {
        console.warn("[load session total] failed:", e);
      }
    })();
  }, [uid]);

  // 今セッションで増えた分（画面での操作ぶん）
  const sessionIncrement = useMemo(() => {
    let correct = 0;
    let tried = 0;
    for (const s of Object.values(stats)) {
      correct += s.correct;
      tried += s.correct + s.wrong;
    }
    return { correct, tried };
  }, [stats]);

  const totalCorrect = sessionTotal.correct + sessionIncrement.correct;
  const totalTried = sessionTotal.tried + sessionIncrement.tried;
  const acc = totalTried ? Math.round((totalCorrect / totalTried) * 100) : 0;

  useDrillHotkeys({
    enabled: mode === "drill" && !loadingPairs && pairs.length > 0,
    revealed,
    setRevealed,
    onCorrect: () => void onMark("correct"),
    onWrong: () => void onMark("wrong"),
    onNext,
    onPrev,
  });

  return (
    <div className="min-h-svh bg-white">
      {/* ヘッダー */}
      <header className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-5xl px-4 py-3 flex flex-wrap gap-3 items-center justify-between">
          <h1 className="text-lg font-bold">🧩 動詞選択＋活用</h1>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span>
              正答 {totalCorrect} / {totalTried}（{acc}%）
            </span>
          </div>
          <ModeToggle mode={mode} setMode={setMode} />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        {/* 概要 */}
        <section className="mt-4">
          <div className="glass-card flex items-center justify-between">
            <div>
              <div className="text-sm text-slate-500">
                動詞の時制・活用を選ぶドリル
              </div>
              <div className="text-xs text-slate-500">
                語彙数：{loadingPairs ? "…" : pairs.length} 件
              </div>
            </div>
          </div>
        </section>

        {/* 学習時間と苦手な問題 */}
        {uid && (
          <section className="mt-4 space-y-4">
            {/* 学習時間（全モジュール合算） */}
            <div className="glass-card p-4">
              <h3 className="font-semibold text-sm mb-2">
                ⏱ 学習時間（全モジュール合算）
              </h3>
              {loadingStudyTime ? (
                <p className="text-slate-500 text-sm">読み込み中…</p>
              ) : totalStudyTime.totalSec === 0 ? (
                <p className="text-slate-500 text-sm">
                  まだ学習時間の記録がありません
                </p>
              ) : (
                <div className="space-y-2">
                  <div className="text-2xl font-bold text-slate-700">
                    {totalStudyTime.hours}時間 {totalStudyTime.minutes}分
                  </div>
                  <div className="text-xs text-slate-500">
                    時事単語・名詞化ジム・動詞選択の合計学習時間
                  </div>
                </div>
              )}
            </div>

            {/* 苦手な問題 */}
            {weakProblems.length > 0 && (
              <div className="glass-card p-4">
                <h3 className="font-semibold text-sm mb-3">
                  📊 苦手な問題 Top 10
                </h3>
                <ul className="space-y-2">
                  {weakProblems.map((p, i) => (
                    <li
                      key={p.id}
                      className="rounded-lg border p-2 bg-white text-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <span className="font-medium">
                            {i + 1}. {p.question}
                          </span>
                          <div className="text-xs text-slate-500 mt-0.5">
                            答え: {p.answer}
                          </div>
                        </div>
                        <div className="text-xs text-slate-600 whitespace-nowrap">
                          正答率 {p.acc}% ({p.stat.correct}/{p.attempts})
                        </div>
                      </div>
                      <div className="mt-2 h-1.5 w-full rounded-full bg-slate-200">
                        <div
                          className="h-full bg-emerald-500 rounded-full"
                          style={{ width: `${p.acc}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {/* モード表示 */}
        {!ready || loadingPairs ? (
          <div className="mt-8 text-slate-500">問題を読み込み中…</div>
        ) : pairs.length > 0 && idx >= 0 ? (
          <ContentSwitcher
            mode={mode}
            pairs={pairs}
            loading={loadingPairs}
            stats={stats}
            card={pairs[idx] ?? null}
            idx={idx}
            total={pairs.length}
            revealed={revealed}
            setRevealed={setRevealed}
            onPrev={onPrev}
            onNext={onNext}
            onCorrect={() => void onMark("correct")}
            onWrong={() => void onMark("wrong")}
          />
        ) : (
          <div className="mt-8 text-slate-500">問題がありません</div>
        )}
      </main>
    </div>
  );
}

/* ===== UI: ドリル/一覧 モード切替 ===== */
function ModeToggle({
  mode,
  setMode,
}: {
  mode: "drill" | "list";
  setMode: (v: "drill" | "list") => void;
}) {
  return (
    <div className="inline-flex rounded-xl border bg-white shadow-sm overflow-hidden">
      <button
        className={`px-3 py-1.5 text-sm ${
          mode === "drill" ? "bg-slate-100 font-semibold" : "hover:bg-slate-50"
        }`}
        onClick={() => setMode("drill")}
      >
        ドリル
      </button>
      <button
        className={`px-3 py-1.5 text-sm ${
          mode === "list" ? "bg-slate-100 font-semibold" : "hover:bg-slate-50"
        }`}
        onClick={() => setMode("list")}
      >
        一覧
      </button>
    </div>
  );
}

/* ===== コンテンツ切替 ===== */
function ContentSwitcher({
  mode,
  pairs,
  loading,
  stats,
  card,
  idx,
  total,
  revealed,
  setRevealed,
  onPrev,
  onNext,
  onCorrect,
  onWrong,
}: {
  mode: "drill" | "list";
  pairs: TempsPair[];
  loading: boolean;
  stats: Record<number, Stat>;
  card: TempsPair | null;
  idx: number;
  total: number;
  revealed: boolean;
  setRevealed: (v: boolean) => void;
  onPrev: () => void;
  onNext: () => void;
  onCorrect: () => void;
  onWrong: () => void;
}) {
  if (mode === "list") {
    return <ListView pairs={pairs} loading={loading} stats={stats} />;
  }
  return (
    <DrillView
      card={card}
      idx={idx}
      total={total}
      revealed={revealed}
      setRevealed={setRevealed}
      onPrev={onPrev}
      onNext={onNext}
      stat={
        card
          ? stats[card.id] ?? { correct: 0, wrong: 0 }
          : { correct: 0, wrong: 0 }
      }
      onCorrect={onCorrect}
      onWrong={onWrong}
    />
  );
}

/* ========== 一覧ビュー ========== */
function ListView({
  pairs,
  loading,
  stats,
}: {
  pairs: TempsPair[];
  loading: boolean;
  stats: Record<number, Stat>;
}) {
  if (loading)
    return <div className="mt-6 text-slate-500">問題を読み込み中…</div>;
  if (!pairs.length)
    return <div className="mt-6 text-slate-500">問題がありません</div>;

  return (
    <ul className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-3">
      {pairs.map((p) => {
        const s = stats[p.id] ?? { correct: 0, wrong: 0 };
        return (
          <li key={p.id} className="glass-card">
            <div className="font-medium text-sm">{p.question}</div>
            <div className="text-slate-600 mt-1">{p.answer}</div>
            <div className="mt-1 text-xs text-slate-500">
              ✅ {s.correct} / ❌ {s.wrong}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function pickFirstIndexByPriority(
  pairs: TempsPair[],
  stats: Record<number, Stat>
): number {
  const attempts = (s: Stat) => s.correct + s.wrong;
  const allHaveAtLeastOneCorrect = pairs.every(
    (p) => (stats[p.id]?.correct ?? 0) >= 1
  );
  const indices = pairs.map((_, i) => i);

  if (!allHaveAtLeastOneCorrect) {
    indices.sort((a, b) => {
      const sa = stats[pairs[a].id] ?? { correct: 0, wrong: 0 };
      const sb = stats[pairs[b].id] ?? { correct: 0, wrong: 0 };
      const aAtt = attempts(sa);
      const bAtt = attempts(sb);
      const aUnseen = aAtt === 0;
      const bUnseen = bAtt === 0;
      if (aUnseen !== bUnseen) return aUnseen ? -1 : 1;

      const aZeroCorrect = sa.correct === 0;
      const bZeroCorrect = sb.correct === 0;
      if (aZeroCorrect !== bZeroCorrect) return aZeroCorrect ? -1 : 1;

      if (aAtt !== bAtt) return aAtt - bAtt;
      if (sa.wrong !== sb.wrong) return sb.wrong - sa.wrong;
      return a - b;
    });
  } else {
    indices.sort((a, b) => {
      const sa = stats[pairs[a].id] ?? { correct: 0, wrong: 0 };
      const sb = stats[pairs[b].id] ?? { correct: 0, wrong: 0 };
      const accA = sa.correct / Math.max(1, sa.correct + sa.wrong);
      const accB = sb.correct / Math.max(1, sb.correct + sb.wrong);
      if (accA !== accB) return accA - accB;
      const aAtt = sa.correct + sa.wrong;
      const bAtt = sb.correct + sb.wrong;
      if (aAtt !== bAtt) return aAtt - bAtt;
      return a - b;
    });
  }
  return indices[0] ?? 0;
}

/* ========== ドリルビュー ========== */
function DrillView({
  card,
  idx,
  total,
  revealed,
  setRevealed,
  onPrev,
  onNext,
  stat,
  onCorrect,
  onWrong,
}: {
  card: TempsPair | null;
  idx: number;
  total: number;
  revealed: boolean;
  setRevealed: (v: boolean) => void;
  onPrev: () => void;
  onNext: () => void;
  stat: Stat;
  onCorrect: () => void;
  onWrong: () => void;
}) {
  if (!card)
    return <div className="mt-6 text-slate-500">カードがありません</div>;

  return (
    <section className="mt-6">
      <div className="text-sm text-slate-500">
        {idx + 1} / {total}（正解 {stat.correct}・間違い {stat.wrong}）
      </div>

      <div className="mt-3 rounded-2xl border bg-white shadow p-6">
        <div className="text-center">
          <div className="text-lg font-semibold whitespace-pre-wrap">
            {card.question}
          </div>

          {!revealed ? (
            <button
              className="btn-primary mt-5 px-6 py-2"
              onClick={() => setRevealed(true)}
            >
              答えを表示
            </button>
          ) : (
            <>
              <div className="mt-4 text-xl text-emerald-700 font-semibold">
                {card.answer}
              </div>
              <div className="mt-5 flex items-center justify-center gap-2">
                <button
                  className="rounded-xl border px-4 py-2 text-sm hover:bg-green-50"
                  onClick={onCorrect}
                  title="正解として記録"
                >
                  正解 ✅
                </button>
                <button
                  className="rounded-xl border px-4 py-2 text-sm hover:bg-amber-50"
                  onClick={onWrong}
                  title="不正解として記録"
                >
                  不正解 ❌
                </button>
              </div>
            </>
          )}
        </div>

        <div className="mt-6 flex items-center justify-between">
          <button
            className="rounded-xl border px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-40"
            onClick={onPrev}
            disabled={idx === 0}
          >
            ← 前へ
          </button>

          <button
            className="rounded-xl border px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-40"
            onClick={onNext}
            disabled={idx >= total - 1}
          >
            次へ →
          </button>
        </div>
      </div>
    </section>
  );
}