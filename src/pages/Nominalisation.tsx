import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
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
   名詞化ジム（TSV: /src/data/nominalisations/nominalisations_part1~7.tsv）
   GUIは NewsVocab と同等。トピックUIのみ変更：
   ラベル→「名詞化単語セット」、小項目は出さず「パート①〜⑦」ボタンのみ。
   ドリルは「名詞化前の語」を提示し、「名詞化を表示」で解答をめくる。
   正誤の優先出題ロジックは NewsVocab と同じ（未出題→正解0→… / 後半は低正答率優先）。
   ========================================================= */

// 固定：ローカルTSVの配置（Vite相対URL）
const PARTS = Array.from({ length: 7 }, (_, i) => i + 1);
const PART_LABEL = (n: number) => `パート${"①②③④⑤⑥⑦"[n - 1]}`;

// Supabase/メトリクス用ID（型エラー回避: metrics 側の MenuId に合わせる）
const MENU_ID: MenuId = "nominalisation";
const UI_MODULE_ID = "nominalisation" as const; // progress系API用（リテラル型で一致させる）拠）

// 1セッション当たりの上限（NewsVocab と同じ 20）
const LIMIT_PAIRS = 100;
// 直近抑制（直前カードの重複出現を防ぐ）
const COOLDOWN_N = 1;
// Markdownの太字マーカー(** .... **)等を除去
const stripMdBold = (s: string) =>
  s.replace(/\*\*/g, "").replace(/\*/g, "").trim();

// TSV の1行をアプリ内部のペアに
export type NomPair = {
  id: number;
  base: string; // 名詞化前（提示）
  nominal: string; // 名詞化（解答）
  ja?: string; // 任意：日本語訳がTSVにあれば保持
};

// UI内の統計（片方向のみ）
export type Stat = { correct: number; wrong: number };

async function fetchServerCounts(itemIds: number[]) {
  try {
    const map = await getCountsForItemsSrv("nominalisation", itemIds);
    return map as Map<number, { correct: number; wrong: number }>;
  } catch (e) {
    console.warn("[getCountsForItemsSrv] failed:", e);
    return new Map<number, { correct: number; wrong: number }>();
  }
}
// TSV ローダ（カラム名に柔軟対応：source/元の単語（品詞）, nominal/名詞化形, ja/日本語訳 など）
async function loadPart(n: number): Promise<NomPair[]> {
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

  // 先頭行のBOMを除去してからタブ分割
  const firstLine = lines[0].replace(/^\uFEFF/, "");
  const header = firstLine.split("\t").map((h) => h.trim());

  const idxOf = (names: string[]) =>
    header.findIndex((h) =>
      names.some((nm) => h.toLowerCase() === nm.toLowerCase())
    );

  // 代表的な候補名（大文字小文字非依存）
  const iId = idxOf(["id", "item_id"]); // ★ 追加
  const iBase = idxOf(["source", "元の単語（品詞）", "base", "原語"]);
  const iNom = idxOf(["nominal", "名詞化形", "名詞化", "noun"]);
  const iJa = idxOf(["ja", "日本語訳", "jp"]);

  // ヘッダ有無判定（base と nominal が見つかればヘッダあり扱い）
  const hasHeader = iBase !== -1 && iNom !== -1;

  const body = hasHeader ? lines.slice(1) : lines;
  const pairs: NomPair[] = [];

  body.forEach((row, lineIdx) => {
    // タブ区切りで分割（TSV）
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

    if (!base || !nominal) return; // 欠損行はスキップ

    // 元の語の **...** を除去
    base = stripMdBold(base);

    // ★ id の安定化：id列があれば優先、なければ従来の合成ID
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
}

export default function NominalisationsGym() {
  // 認証（メトリクス送信用）
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

  // トピック相当：今回は「名詞化単語セット」固定で、パート①〜⑦のみ
  const BIG_LABEL = "名詞化単語セット";
  const [selectedBigCat, setSelectedBigCat] = useState<string>(BIG_LABEL);
  const [selectedPart, setSelectedPart] = useState<number | null>(null);

  // モード（親で保持して子に渡す：any回避）
  const [mode, setMode] = useState<"drill" | "list">("drill");

  // ペア & ローディング
  const [pairs, setPairs] = useState<NomPair[]>([]);
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

  //selectedPart が変わった瞬間に前パートの表示状態をクリア
  useEffect(() => {
    if (selectedPart == null) return;
    setPairs([]); // 表示を消す
    setStats({}); // 統計をリセット
    setReady(false);
    setIdx(-1); // ★ 未決定を明示
    setRevealed(false);
    clearRecent(); // クールダウンもクリア
    setLoadingPairs(true); // ロード中表示にする（ちらつき防止）
  }, [selectedPart]);

  // パート変更時に読み込み（あなたの既存 useEffect を一部だけ置換）
  useEffect(() => {
    if (!selectedPart) return;
    (async () => {
      try {
        const data = await loadPart(selectedPart);
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
          if (err instanceof Error) {
            console.warn("[fetchServerCounts] merge failed:", err);
          } else {
            console.warn("[fetchServerCounts] merge failed:", String(err));
          }
        }
        setStats(mergedStats);

        // 進捗復元（あれば優先）
        let restored = false;
        if (uid) {
          try {
            const prog = await loadProgressSrv(UI_MODULE_ID, {
              topic_id: selectedPart,
              dir: "BASE2NOM",
            });
            if (prog?.last_item_id) {
              const i = limited.findIndex((x) => x.id === prog.last_item_id);
              if (i >= 0) {
                setIdx(i);
                restored = true;
              }
            }
          } catch (err: unknown) {
            if (err instanceof Error) {
              console.warn("[loadProgressSrv] failed:", err);
            } else {
              console.warn("[loadProgressSrv] failed:", String(err));
            }
          }
        }

        // 未復元なら優先順の先頭で開始
        if (!restored) {
          const first = pickFirstIndexByPriority(limited, mergedStats);
          setIdx(first);
        }

        setRevealed(false);
        setReady(true); // ★ ここで描画OKに
      } finally {
        setLoadingPairs(false); // ★ 最後に解除
      }
    })();
  }, [selectedPart, uid]);

  // 現カード
  const card = pairs[idx] ?? null;

  // 出題優先（NewsVocabのロジックと同様の2フェーズ）
  const sortedIndices = () => {
    const attempts = (s: Stat) => s.correct + s.wrong;
    const indices = pairs.map((_, i) => i);

    // 全カードが「少なくとも1回は正解している」か？
    const allHaveAtLeastOneCorrect = pairs.every(
      (p) => (stats[p.id]?.correct ?? 0) >= 1
    );

    if (!allHaveAtLeastOneCorrect) {
      // フェーズ1: 未出題 → 正解0 → 試行少 → 間違い多 → 安定タイブレーク
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

        if (aAtt !== bAtt) return aAtt - bAtt; // 試行が少ないほど先
        if (sa.wrong !== sb.wrong) return sb.wrong - sa.wrong; // 間違いが多いほど先
        return a - b; // 安定ソート
      });
    } else {
      // フェーズ2: 正答率の低い順 → 試行少 → 安定タイブレーク
      return indices.sort((a, b) => {
        const sa = stats[pairs[a].id] ?? { correct: 0, wrong: 0 };
        const sb = stats[pairs[b].id] ?? { correct: 0, wrong: 0 };

        const accA = sa.correct / Math.max(1, sa.correct + sa.wrong);
        const accB = sb.correct / Math.max(1, sb.correct + sb.wrong);
        if (accA !== accB) return accA - accB; // 低いほど先

        const aAtt = sa.correct + sa.wrong;
        const bAtt = sb.correct + sb.wrong;
        if (aAtt !== bAtt) return aAtt - bAtt; // 試行が少ないほど先
        return a - b;
      });
    }
  };

  // 直近重複の抑制を維持しつつ、優先順に沿って次カードを選ぶ
  const goNextPrioritized = () => {
    if (pairs.length === 0) return;

    const order = sortedIndices();
    const recentIds = new Set(recentRef.current);

    // まずは「現在カード以外」かつ「クールダウン対象外」から候補
    const baseCandidates = order.filter((i) => {
      const id = pairs[i]?.id;
      return i !== idx && id != null && !recentIds.has(id);
    });

    let nextIdx: number | null = null;

    if (baseCandidates.length > 0) {
      nextIdx = baseCandidates[0];
    } else {
      // 全部がクールダウンにかかった → 古い順から緩和して再探索
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
        skillTags: ["nominalisation"],
        meta: { dir: "BASE2NOM" },
        userId: uid ?? "local",
      });
    } catch (e) {
      console.warn("[recordAttempt] failed", e);
    }
    goNextPrioritized();
  };

  // 進捗保存（ログイン時）
  useEffect(() => {
    if (!card || !selectedPart || !uid) return;
    void saveProgressSrv({
      moduleId: UI_MODULE_ID,
      context: { topic_id: selectedPart, dir: "BASE2NOM" },
      lastItemId: card.id,
    });
  }, [card, selectedPart, uid]);

  // セッション内合計
  const totalCorrect = useMemo(
    () => Object.values(stats).reduce((a, s) => a + s.correct, 0),
    [stats]
  );
  const totalTried = useMemo(
    () => Object.values(stats).reduce((a, s) => a + s.correct + s.wrong, 0),
    [stats]
  );
  const acc = totalTried ? Math.round((totalCorrect / totalTried) * 100) : 0;
  useDrillHotkeys({
    enabled:
      selectedPart !== null &&
      mode === "drill" &&
      !loadingPairs &&
      pairs.length > 0,
    revealed,
    setRevealed,
    onCorrect: () => void onMark("correct"),
    onWrong: () => void onMark("wrong"),
    onNext: onAutoNext,
    onPrev,
  });
  return (
    <div className="min-h-svh bg-white">
      {/* ヘッダー */}
      <header className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-5xl px-4 py-3 flex flex-wrap gap-3 items-center justify-between">
          <h1 className="text-lg font-bold">✍️ 名詞化ジム</h1>
          <div className="flex items-center gap-2">
            {/* モード切替（親の state を渡す） */}
            <ModeToggle mode={mode} setMode={setMode} />
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

      <main className="mx-auto max-w-5xl px-4 py-6">
        {/* トピック選択（大項目→パート） */}
        <section>
          <label className="block text-sm text-slate-600">
            名詞化単語セット
          </label>

          {/* 大項目（固定1種だがUI揃えのためボタン風） */}
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              className={[
                "chip",
                selectedBigCat === BIG_LABEL ? "ring-2 ring-rose-200" : "",
                "bg-yellow-100 text-yellow-800 border-yellow-300",
              ].join(" ")}
              onClick={() => setSelectedBigCat(BIG_LABEL)}
              title={BIG_LABEL}
            >
              <span className="font-medium">{BIG_LABEL}</span>
            </button>
          </div>

          {/* 小項目は無し → 代わりにパート選択 */}
          <div className="mt-4 text-xs text-slate-500">{BIG_LABEL} の収録</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {PARTS.map((n) => {
              const active = n === selectedPart;
              return (
                <button
                  key={n}
                  className={`chip ${active ? "ring-2 ring-blue-200" : ""}`}
                  onClick={() => setSelectedPart(n)}
                  title={PART_LABEL(n)}
                >
                  <span className="font-medium">{PART_LABEL(n)}</span>
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
                {selectedPart
                  ? `${BIG_LABEL} — ${PART_LABEL(selectedPart)}`
                  : `${BIG_LABEL} — （パートを選択してください）`}
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

        {/* モード表示（パート未選択なら案内） */}
        {selectedPart ? (
          !ready || loadingPairs ? (
            <div className="mt-8 text-slate-500">語彙を読み込み中…</div>
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
              onNext={onManualNext}
              onCorrect={() => void onMark("correct")}
              onWrong={() => void onMark("wrong")}
            />
          ) : (
            <div className="mt-8 text-slate-500">語彙がありません</div>
          )
        ) : (
          <div className="mt-8 text-slate-500">
            パートを選択すると語彙が表示されます
          </div>
        )}
      </main>
    </div>
  );
}

/* ===== UI: ドリル/一覧 モード切替（NewsVocabと同等の見た目） ===== */
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

/* ===== コンテンツ切替（ドリル or 一覧） ===== */
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
  pairs: NomPair[];
  loading: boolean;
  stats: Record<number, Stat>;
  card: NomPair | null;
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
  pairs: NomPair[];
  loading: boolean;
  stats: Record<number, Stat>;
}) {
  if (loading)
    return <div className="mt-6 text-slate-500">語彙を読み込み中…</div>;
  if (!pairs.length)
    return <div className="mt-6 text-slate-500">語彙がありません</div>;

  return (
    <ul className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-3">
      {pairs.map((p) => {
        const s = stats[p.id] ?? { correct: 0, wrong: 0 };
        return (
          <li key={p.id} className="glass-card">
            <div className="font-medium">{p.base}</div>
            <div className="text-slate-600">{p.nominal}</div>
            {p.ja && <div className="text-xs text-slate-500">{p.ja}</div>}
            <div className="mt-1 text-xs text-slate-500">
              ✅ {s.correct} / ❌ {s.wrong}
            </div>
            selectedPart
          </li>
        );
      })}
    </ul>
  );
}

function pickFirstIndexByPriority(
  pairs: NomPair[],
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

      if (aAtt !== bAtt) return aAtt - bAtt; // 試行が少ないほど先
      if (sa.wrong !== sb.wrong) return sb.wrong - sa.wrong; // 間違いが多いほど先
      return a - b;
    });
  } else {
    indices.sort((a, b) => {
      const sa = stats[pairs[a].id] ?? { correct: 0, wrong: 0 };
      const sb = stats[pairs[b].id] ?? { correct: 0, wrong: 0 };
      const accA = sa.correct / Math.max(1, sa.correct + sa.wrong);
      const accB = sb.correct / Math.max(1, sb.correct + sb.wrong);
      if (accA !== accB) return accA - accB; // 低いほど先
      const aAtt = sa.correct + sa.wrong;
      const bAtt = sb.correct + sb.wrong;
      if (aAtt !== bAtt) return aAtt - bAtt; // 試行が少ないほど先
      return a - b;
    });
  }
  return indices[0] ?? 0;
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
  stat,
  onCorrect,
  onWrong,
}: {
  card: NomPair | null;
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

  const prompt = card.base; // 名詞化前
  const answer = card.nominal; // 名詞化

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
              名詞化を表示
            </button>
          ) : (
            <>
              <div className="mt-4 text-xl text-slate-700">{answer}</div>
              {card.ja && (
                <div className="mt-1 text-base text-slate-600">
                  （{card.ja}）
                </div>
              )}
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
