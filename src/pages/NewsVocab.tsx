import { useEffect, useMemo, useRef, useState } from "react";

import { supabase } from "../lib/supabase";

import {
  startSession,
  endSession,
  recordAttempt as recordAttemptSrv,
  saveProgress as saveProgressSrv,
  loadProgress as loadProgressSrv,
  getCountsForItems as getCountsForItemsSrv,
} from "../lib/metricsClient";

import { getAllAttempts } from "../lib/metrics";

const WEAK_TOPIC_ID = -1 as const;

type Topic = {
  id: number;
  big_category: string;
  subtopic: string;
  created_at: string;
};

type Pair = {
  id: number;
  ja: string;
  fr: string;
};

type DrillDir = "JA2FR" | "FR2JA";
type Stat = { correct: number; wrong: number };

export default function NewsVocab() {
  // ---- 認証状態（uid） ----
  const [uid, setUid] = useState<string | null>(null);
  useEffect(() => {
    // 初期セッション取得
    supabase.auth.getSession().then((res) => {
      setUid(res.data.session?.user?.id ?? null);
      console.log(
        "[auth] initial session user:",
        res.data.session?.user?.id ?? null
      );
    });
    // 変化を監視
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUid(session?.user?.id ?? null);
      console.log(
        "[auth] onAuthStateChange:",
        _e,
        "user:",
        session?.user?.id ?? null
      );
    });
    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  // ---- UI/データ状態 ----
  const [topics, setTopics] = useState<Topic[]>([]);
  const [selectedTopicId, setSelectedTopicId] = useState<number | null>(null);
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [loadingTopics, setLoadingTopics] = useState(true);
  const [loadingPairs, setLoadingPairs] = useState(false);
  const [mode, setMode] = useState<"drill" | "list">("drill"); // デフォ：ドリル
  const [dir, setDir] = useState<DrillDir>("JA2FR");

  // ドリル状態
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);

  // セッション内の正誤カウント（表示用）
  const [stats, setStats] = useState<
    Record<number, { JA2FR: Stat; FR2JA: Stat }>
  >({});

  // ---- セッション計測（useRefで確実にクリーンアップ） ----
  const sessionStartRef = useRef<number | null>(null);
  useEffect(() => {
    (async () => {
      const t0 = await startSession(); // 終了時に保存
      sessionStartRef.current = t0;
    })();
    return () => {
      void endSession("news_vocab", sessionStartRef.current);
    };
  }, []); // ← 依存なし（マウント/アンマウント1回だけ）

  // トピック取得（新しい順）
  useEffect(() => {
    (async () => {
      setLoadingTopics(true);
      const { data, error } = await supabase
        .from("topics")
        .select("id, big_category, subtopic, created_at")
        .order("id", { ascending: false });

      if (error) {
        console.error("[topics]", error);
      } else if (data) {
        // 疑似トピックを追加
        const special = {
          id: WEAK_TOPIC_ID,
          big_category: "特集",
          subtopic: "苦手な単語",
          created_at: "",
        } satisfies Topic;
        setTopics([special, ...data]);

        // 既定は「最新の通常トピック」にしておく（お好みで special.id にしてもOK）
        if (data.length > 0) setSelectedTopicId(data[0].id);
      }
      setLoadingTopics(false);
    })();
  }, []);

  // 選択トピックの語彙ペア取得＋（ログイン時のみ）サーバー集計読み込み＋前回の続き復元
  useEffect(() => {
    if (!selectedTopicId) return;
    (async () => {
      setLoadingPairs(true);

      // ★ 苦手な単語（特集モード）
      if (selectedTopicId === WEAK_TOPIC_ID) {
        try {
          // すべての語彙を取る（id, ja, fr）
          const { data: allPairs, error: e1 } = await supabase
            .from("vocab_pairs")
            .select("id, ja, fr")
            .order("id", { ascending: true });

          if (e1 || !allPairs) throw e1;

          // ローカル記録から itemId ごとの正誤を集計（news_vocabのみ）
          const attempts = getAllAttempts(uid ?? "local").filter(
            (a) =>
              a.moduleId === "news-vocab" && typeof a.meta?.itemId === "number"
          );

          const per = new Map<number, { correct: number; wrong: number }>();
          for (const a of attempts) {
            const id = a.meta!.itemId as number;
            const prev = per.get(id) ?? { correct: 0, wrong: 0 };
            per.set(id, {
              correct: prev.correct + (a.correct ? 1 : 0),
              wrong: prev.wrong + (a.correct ? 0 : 1),
            });
          }

          // 未学習(=attempts=0)は除外。並び：正解0かつ wrong多い順 → それ以外は正答率低い順
          const rankedIds = [...per.entries()]
            .filter(([, s]) => s.correct + s.wrong > 0) // ← [, s] としてキーを無視
            .sort(([, a], [, b]) => {
              // ← [, a], [, b] として値だけ使う
              const aZero = a.correct === 0;
              const bZero = b.correct === 0;
              if (aZero !== bZero) return aZero ? -1 : 1; // 正解0が先
              if (aZero && bZero) {
                if (a.wrong !== b.wrong) return b.wrong - a.wrong;
              } else {
                const accA = a.correct / (a.correct + a.wrong);
                const accB = b.correct / (b.correct + b.wrong);
                if (accA !== accB) return accA - accB;
              }
              const triesA = a.correct + a.wrong;
              const triesB = b.correct + b.wrong;
              if (a.wrong !== b.wrong) return b.wrong - a.wrong;
              if (triesA !== triesB) return triesB - triesA;
              return 0;
            })
            .map(([id]) => id);

          const topIds = rankedIds.slice(0, 10);
          const byId = new Map(allPairs.map((p) => [p.id, p]));
          const topPairs = topIds
            .map((id) => byId.get(id))
            .filter(Boolean) as Pair[];

          setPairs(topPairs);

          // stats をローカル集計で初期化（どちらの dir にも同値を入れておく）
          const next: Record<number, { JA2FR: Stat; FR2JA: Stat }> = {};
          for (const id of topIds) {
            const s = per.get(id) ?? { correct: 0, wrong: 0 };
            next[id] = { JA2FR: { ...s }, FR2JA: { ...s } };
          }
          setStats(next);

          setIdx(0);
          setRevealed(false);
        } catch (e) {
          console.error("[weak-items]", e);
          setPairs([]);
        } finally {
          setLoadingPairs(false);
        }
        return; // ← ここで終了（通常分岐へ進まない）
      }

      // ★ 通常トピック（元の処理）
      // 1) 語彙取得
      const { data, error } = await supabase
        .from("vocab_pairs")
        .select("id, ja, fr")
        .eq("topic_id", selectedTopicId)
        .order("id", { ascending: true });

      if (error) {
        console.error("[vocab_pairs]", error);
        setPairs([]);
        setLoadingPairs(false);
        return;
      }
      setPairs(data);

      // 2) stats の初期化
      const zeroInit = () => {
        const next: Record<number, { JA2FR: Stat; FR2JA: Stat }> = {};
        for (const p of data) {
          next[p.id] = {
            JA2FR: { correct: 0, wrong: 0 },
            FR2JA: { correct: 0, wrong: 0 },
          };
        }
        setStats(next);
      };

      if (!uid) {
        zeroInit();
      } else {
        try {
          const itemIds = data.map((p) => p.id);
          const serverMap = await getCountsForItemsSrv("news-vocab", itemIds);
          const next: Record<number, { JA2FR: Stat; FR2JA: Stat }> = {};
          for (const p of data) {
            const s = serverMap.get(p.id);
            const base: Stat = { correct: 0, wrong: 0 };
            // 片方向集計しか持っていない前提なら、dir 両方に同じ値を入れてOK
            next[p.id] = { JA2FR: s ?? base, FR2JA: s ?? base };
          }
          setStats(next);
        } catch (e) {
          console.warn("[getCountsForItems] failed:", e);
          zeroInit();
        }
      }

      // 4) 続き復元（ログイン時のみ）
      if (uid) {
        try {
          const prog = await loadProgressSrv("news-vocab", {
            topic_id: selectedTopicId,
            dir,
          });
          if (prog?.last_item_id) {
            const i = data.findIndex((x) => x.id === prog.last_item_id);
            if (i >= 0) setIdx(i);
          } else {
            setIdx(0);
          }
          setRevealed(false);
        } catch (e) {
          console.warn("[loadProgress] failed:", e);
        }
      }

      setLoadingPairs(false);
    })();
  }, [selectedTopicId, dir, uid]);

  const selectedTopic = useMemo(
    () => topics.find((t) => t.id === selectedTopicId) ?? null,
    [topics, selectedTopicId]
  );

  // 現カード
  const card = pairs[idx] ?? null;

  // 出題優先
  // 既存の attemptsOf は不要になるので削除OK

  const sortedIndices = () => {
    const statFor = (id: number) =>
      stats[id]?.[dir] ?? { correct: 0, wrong: 0 };
    const attempts = (s: { correct: number; wrong: number }) =>
      s.correct + s.wrong;

    // まず、全カードが「正解>=1」かどうかを判定
    const allHaveAtLeastOneCorrect = pairs.every(
      (p) => (stats[p.id]?.[dir]?.correct ?? 0) >= 1
    );

    const indices = pairs.map((_, i) => i);

    if (!allHaveAtLeastOneCorrect) {
      // フェーズ1: 未出題 → 正解0 の順で優先
      return indices.sort((a, b) => {
        const sa = statFor(pairs[a].id);
        const sb = statFor(pairs[b].id);

        const aAttempts = attempts(sa);
        const bAttempts = attempts(sb);
        const aUnseen = aAttempts === 0;
        const bUnseen = bAttempts === 0;
        if (aUnseen !== bUnseen) return aUnseen ? -1 : 1; // 未出題が先

        const aZeroCorrect = sa.correct === 0;
        const bZeroCorrect = sb.correct === 0;
        if (aZeroCorrect !== bZeroCorrect) return aZeroCorrect ? -1 : 1; // 正解0が先

        // タイブレーク: 試行回数が少ない → 間違いが多い → インデックス
        if (aAttempts !== bAttempts) return aAttempts - bAttempts;
        if (sa.wrong !== sb.wrong) return sb.wrong - sa.wrong;
        return a - b;
      });
    } else {
      // フェーズ2: 全カードが正解>=1 になったら正答率の高い順（降順）
      return indices.sort((a, b) => {
        const sa = statFor(pairs[a].id);
        const sb = statFor(pairs[b].id);
        const accA = sa.correct / Math.max(1, sa.correct + sa.wrong);
        const accB = sb.correct / Math.max(1, sb.correct + sb.wrong);
        if (accA !== accB) return accA - accB; // 低い順

        // タイブレーク: 試行回数が少ない → インデックス
        const aAttempts = sa.correct + sa.wrong;
        const bAttempts = sb.correct + sb.wrong;
        if (aAttempts !== bAttempts) return aAttempts - bAttempts;
        return a - b;
      });
    }
  };

  const goNextPrioritized = () => {
    if (pairs.length === 0) return;
    const order = sortedIndices();
    const next = order.find((i) => i !== idx) ?? idx;
    setIdx(next);
    setRevealed(false);
  };

  const onPrev = () => {
    if (idx <= 0) return;
    setIdx((v) => Math.max(0, v - 1));
    setRevealed(false);
  };
  const onNext = () => {
    if (idx < pairs.length - 1) {
      setIdx((v) => v + 1);
      setRevealed(false);
    } else {
      goNextPrioritized();
    }
  };

  // 正解/不正の記録（Supabaseへ・セッション内統計も更新）→ 次カード
  const mark = async (kind: "correct" | "wrong") => {
    if (!card) return;

    // セッション内統計（即時UI反映）
    setStats((prev) => {
      const cur = prev[card.id] ?? {
        JA2FR: { correct: 0, wrong: 0 },
        FR2JA: { correct: 0, wrong: 0 },
      };
      const curDir = cur[dir];
      const updated: Stat =
        kind === "correct"
          ? { correct: curDir.correct + 1, wrong: curDir.wrong }
          : { correct: curDir.correct, wrong: curDir.wrong + 1 };
      return { ...prev, [card.id]: { ...cur, [dir]: updated } };
    });

    // ② サーバー記録（既存）
    try {
      await recordAttemptSrv({
        menuId: "news_vocab",
        isCorrect: kind === "correct",
        itemId: card.id,
        skillTags: [], // サーバー用（任意）
        meta: { dir },
        alsoLocal: {
          userId: uid ?? "local", // ローカル記録（UI即時反映 & レポート用）
          localSkillTags: [
            "vocab:news",
            `topic:${selectedTopicId ?? "?"}`,
            `dir:${dir}`,
          ],
        },
      });
    } catch (e) {
      console.warn("[recordAttempt] failed:", e);
    }
    goNextPrioritized();
  };

  // カード or 方向が変わるたび進捗を保存（ログイン時のみ）
  useEffect(() => {
    if (!card || !selectedTopicId || !uid) return;
    void saveProgressSrv({
      moduleId: "news-vocab",
      context: { topic_id: selectedTopicId, dir },
      lastItemId: card.id,
    });
  }, [card, dir, selectedTopicId, uid]);

  // セッション内合計（ヘッダー表示用・任意）
  const totalCorrect = useMemo(
    () =>
      Object.values(stats).reduce(
        (a, s) => a + s.JA2FR.correct + s.FR2JA.correct,
        0
      ),
    [stats]
  );
  const totalTried = useMemo(
    () =>
      Object.values(stats).reduce(
        (a, s) =>
          a + s.JA2FR.correct + s.JA2FR.wrong + s.FR2JA.correct + s.FR2JA.wrong,
        0
      ),
    [stats]
  );
  const acc = totalTried ? Math.round((totalCorrect / totalTried) * 100) : 0;

  return (
    <div className="min-h-svh bg-white">
      {/* ヘッダー */}
      <header className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-5xl px-4 py-3 flex flex-wrap gap-3 items-center justify-between">
          <h1 className="text-lg font-bold">📰 時事単語</h1>

          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span>
              正答 {totalCorrect} / {totalTried}（{acc}%）
            </span>
          </div>

          <div className="flex gap-2">
            {/* モード切替（ドリル先行） */}
            <div className="inline-flex rounded-xl border bg-white shadow-sm overflow-hidden">
              <button
                className={`px-3 py-1.5 text-sm ${
                  mode === "drill"
                    ? "bg-slate-100 font-semibold"
                    : "hover:bg-slate-50"
                }`}
                onClick={() => setMode("drill")}
              >
                ドリル
              </button>
              <button
                className={`px-3 py-1.5 text-sm ${
                  mode === "list"
                    ? "bg-slate-100 font-semibold"
                    : "hover:bg-slate-50"
                }`}
                onClick={() => setMode("list")}
              >
                一覧
              </button>
            </div>

            {/* 出題方向（ドリル時のみ） */}
            {mode === "drill" && (
              <div className="inline-flex rounded-xl border bg-white shadow-sm overflow-hidden">
                <button
                  className={`px-3 py-1.5 text-sm ${
                    dir === "JA2FR"
                      ? "bg-slate-100 font-semibold"
                      : "hover:bg-slate-50"
                  }`}
                  onClick={() => {
                    setDir("JA2FR");
                    setRevealed(false);
                  }}
                >
                  日 → 仏
                </button>
                <button
                  className={`px-3 py-1.5 text-sm ${
                    dir === "FR2JA"
                      ? "bg-slate-100 font-semibold"
                      : "hover:bg-slate-50"
                  }`}
                  onClick={() => {
                    setDir("FR2JA");
                    setRevealed(false);
                  }}
                >
                  仏 → 日
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* 本文 */}
      <main className="mx-auto max-w-5xl px-4 py-6">
        {/* トピック選択 */}
        <section>
          <label className="block text-sm text-slate-600">トピック</label>
          <div className="mt-2 flex flex-wrap gap-2">
            {loadingTopics && (
              <span className="text-slate-500">読み込み中…</span>
            )}
            {!loadingTopics && topics.length === 0 && (
              <span className="text-slate-500">トピックがありません</span>
            )}
            {topics.map((t) => {
              const active = t.id === selectedTopicId;
              return (
                <button
                  key={t.id}
                  className={`chip ${active ? "ring-2 ring-rose-200" : ""}`}
                  onClick={() => setSelectedTopicId(t.id)}
                >
                  <span className="text-xs text-slate-500">
                    {t.big_category}
                  </span>
                  <span className="font-medium">{t.subtopic}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* 概要 */}
        <section className="mt-4">
          <div className="glass-card flex items-center justify-between">
            <div>
              <div className="text-sm text-slate-500">
                {selectedTopic
                  ? `${selectedTopic.big_category} — ${selectedTopic.subtopic}`
                  : "—"}
              </div>
              <div className="text-xs text-slate-500">
                語彙数：{loadingPairs ? "…" : pairs.length} 件
              </div>
            </div>
          </div>
        </section>

        {/* モード別表示 */}
        {mode === "list" ? (
          <ListView pairs={pairs} loading={loadingPairs} stats={stats} />
        ) : (
          <DrillView
            card={card}
            idx={idx}
            total={pairs.length}
            revealed={revealed}
            setRevealed={setRevealed}
            onPrev={onPrev}
            onNext={onNext}
            dir={dir}
            stat={
              card
                ? stats[card.id]?.[dir] ?? { correct: 0, wrong: 0 }
                : { correct: 0, wrong: 0 }
            }
            onCorrect={() => void mark("correct")}
            onWrong={() => void mark("wrong")}
          />
        )}
      </main>
    </div>
  );
}

/* ========== 一覧ビュー（仏語は常時表示） ========== */
function ListView({
  pairs,
  loading,
  stats,
}: {
  pairs: Pair[];
  loading: boolean;
  stats: Record<number, { JA2FR: Stat; FR2JA: Stat }>;
}) {
  if (loading)
    return <div className="mt-6 text-slate-500">語彙を読み込み中…</div>;
  if (!pairs.length)
    return <div className="mt-6 text-slate-500">語彙がありません</div>;

  return (
    <ul className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-3">
      {pairs.map((p) => {
        const s = stats[p.id] ?? {
          JA2FR: { correct: 0, wrong: 0 },
          FR2JA: { correct: 0, wrong: 0 },
        };
        return (
          <li key={p.id} className="glass-card">
            <div className="font-medium">{p.ja}</div>
            <div className="text-slate-600">{p.fr}</div>
            <div className="mt-1 text-xs text-slate-500">
              日→仏: ✅ {s.JA2FR.correct} / ❌ {s.JA2FR.wrong}
              仏→日: ✅ {s.FR2JA.correct} / ❌ {s.FR2JA.wrong}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ========== ドリルビュー（答えは“めくる”） ========== */
function DrillView({
  card,
  idx,
  total,
  revealed,
  setRevealed,
  onPrev,
  onNext,
  dir,
  stat,
  onCorrect,
  onWrong,
}: {
  card: Pair | null;
  idx: number;
  total: number;
  revealed: boolean;
  setRevealed: (v: boolean) => void;
  onPrev: () => void;
  onNext: () => void;
  dir: "JA2FR" | "FR2JA";
  stat: { correct: number; wrong: number };
  onCorrect: () => void;
  onWrong: () => void;
}) {
  if (!card)
    return <div className="mt-6 text-slate-500">カードがありません</div>;

  const prompt = dir === "JA2FR" ? card.ja : card.fr;
  const answer = dir === "JA2FR" ? card.fr : card.ja;
  const revealLabel = dir === "JA2FR" ? "仏語を表示" : "日本語を表示";

  return (
    <section className="mt-6">
      <div className="text-sm text-slate-500">
        {idx + 1} / {total}（正解 {stat.correct}・間違い {stat.wrong}）
      </div>

      <div className="mt-3 rounded-2xl border bg-white shadow p-6">
        <div className="text-center">
          <div className="text-2xl font-semibold">{prompt}</div>

          {!revealed ? (
            <button
              className="btn-primary mt-5 px-6 py-2"
              onClick={() => setRevealed(true)}
            >
              {revealLabel}
            </button>
          ) : (
            <>
              <div className="mt-4 text-xl text-slate-700">{answer}</div>
              <div className="mt-5 flex items-center justify-center gap-2">
                <button
                  className="rounded-xl border px-4 py-2 text-sm hover:bg-green-50"
                  onClick={onCorrect}
                  title="覚えた（正解として記録）"
                >
                  覚えた ✅
                </button>
                <button
                  className="rounded-xl border px-4 py-2 text-sm hover:bg-amber-50"
                  onClick={onWrong}
                  title="難しい（不正解として記録）"
                >
                  難しい 😵
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

      {/* <p className="mt-3 text-xs text-slate-500">
        ※ 正誤は Supabase（learning_events）に保存。滞在時間は
        study_sessions、進捗は user_progress に保存されます。
      </p> */}
    </section>
  );
}
