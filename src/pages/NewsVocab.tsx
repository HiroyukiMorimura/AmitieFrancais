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

import {
  listLocalTopics,
  isLocalTopicId,
  loadLocalPairs,
} from "../lib/localNewsSets";

const WEAK_TOPIC_ID = -1 as const;
const LIMIT_PAIRS = 20;

const MENU_ID_SNAKE = "news_vocab"; // サーバー側（Supabase）で使ってきた想定
const MENU_ID_KEBAB = "news-vocab"; // ローカルや旧実装で保存されていた可能性
const MENU_ID = MENU_ID_SNAKE; // 今後の保存はこれに統一

// 上部の import 群の下あたりに追加
async function loadWeakPairsFromSupabase(
  limitTopics = 50,
  limitPairsPerTopic = 200,
  pickTop = 50
): Promise<Pair[]> {
  // 1) 直近トピックを取得（多すぎ防止のため上限）
  const { data: topicsData, error: topicsErr } = await supabase
    .from("topics")
    .select("id")
    .order("id", { ascending: false })
    .limit(limitTopics);
  if (topicsErr || !topicsData?.length) return [];

  // 2) 各トピックから語彙を取得（上限つき）
  const topicIds = topicsData.map((t) => t.id);
  const { data: pairsData, error: pairsErr } = await supabase
    .from("vocab_pairs")
    .select("id, ja, fr, topic_id")
    .in("topic_id", topicIds)
    .order("id", { ascending: true })
    .limit(limitTopics * limitPairsPerTopic); // サーバ側上限に注意
  if (pairsErr || !pairsData?.length) return [];

  // 3) 正誤を取得
  const allIds = pairsData.map((p) => p.id);
  let countsMap: Map<number, Stat> = new Map();
  try {
    countsMap = await getCountsForItemsSrv("news_vocab", allIds);
  } catch (e) {
    console.warn("[getCountsForItemsSrv] failed for weak view:", e);
    // 失敗時はゼロ扱い
    countsMap = new Map(allIds.map((id) => [id, { correct: 0, wrong: 0 }]));
  }

  // 4) スコアリング：未出題→正解0→正答率低い（昇順）→試行回数少→間違い多
  type Scored = Pair & { _score: [number, number, number, number] }; // tuple sort
  const scored: Scored[] = pairsData.map((p) => {
    const s = countsMap.get(p.id) ?? { correct: 0, wrong: 0 };
    const attempts = s.correct + s.wrong;
    const unseen = attempts === 0 ? 0 : 1; // 未出題優先（0が先）
    const zeroCorrect = s.correct === 0 ? 0 : 1; // 正解0優先
    const acc = attempts ? s.correct / attempts : 0; // 正答率（低いほうが先）
    const tieAttempts = attempts; // 少ないほうが先
    // tuple: [未出題, 正解0, 正答率, 試行回数] で昇順
    return {
      id: p.id,
      ja: p.ja,
      fr: p.fr,
      _score: [unseen, zeroCorrect, acc, tieAttempts],
    };
  });

  scored.sort((a, b) => {
    for (let i = 0; i < a._score.length; i++) {
      if (a._score[i] !== b._score[i]) return a._score[i] - b._score[i];
    }
    return a.id - b.id;
  });

  return scored.slice(0, pickTop).map(({ id, ja, fr }) => ({ id, ja, fr }));
}

type Topic = {
  id: number;
  big_category: string; // 大項目（フォルダ or DBのカテゴリー）
  subtopic: string; // 小項目（ファイル1行目の「…」or DBのサブトピック）
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
    supabase.auth.getSession().then((res) => {
      setUid(res.data.session?.user?.id ?? null);
      console.log(
        "[auth] initial session user:",
        res.data.session?.user?.id ?? null
      );
    });
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
  const [selectedBigCat, setSelectedBigCat] = useState<string | null>(null); // ★ 大項目
  const [selectedTopicId, setSelectedTopicId] = useState<number | null>(null); // ★ 小項目（Topic.id）
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [loadingTopics, setLoadingTopics] = useState(true);
  const [loadingPairs, setLoadingPairs] = useState(false);
  const [mode, setMode] = useState<"drill" | "list">("drill");
  const [dir, setDir] = useState<DrillDir>("JA2FR");

  // ドリル状態
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);

  // セッション内の正誤カウント（表示用）
  const [stats, setStats] = useState<
    Record<number, { JA2FR: Stat; FR2JA: Stat }>
  >({});

  // ---- セッション計測 ----
  const sessionStartRef = useRef<number | null>(null);
  useEffect(() => {
    (async () => {
      const t0 = await startSession(); // 終了時に保存
      sessionStartRef.current = t0;
    })();
    return () => {
      void endSession("news_vocab", sessionStartRef.current);
    };
  }, []);

  // ---- トピック取得（ローカル＋Supabase） ----
  useEffect(() => {
    (async () => {
      setLoadingTopics(true);

      const special = {
        id: WEAK_TOPIC_ID,
        big_category: "特集",
        subtopic: "頑張ろう🎉",
        created_at: "",
      } as const;

      // ① ローカル
      const locals = listLocalTopics(); // /src/data/news-sets/** をトピック化（大項目=フォルダ、小項目=1行目）

      // ② Supabase
      const { data, error } = await supabase
        .from("topics")
        .select("id, big_category, subtopic, created_at")
        .order("id", { ascending: false });

      const remotes = error || !data ? [] : data;

      // 表示順は [特集, ローカル, リモート] とする（必要なら並び替え可）
      const merged = [special as Topic, ...locals, ...remotes];
      setTopics(merged);

      // 初期の大項目を決める（先頭の大項目）
      setSelectedBigCat((prev) => prev ?? merged[0]?.big_category ?? null);

      setLoadingTopics(false);
    })();
  }, []);

  // ---- 大項目ごとのグルーピング ----
  const groupedByBigCat = useMemo(() => {
    const map = new Map<string, Topic[]>();
    for (const t of topics) {
      if (!map.has(t.big_category)) map.set(t.big_category, []);
      map.get(t.big_category)!.push(t);
    }
    // 小項目は日本語の辞書順で
    for (const [k, arr] of map) {
      arr.sort((a, b) => a.subtopic.localeCompare(b.subtopic, "ja"));
      map.set(k, arr);
    }
    return map;
  }, [topics]);

  const visibleSubtopics = useMemo(() => {
    if (!selectedBigCat) return [];
    return groupedByBigCat.get(selectedBigCat) ?? [];
  }, [groupedByBigCat, selectedBigCat]);

  // 大項目が変わったら小項目とペア表示をクリア
  useEffect(() => {
    setSelectedTopicId(null);
    setPairs([]);
    setIdx(0);
    setRevealed(false);
  }, [selectedBigCat]);

  // ---- 小項目選択時：語彙ペア＋統計のロード ----
  useEffect(() => {
    if (!selectedTopicId) return;
    (async () => {
      setLoadingPairs(true);
      if (selectedTopicId === WEAK_TOPIC_ID) {
        try {
          const data = await loadWeakPairsFromSupabase(
            /* limitTopics */ 50,
            /* perTopic */ 200,
            /* pickTop */ LIMIT_PAIRS
          );
          const limited = data.slice(0, LIMIT_PAIRS); // 念のためダブルセーフ
          setPairs(limited);

          // stats 初期化
          const next: Record<number, { JA2FR: Stat; FR2JA: Stat }> = {};
          for (const p of limited) {
            next[p.id] = {
              JA2FR: { correct: 0, wrong: 0 },
              FR2JA: { correct: 0, wrong: 0 },
            };
          }
          setStats(next);
          setIdx(0);
          setRevealed(false);
        } finally {
          setLoadingPairs(false);
        }
        return; // ← ここで早期リターン（以降のローカル/通常処理へ行かない）
      }
      // ローカルトピック
      if (isLocalTopicId(selectedTopicId)) {
        const data = await loadLocalPairs(selectedTopicId);
        const limited = data.slice(0, LIMIT_PAIRS); // ★ 20件に制限
        setPairs(limited);

        const next: Record<number, { JA2FR: Stat; FR2JA: Stat }> = {};
        for (const p of limited) {
          // ★ limited を使う
          next[p.id] = {
            JA2FR: { correct: 0, wrong: 0 },
            FR2JA: { correct: 0, wrong: 0 },
          };
        }
        setStats(next);

        if (uid) {
          try {
            const prog = await loadProgressSrv("news_vocab", {
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
            console.warn("[loadProgress failed]", e);
          }
        }

        setLoadingPairs(false);
        return;
      }

      // Supabase の通常トピック
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

      const limited = (data ?? []).slice(0, LIMIT_PAIRS); // ★ 20件に制限
      setPairs(limited);

      const zeroInit = () => {
        const next: Record<number, { JA2FR: Stat; FR2JA: Stat }> = {};
        for (const p of limited) {
          // ★ limited を使う
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
          const itemIds = limited.map((p) => p.id);
          const serverMap = await fetchCountsMerged(itemIds);

          const next: Record<number, { JA2FR: Stat; FR2JA: Stat }> = {};
          for (const p of limited) {
            const s = serverMap.get(p.id) ?? { correct: 0, wrong: 0 };
            next[p.id] = { JA2FR: s, FR2JA: s };
          }
          setStats(next);
        } catch (e) {
          console.warn("[getCountsForItems] failed:", e);
          zeroInit();
        }
      }

      if (uid) {
        try {
          const prog = await loadProgressSrv("news_vocab", {
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

  // 選択中のTopic
  const selectedTopic = useMemo(
    () => topics.find((t) => t.id === selectedTopicId) ?? null,
    [topics, selectedTopicId]
  );

  // 現カード
  const card = pairs[idx] ?? null;

  // 出題優先
  const sortedIndices = () => {
    const statFor = (id: number) =>
      stats[id]?.[dir] ?? { correct: 0, wrong: 0 };
    const attempts = (s: { correct: number; wrong: number }) =>
      s.correct + s.wrong;

    const allHaveAtLeastOneCorrect = pairs.every(
      (p) => (stats[p.id]?.[dir]?.correct ?? 0) >= 1
    );

    const indices = pairs.map((_, i) => i);

    if (!allHaveAtLeastOneCorrect) {
      // フェーズ1: 未出題 → 正解0 → タイブレーク
      return indices.sort((a, b) => {
        const sa = statFor(pairs[a].id);
        const sb = statFor(pairs[b].id);
        const aAttempts = attempts(sa);
        const bAttempts = attempts(sb);
        const aUnseen = aAttempts === 0;
        const bUnseen = bAttempts === 0;
        if (aUnseen !== bUnseen) return aUnseen ? -1 : 1;

        const aZeroCorrect = sa.correct === 0;
        const bZeroCorrect = sb.correct === 0;
        if (aZeroCorrect !== bZeroCorrect) return aZeroCorrect ? -1 : 1;

        if (aAttempts !== bAttempts) return aAttempts - bAttempts;
        if (sa.wrong !== sb.wrong) return sb.wrong - sa.wrong;
        return a - b;
      });
    } else {
      // フェーズ2: 正答率の低い順（上げていく）
      return indices.sort((a, b) => {
        const sa = statFor(pairs[a].id);
        const sb = statFor(pairs[b].id);
        const accA = sa.correct / Math.max(1, sa.correct + sa.wrong);
        const accB = sb.correct / Math.max(1, sb.correct + sb.wrong);
        if (accA !== accB) return accA - accB;

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

    try {
      await recordAttemptSrv({
        menuId: MENU_ID,
        isCorrect: kind === "correct",
        itemId: card.id,
        skillTags: [],
        meta: { dir },
        alsoLocal: {
          userId: uid ?? "local",
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
  // counts の取得: snake/kebab の両方を読んでマージ（dir も渡せるなら渡す）
  async function fetchCountsMerged(itemIds: number[]) {
    const mapSnake = await getCountsForItemsSrv(MENU_ID_SNAKE, itemIds).catch(
      () => new Map<number, Stat>()
    );
    const mapKebab = await getCountsForItemsSrv(MENU_ID_KEBAB, itemIds).catch(
      () => new Map<number, Stat>()
    );

    // マージ（単純加算）
    const merged = new Map<number, Stat>();
    for (const id of itemIds) {
      const a = mapSnake.get(id) ?? { correct: 0, wrong: 0 };
      const b = mapKebab.get(id) ?? { correct: 0, wrong: 0 };
      merged.set(id, {
        correct: a.correct + b.correct,
        wrong: a.wrong + b.wrong,
      });
    }
    return merged;
  }

  // 進捗保存（ログイン時）
  useEffect(() => {
    if (!card || !selectedTopicId || !uid) return;
    void saveProgressSrv({
      moduleId: "news_vocab",
      context: { topic_id: selectedTopicId, dir },
      lastItemId: card.id,
    });
  }, [card, dir, selectedTopicId, uid]);

  // セッション内合計（ヘッダー表示）
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
            {/* モード切替 */}
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
        {/* トピック選択（大項目→小項目） */}
        <section>
          <label className="block text-sm text-slate-600">トピック</label>

          {/* 大項目（カテゴリ） */}
          <div className="mt-2 flex flex-wrap gap-2">
            {loadingTopics && (
              <span className="text-slate-500">読み込み中…</span>
            )}
            {!loadingTopics && topics.length === 0 && (
              <span className="text-slate-500">トピックがありません</span>
            )}
            {[...new Set(topics.map((t) => t.big_category))].map((cat) => {
              const active = cat === selectedBigCat;
              const isSpecial = cat === "特集";

              return (
                <button
                  key={cat}
                  className={[
                    "chip",
                    active ? "ring-2 ring-rose-200" : "",
                    isSpecial
                      ? "bg-yellow-100 text-yellow-800 border-yellow-300"
                      : "",
                  ].join(" ")}
                  onClick={() => setSelectedBigCat(cat)}
                  title={isSpecial ? "特集" : cat}
                  aria-label={isSpecial ? "特集" : cat}
                >
                  <span className="font-medium">{cat}</span>
                </button>
              );
            })}
          </div>

          {/* 小項目（サブトピック） */}
          {selectedBigCat && (
            <>
              <div className="mt-4 text-xs text-slate-500">
                {selectedBigCat} の小項目
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {visibleSubtopics.map((t) => {
                  const active = t.id === selectedTopicId;
                  return (
                    <button
                      key={t.id}
                      className={`chip ${active ? "ring-2 ring-blue-200" : ""}`}
                      onClick={() => setSelectedTopicId(t.id)}
                      title={`${t.big_category} — ${t.subtopic}`}
                    >
                      <span className="font-medium">{t.subtopic}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </section>

        {/* 概要 */}
        <section className="mt-4">
          <div className="glass-card flex items-center justify-between">
            <div>
              <div className="text-sm text-slate-500">
                {selectedBigCat
                  ? selectedTopic
                    ? `${selectedBigCat} — ${selectedTopic.subtopic}`
                    : `${selectedBigCat} — （小項目を選択してください）`
                  : "—"}
              </div>
              <div className="text-xs text-slate-500">
                語彙数：{loadingPairs ? "…" : pairs.length} 件
              </div>
            </div>
          </div>
        </section>

        {/* モード別表示（小項目未選択なら案内） */}
        {selectedTopicId ? (
          mode === "list" ? (
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
          )
        ) : (
          <div className="mt-8 text-slate-500">
            小項目を選択すると語彙が表示されます
          </div>
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
              日→仏: ✅ {s.JA2FR.correct} / ❌ {s.JA2FR.wrong} 仏→日: ✅{" "}
              {s.FR2JA.correct} / ❌ {s.FR2JA.wrong}
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
    </section>
  );
}
