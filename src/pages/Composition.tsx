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
import { useDrillHotkeys } from "../hooks/useDrillHotkeys";

/* =========================================================
    仏作文ドリル（JA → FR）
    - データ: /src/data/Composition/compositionList.tsv
    - 一方向（日本語 → フランス語）のみ
    - UI/挙動は Nominalisation と同等（パート無しの単一リスト）
    ========================================================= */

type CompPair = { id: number; ja: string; fr: string };
type Stat = { correct: number; wrong: number };

const MENU_ID: MenuId = "composition";
const UI_MODULE_ID = "composition" as const;

const LIMIT_PAIRS = 1000; // 充分大きく
const COOLDOWN_N = 1;

/* ===== デバッグ情報（右下にドック表示） ===== */
type DebugInfo = {
  enabled: boolean;
  url: string;
  status?: number;
  ok?: boolean;
  sep?: "\\t" | "," | "unknown";
  hasHeader?: boolean;
  iId?: number;
  iJa?: number;
  iFr?: number;
  rawHead?: string[];
  parsedCount?: number;
  sample?: Array<{ id: number; ja: string; fr: string }>;
  error?: string;
};

const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : String(e);

/* ===== TSV ローダ（メタ行/区切り自動判定/ヘッダ柔軟） ===== */
async function loadAll(
  setDebug: React.Dispatch<React.SetStateAction<DebugInfo>>
): Promise<CompPair[]> {
  const url = new URL(
    "../data/Composition/compositionList.tsv",
    import.meta.url
  ).toString();

  setDebug((d) => ({ ...d, url, error: undefined }));

  let res: Response;
  try {
    res = await fetch(url);
  } catch (e: unknown) {
    const msg = `[Composition] fetch throw: ${errorMessage(e)}`;
    console.error(msg);
    setDebug((d) => ({ ...d, status: -1, ok: false, error: msg }));
    return [];
  }

  setDebug((d) => ({ ...d, status: res.status, ok: res.ok }));

  if (!res.ok) {
    const msg = `[Composition] fetch failed: ${res.status} ${url}`;
    console.error(msg);
    return [];
  }

  let raw = await res.text();
  const rawHead = raw.split(/\r?\n/).slice(0, 5);
  // console.log("[Composition] raw head:", rawHead);

  // BOM除去 + 改行正規化
  raw = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");

  // 空行・#コメント除去
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));

  if (lines.length === 0) {
    setDebug((d) => ({ ...d, rawHead, parsedCount: 0 }));
    return [];
  }

  // 区切り自動判定（タブ優先、なければカンマ）
  const sep: "\t" | "," = lines.some((l) => l.includes("\t")) ? "\t" : ",";
  const sepLabel = sep === "\t" ? "\\t" : ",";

  // ヘッダ推定
  const header = lines[0].split(sep).map((h) => h.trim());
  const iId = header.findIndex((h) => /^(id|item_id)$/i.test(h));
  const iJa = header.findIndex((h) => /^(ja|日本語|jp|japanese)$/i.test(h));
  const iFr = header.findIndex((h) =>
    /^(fr|français|フランス語|フランス語訳|仏文)$/i.test(h)
  );

  const hasHeader = iJa !== -1 && iFr !== -1;
  const body = hasHeader ? lines.slice(1) : lines;

  const out: CompPair[] = [];
  body.forEach((row, lineIdx) => {
    const cols = row.split(sep);
    const ja = (hasHeader ? cols[iJa] : cols[0])?.trim();
    const fr = (hasHeader ? cols[iFr] : cols[1])?.trim();
    if (!ja || !fr) return;

    let id: number;
    if (hasHeader) {
      const rawId = iId !== -1 ? cols[iId]?.trim() : undefined;
      const n = rawId ? Number(rawId) : NaN;
      id = Number.isFinite(n) ? n : 1_000_000 + (lineIdx + 1);
    } else {
      id = 1_000_000 + (lineIdx + 1);
    }
    out.push({ id, ja, fr });
  });

  setDebug((d) => ({
    ...d,
    sep: sepLabel as DebugInfo["sep"],
    hasHeader,
    iId,
    iJa,
    iFr,
    rawHead,
    parsedCount: out.length,
    sample: out.slice(0, 3),
  }));

  //console.log("[Composition] parsed count:", out.length);
  return out;
}

/* ===== サーバ集計をマージ取得 ===== */
async function fetchServerCounts(itemIds: number[]) {
  try {
    const map = await getCountsForItemsSrv("composition", itemIds);
    return map as Map<number, { correct: number; wrong: number }>;
  } catch (e) {
    console.warn("[getCountsForItemsSrv] failed:", e);
    return new Map<number, { correct: number; wrong: number }>();
  }
}

/* ===== 優先度計算（Nominalisation と同等） ===== */
function pickFirstIndexByPriority(
  pairs: CompPair[],
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

export default function Composition() {
  /* ==== 認証（uid 取得） ==== */
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

  /* ==== デバッグ ==== */
  // const [debug, setDebug] = useState<DebugInfo>({
  const [, setDebug] = useState<DebugInfo>({
    enabled: false, // 必要に応じて false に
    url: "",
  });

  /* ==== セッション時間 ==== */
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

  /* ==== データ読み込み ==== */
  const [pairs, setPairs] = useState<CompPair[]>([]);
  const [loadingPairs, setLoadingPairs] = useState(false);

  useEffect(() => {
    (async () => {
      setLoadingPairs(true);
      try {
        // ★ 先に表示状態をクリアして先頭カードのフラッシュを防ぐ
        setIdx(-1);
        setRevealed(false);
        recentRef.current = [];

        const data = await loadAll(setDebug);
        const limited = data.slice(0, LIMIT_PAIRS);
        setPairs(limited);

        // ゼロ初期化
        const zero: Record<number, Stat> = {};
        for (const p of limited) zero[p.id] = { correct: 0, wrong: 0 };

        // サーバ counts をマージ
        const merged: Record<number, Stat> = { ...zero };
        try {
          const ids = limited.map((p) => p.id);
          const serverMap = await fetchServerCounts(ids);
          for (const p of limited) {
            const s = serverMap.get(p.id);
            if (s) merged[p.id] = { correct: s.correct, wrong: s.wrong };
          }
        } catch (e) {
          console.warn("[composition] fetchServerCounts merge failed:", e);
        }
        setStats(merged);

        // 進捗復元（ログイン時）
        if (uid && limited.length > 0) {
          try {
            const prog = await loadProgressSrv(UI_MODULE_ID, {
              dir: "JA2FR",
            });
            if (prog?.last_item_id) {
              const i = limited.findIndex((x) => x.id === prog.last_item_id);
              if (i >= 0) {
                setIdx(i);
                setRevealed(false);
                return;
              }
            }
          } catch (e) {
            console.warn("[composition] loadProgress failed:", e);
          }
        }

        // 復元できなければ優先順の先頭
        if (limited.length > 0) {
          const first = pickFirstIndexByPriority(limited, merged);
          setIdx(first);
          setRevealed(false);
        }
      } catch (e: unknown) {
        console.error("[composition] loadAll failed:", e);
        setDebug((d) => ({ ...d, error: errorMessage(e) }));
        setPairs([]);
      } finally {
        setLoadingPairs(false);
      }
    })();
  }, [uid]);

  /* ==== ドリル状態 ==== */
  const [mode, setMode] = useState<"drill" | "list">("drill");
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [stats, setStats] = useState<Record<number, Stat>>({});

  // 直近抑制
  const recentRef = useRef<number[]>([]);
  const pushRecent = (id: number | null) => {
    if (id == null) return;
    const arr = recentRef.current;
    const i = arr.indexOf(id);
    if (i !== -1) arr.splice(i, 1);
    arr.push(id);
    while (arr.length > COOLDOWN_N) arr.shift();
  };

  // 現カード
  const card = pairs[idx] ?? null;

  // 並び替え作成
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
    goNextPrioritized();
  };

  const onManualNext = () => {
    if (pairs.length === 0) return;
    setIdx((prev) => {
      const next = prev + 1;
      return next >= pairs.length ? 0 : next;
    });
    setRevealed(false);
  };

  const onMark = async (kind: "correct" | "wrong") => {
    // 認証前（uid未取得）の書き込みを防止
    if (!uid) {
      console.warn("UID is not ready. Skipping mark action.");
      return;
    }

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
        skillTags: ["composition"],
        meta: { dir: "JA2FR" },
        alsoLocal: {
          userId: uid, // 'local' ではなく 'uid' を渡す
          localSkillTags: ["vocab:composition", "dir:JA2FR"],
        },
      });
    } catch (e) {
      console.warn("[composition] recordAttempt failed", e);
    }
    goNextPrioritized();
  };

  // 進捗保存（ログイン時）
  useEffect(() => {
    if (!card || !uid) return;
    void saveProgressSrv({
      moduleId: UI_MODULE_ID,
      context: { dir: "JA2FR" },
      lastItemId: card.id,
    });
  }, [card, uid]);

  // 集計
  const totalCorrect = useMemo(
    () => Object.values(stats).reduce((a, s) => a + s.correct, 0),
    [stats]
  );
  const totalTried = useMemo(
    () => Object.values(stats).reduce((a, s) => a + s.correct + s.wrong, 0),
    [stats]
  );
  const acc = totalTried ? Math.round((totalCorrect / totalTried) * 100) : 0;

  // Hotkeys
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
          <h1 className="text-lg font-bold">📝 仏作文</h1>
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
        <section className="mt-2">
          <div className="glass-card flex items-center justify-between">
            <div className="text-sm text-slate-500">
              収録数：{loadingPairs ? "…" : pairs.length} 件
            </div>
          </div>
        </section>

        {/* 本体 */}
        {loadingPairs ? (
          <div className="mt-8 text-slate-500">データを読み込み中…</div>
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
            onManualNext={onManualNext}
            onCorrect={() => void onMark("correct")}
            onWrong={() => void onMark("wrong")}
          />
        ) : (
          <div className="mt-8 text-slate-500">データがありません</div>
        )}
      </main>
    </div>
  );
}

/* ===== UI: ドリル/一覧 切替 ===== */
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
  onManualNext,
  onCorrect,
  onWrong,
}: {
  mode: "drill" | "list";
  pairs: CompPair[];
  loading: boolean;
  stats: Record<number, Stat>;
  card: CompPair | null;
  idx: number;
  total: number;
  revealed: boolean;
  setRevealed: (v: boolean) => void;
  onPrev: () => void;
  onManualNext: () => void;
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
      onNext={onManualNext}
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

/* ===== 一覧ビュー ===== */
function ListView({
  pairs,
  loading,
  stats,
}: {
  pairs: CompPair[];
  loading: boolean;
  stats: Record<number, Stat>;
}) {
  if (loading) return <div className="mt-6 text-slate-500">読み込み中…</div>;
  if (!pairs.length)
    return <div className="mt-6 text-slate-500">データがありません</div>;

  return (
    <ul className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-3">
      {pairs.map((p) => {
        const s = stats[p.id] ?? { correct: 0, wrong: 0 };
        return (
          <li key={p.id} className="glass-card">
            <div className="font-medium">{p.ja}</div>
            <div className="text-slate-600">{p.fr}</div>
            <div className="mt-1 text-xs text-slate-500">
              ✅ {s.correct} / ❌ {s.wrong}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ===== ドリルビュー ===== */
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
  card: CompPair | null;
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

  const prompt = card.ja; // 日本語（提示）
  const answer = card.fr; // フランス語（解答）

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
              仏作文を表示
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
            // (※「次へ」は常に押せるように disabled={idx >= total - 1} を削除)
          >
            次へ →
          </button>
        </div>
      </div>
    </section>
  );
}
