// src/pages/NewsVocab.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import type { UIModuleId } from "../lib/metricsClient";

import {
  startSession,
  endSession,
  recordAttempt as recordAttemptSrv,
  saveProgress as saveProgressSrv,
  loadProgress as loadProgressSrv,
  getCountsForItems as getCountsForItemsSrv,
  getCountsForItemsByDir as getCountsForItemsByDirSrv,
} from "../lib/metricsClient";

import {
  listLocalTopics,
  isLocalTopicId,
  loadLocalPairs,
} from "../lib/localNewsSets";


import { useDrillHotkeys } from "../hooks/useDrillHotkeys";

const WEAK_TOPIC_ID = -1 as const;
const LIMIT_PAIRS = 20;
const COOLDOWN_N = 1;

// 書き込みは snake に統一（過去データ互換のため）
const MENU_ID_SNAKE = "news_vocab" as const;
// 進捗・UI 系は kebab
const UI_MODULE_ID: UIModuleId = "news-vocab";

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
type DirStat = { JA2FR: Stat; FR2JA: Stat };

/** kebab / snake の両方を読み、ID ごとに合算して返す（any を使わない版） */
async function fetchCountsMerged(itemIds: number[]) {
  try {
    return await getCountsForItemsSrv(UI_MODULE_ID, itemIds);
  } catch {
    return new Map<number, Stat>();
  }
}

/** kebab / snake の両方を読み、方向別（JA2FR/FR2JA）で合算して返す */
async function fetchCountsByDirMerged(itemIds: number[], uid: string) {
  const fetchOneSrv = async (dir: DrillDir) => {
    try {
      return await getCountsForItemsByDirSrv(UI_MODULE_ID, itemIds, dir);
    } catch {
      return new Map<number, Stat>();
    }
  };

  // 1) まず既存サーバ集計（UIモジュール ID のみ。supaMetrics 側で snake/kebab を吸収）
  const [kJA, kFR] = await Promise.all([
    fetchOneSrv("JA2FR"),
    fetchOneSrv("FR2JA"),
  ]);

  const mergedSrv = new Map<number, DirStat>();
  for (const id of itemIds) {
    const ja = kJA.get(id);
    const fr = kFR.get(id);
    if (ja || fr) {
      mergedSrv.set(id, {
        JA2FR: ja ?? { correct: 0, wrong: 0 },
        FR2JA: fr ?? { correct: 0, wrong: 0 },
      });
    }
  }
  if (mergedSrv.size > 0) return mergedSrv;

  // 2) フォールバック: attempts を直接集計（meta.dir or skill_tags の 'dir:XXX'）
  type AttemptRow = {
    item_id: number;
    is_correct: boolean;
    meta: Record<string, unknown> | null;
    skill_tags: string[] | null;
    menu_id: string;
  };

  const isRecord = (v: unknown): v is Record<string, unknown> =>
    v !== null && typeof v === "object" && !Array.isArray(v);

  const extractDir = (meta: unknown, skillTags: unknown): DrillDir | null => {
    // meta.dir を優先
    if (isRecord(meta)) {
      const d = meta["dir"];
      if (typeof d === "string") {
        const up = d.toUpperCase();
        if (up === "JA2FR") return "JA2FR";
        if (up === "FR2JA") return "FR2JA";
      }
    }
    // skill_tags の 'dir:XXX'
    if (Array.isArray(skillTags)) {
      const found = skillTags.find(
        (s): s is string =>
          typeof s === "string" && s.toUpperCase().startsWith("DIR:")
      );
      if (found) {
        const up = found.split(":")[1]?.toUpperCase();
        if (up === "JA2FR") return "JA2FR";
        if (up === "FR2JA") return "FR2JA";
      }
    }
    return null;
  };

  // ⬇️ ここをジェネリクス無しにして、戻り値に型を当てます
  const { data, error } = await supabase
    .from("attempts")
    .select("item_id, is_correct, meta, skill_tags, menu_id")
    .eq("user_id", uid)
    .in("menu_id", [UI_MODULE_ID as unknown as string, MENU_ID_SNAKE])
    .in("item_id", itemIds);

  if (error) {
    const zero = new Map<number, DirStat>();
    for (const id of itemIds) {
      zero.set(id, {
        JA2FR: { correct: 0, wrong: 0 },
        FR2JA: { correct: 0, wrong: 0 },
      });
    }
    return zero;
  }

  // data に AttemptRow[] 型を適用（any は使わず unknown → 具体型に）
  const rows: AttemptRow[] = (data ?? []) as unknown as AttemptRow[];

  const out = new Map<number, DirStat>();
  const ensure = (id: number) => {
    if (!out.has(id)) {
      out.set(id, {
        JA2FR: { correct: 0, wrong: 0 },
        FR2JA: { correct: 0, wrong: 0 },
      });
    }
    return out.get(id)!;
  };

  for (const r of rows) {
    const dir = extractDir(r.meta, r.skill_tags);
    if (!dir) continue; // 方向不明はスキップ
    const slot = ensure(r.item_id)[dir];
    if (r.is_correct) slot.correct += 1;
    else slot.wrong += 1;
  }

  // 全 id を必ず埋める
  for (const id of itemIds) {
    if (!out.has(id)) {
      out.set(id, {
        JA2FR: { correct: 0, wrong: 0 },
        FR2JA: { correct: 0, wrong: 0 },
      });
    }
  }
  return out;
}

// 直近トピックから弱点（正答率が低い等）を上位抽出
async function loadWeakPairsFromSupabase(
  limitTopics = 50,
  limitPairsPerTopic = 200,
  pickTop = 50
): Promise<Pair[]> {
  const { data: topicsData, error: topicsErr } = await supabase
    .from("topics")
    .select("id")
    .order("id", { ascending: false })
    .limit(limitTopics);
  if (topicsErr || !topicsData?.length) return [];

  const topicIds = topicsData.map((t) => t.id);
  const { data: pairsData, error: pairsErr } = await supabase
    .from("vocab_pairs")
    .select("id, ja, fr, topic_id")
    .in("topic_id", topicIds)
    .order("id", { ascending: true })
    .limit(limitTopics * limitPairsPerTopic);
  if (pairsErr || !pairsData?.length) return [];

  // サーバの正誤を合算で取得（方向非依存スコアリング用）
  const allIds = pairsData.map((p) => p.id);
  const countsMap = await fetchCountsMerged(allIds);

  // 未出題→正解0→正答率低→試行少 の順で優先
  type Scored = Pair & { _score: [number, number, number, number] };
  const scored: Scored[] = pairsData.map((p) => {
    const s = countsMap.get(p.id) ?? { correct: 0, wrong: 0 };
    const attempts = s.correct + s.wrong;
    const unseen = attempts === 0 ? 0 : 1;
    const zeroCorrect = s.correct === 0 ? 0 : 1;
    const acc = attempts ? s.correct / attempts : 0;
    const tieAttempts = attempts;
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

export default function NewsVocab() {
  // ---- 認証状態（uid） ----
  const [uid, setUid] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getSession().then((res) => {
      setUid(res.data.session?.user?.id ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUid(session?.user?.id ?? null);
    });
    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  // ---- UI/データ状態 ----
  const [topics, setTopics] = useState<Topic[]>([]);
  const [selectedBigCat, setSelectedBigCat] = useState<string | null>(null);
  const [selectedTopicId, setSelectedTopicId] = useState<number | null>(null);
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [loadingTopics, setLoadingTopics] = useState(true);
  const [loadingPairs, setLoadingPairs] = useState(false);
  const [mode, setMode] = useState<"drill" | "list">("drill");
  const [dir, setDir] = useState<DrillDir>("JA2FR");

  // ドリル状態
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);

  // セッション内の正誤（画面内のみのインメモリ）
  const [stats, setStats] = useState<Record<number, DirStat>>({});

  // ---- セッション計測 ----
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
  const sessionStartRef = useRef<number | null>(null);
  useEffect(() => {
    (async () => {
      const t0 = await startSession();
      sessionStartRef.current = t0;
    })();
    return () => {
      // 書き込みは snake に統一
      void endSession(MENU_ID_SNAKE, sessionStartRef.current);
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

      const locals = listLocalTopics();

      const { data, error } = await supabase
        .from("topics")
        .select("id, big_category, subtopic, created_at")
        .order("id", { ascending: false });

      const remotes = error || !data ? [] : data;
      const merged = [special as Topic, ...locals, ...remotes];

      setTopics(merged);
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

      // 特集（弱点）
      if (selectedTopicId === WEAK_TOPIC_ID) {
        try {
          const data = await loadWeakPairsFromSupabase(
            50, // topics
            200, // per topic
            LIMIT_PAIRS // pickTop
          );
          const limited = data.slice(0, LIMIT_PAIRS);
          setPairs(limited);
          clearRecent();

          // サーバの counts を復元（kebab+snake の方向別合算）
          if (!uid) {
            // 認証がまだなら 0 初期化だけして終了（uid が入ると useEffect が再実行されます）
            const next: Record<number, DirStat> = {};
            for (const p of limited) {
              next[p.id] = {
                JA2FR: { correct: 0, wrong: 0 },
                FR2JA: { correct: 0, wrong: 0 },
              };
            }
            setStats(next);
          } else
            try {
              const serverDirMap = await fetchCountsByDirMerged(
                limited.map((v) => v.id),
                uid
              );
              const next: Record<number, DirStat> = {};
              for (const p of limited) {
                next[p.id] = serverDirMap.get(p.id) ?? {
                  JA2FR: { correct: 0, wrong: 0 },
                  FR2JA: { correct: 0, wrong: 0 },
                };
              }
              setStats(next);
            } catch {
              const next: Record<number, DirStat> = {};
              for (const p of limited) {
                next[p.id] = {
                  JA2FR: { correct: 0, wrong: 0 },
                  FR2JA: { correct: 0, wrong: 0 },
                };
              }
              setStats(next);
            }

          setIdx(0);
          setRevealed(false);
        } finally {
          setLoadingPairs(false);
        }
        return;
      }

      // ローカルトピック
      if (isLocalTopicId(selectedTopicId)) {
        const data = await loadLocalPairs(selectedTopicId);
        const limited = data.slice(0, LIMIT_PAIRS);
        setPairs(limited);
        clearRecent();

        // サーバから counts を復元（kebab+snake の方向別合算）
        if (!uid) {
          const next: Record<number, DirStat> = {};
          for (const p of limited) {
            next[p.id] = {
              JA2FR: { correct: 0, wrong: 0 },
              FR2JA: { correct: 0, wrong: 0 },
            };
          }
          setStats(next);
        } else
          try {
            const ids = limited.map((p) => p.id);
            const serverDirMap = await fetchCountsByDirMerged(ids, uid);
            const next: Record<number, DirStat> = {};
            for (const p of limited) {
              next[p.id] = serverDirMap.get(p.id) ?? {
                JA2FR: { correct: 0, wrong: 0 },
                FR2JA: { correct: 0, wrong: 0 },
              };
            }
            setStats(next);
          } catch (e) {
            console.warn("[getCountsForItems local] failed:", e);
            const next: Record<number, DirStat> = {};
            for (const p of limited) {
              next[p.id] = {
                JA2FR: { correct: 0, wrong: 0 },
                FR2JA: { correct: 0, wrong: 0 },
              };
            }
            setStats(next);
          }

        // 進捗復元（UIモジュール ID は kebab）
        if (uid) {
          try {
            const prog = await loadProgressSrv(UI_MODULE_ID, {
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
      const limited = (data ?? []).slice(0, LIMIT_PAIRS);
      setPairs(limited);
      clearRecent();

      const zeroInit = () => {
        const next: Record<number, DirStat> = {};
        for (const p of limited) {
          next[p.id] = {
            JA2FR: { correct: 0, wrong: 0 },
            FR2JA: { correct: 0, wrong: 0 },
          };
        }
        setStats(next);
      };

      // サーバの counts 復元を試みる（kebab+snake の方向別合算）
      if (!uid) {
        zeroInit();
      } else
        try {
          const itemIds = limited.map((p) => p.id);
          const serverDirMap = await fetchCountsByDirMerged(itemIds, uid);
          const next: Record<number, DirStat> = {};
          for (const p of limited) {
            next[p.id] = serverDirMap.get(p.id) ?? {
              JA2FR: { correct: 0, wrong: 0 },
              FR2JA: { correct: 0, wrong: 0 },
            };
          }
          setStats(next);
        } catch (e) {
          console.warn("[getCountsForItems] failed:", e);
          zeroInit();
        }

      // 進捗復元（UIモジュール ID は kebab）
      if (uid) {
        try {
          const prog = await loadProgressSrv(UI_MODULE_ID, {
            topic_id: selectedTopicId,
            dir,
          });
          const i = data?.findIndex((x) => x.id === prog?.last_item_id) ?? -1;
          if (i >= 0) setIdx(i);
          else setIdx(0);
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
      // フェーズ2: 正答率の低い順
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
    const recentIds = new Set(recentRef.current);
    const baseCandidates = order.filter((i) => {
      const id = pairs[i]?.id;
      return i !== idx && id != null && !recentIds.has(id);
    });

    let nextIdx: number | null = null;

    if (baseCandidates.length > 0) {
      nextIdx = baseCandidates[0];
    } else {
      // すべてクールダウンに引っかかった → 古い順から緩和
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
  const onManualNext = () => {
    if (pairs.length === 0) return;
    pushRecent(pairs[idx]?.id ?? null);
    setIdx((prev) => {
      const next = prev + 1;
      return next >= pairs.length ? 0 : next;
    });
    setRevealed(false);
  };

  const onAutoNext = () => {
    goNextPrioritized();
  };

  // 正解/不正の記録（書き込みは snake）
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

    setSessionIncrement((prev) => ({
      correct: prev.correct + (kind === "correct" ? 1 : 0),
      tried: prev.tried + 1,
    }));

    try {
      const skillTags: string[] = [];
      if (selectedTopicId != null) skillTags.push(`topic:${selectedTopicId}`);
      skillTags.push(`dir:${dir}`);

      await recordAttemptSrv({
        menuId: MENU_ID_SNAKE, // "news_vocab"
        isCorrect: kind === "correct",
        itemId: card.id,
        skillTags,
        meta: { dir, topic_id: selectedTopicId ?? undefined },
        userId: uid ?? "local",
      });
    } catch (e) {
      console.warn("[recordAttempt] failed:", e);
    }
    goNextPrioritized();
  };
  const hotkeysEnabled =
    selectedTopicId !== null &&
    mode === "drill" &&
    !loadingPairs &&
    pairs.length > 0;

  // ホットキー登録
  useDrillHotkeys({
    enabled: hotkeysEnabled,
    revealed,
    setRevealed,
    onCorrect: () => void mark("correct"),
    onWrong: () => void mark("wrong"),
    onNext: onAutoNext,
    onPrev,
  });
  // 進捗保存（UI モジュールは kebab）
  useEffect(() => {
    if (!card || !selectedTopicId || !uid) return;
    void saveProgressSrv({
      moduleId: UI_MODULE_ID, // "news-vocab"
      context: { topic_id: selectedTopicId, dir },
      lastItemId: card.id,
    });
  }, [card, dir, selectedTopicId, uid]);

  // ===== ヘッダー表示用：サーバ上の累計 正解/試行（kebab + snake 合算） =====
  const [sessionTotal, setSessionTotal] = useState<{
    correct: number;
    tried: number;
  }>({
    correct: 0,
    tried: 0,
  });
  const [sessionIncrement, setSessionIncrement] = useState<{
    correct: number;
    tried: number;
  }>({ correct: 0, tried: 0 });
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
          .in("menu_id", [UI_MODULE_ID, MENU_ID_SNAKE]); // 両方
        if (error) throw error;
        const correct = data?.filter((a) => a.is_correct).length ?? 0;
        const tried = data?.length ?? 0;
        setSessionTotal({ correct, tried });
      } catch (e) {
        console.warn("[load session total] failed:", e);
      }
    })();
  }, [uid]);

  useEffect(() => {
    setSessionIncrement({ correct: 0, tried: 0 });
  }, [uid]);

  const totalCorrect = sessionTotal.correct + sessionIncrement.correct;
  const totalTried = sessionTotal.tried + sessionIncrement.tried;
  const acc = totalTried ? Math.round((totalCorrect / totalTried) * 100) : 0;

  return (
    <div className="min-h-svh bg-white">
      {/* ヘッダー */}
      <header className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-5xl px-4 py-3 flex flex-wrap gap-3 items-center justify-between">
          <h1 className="text-lg font-bold">📰 時事単語</h1>

          <div className="flex items-center gap-2">
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
            <div className="text-sm text-slate-600">
              正答 {totalCorrect} / {totalTried}（{acc}%）
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
              onNext={onManualNext}
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
  stats: Record<number, DirStat>;
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
            className="rounded-xl border px-4 py-2 text-sm hover:bg-slate-50"
            onClick={onNext}
          >
            次へ →
          </button>
        </div>
      </div>
    </section>
  );
}
