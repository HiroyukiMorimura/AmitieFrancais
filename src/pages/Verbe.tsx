import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import type { UIModuleId, MenuId } from "../lib/metricsClient";

import {
  startSession,
  endSession,
  recordAttempt as recordAttemptSrv,
  saveProgress as saveProgressSrv,
  loadProgress as loadProgressSrv,
  getCountsForItemsByDir as getCountsForItemsByDirSrv,
} from "../lib/metricsClient";

import { useDrillHotkeys } from "../hooks/useDrillHotkeys";

/* =========================================================
    Verbe（動詞ジム）: 日本語⇄フランス語
    データ:
      - 通常動詞:  /src/data/verbe/verbesNormalesList-1..5.tsv
      - 再帰動詞:  /src/data/verbe/verbesProminauxList-1..2.tsv
    仕様:
      - Nominalisation.tsx の UI/ローディング方針を踏襲
      - グループ（カテゴリ×パート）を選ぶと、その TSV（51/50語）が読み込まれる
      - 正誤の優先出題/直近抑制/ホットキーは従来 Verbe と同じ
      - 書き込み menu_id は snake_case（"verbe"）
      - moduleId は kebab 同名（"verbe"）
      - 方向別（JA2FR / FR2JA）で記録・集計
    ========================================================= */

type DrillDir = "JA2FR" | "FR2JA";

type Category = "normal" | "refl"; // 通常 / 再帰

const CAT_LABEL: Record<Category, string> = {
  normal: "動詞セット（通常）",
  refl: "再帰動詞セット",
};

const PARTS: Record<Category, number[]> = {
  normal: [1, 2, 3, 4, 5],
  refl: [1, 2],
};

const PART_LABEL = (cat: Category, n: number) =>
  (cat === "normal" ? "動詞" : "再帰動詞") + "" + "①②③④⑤⑥⑦"[n - 1];

// 書き込みは snake に統一（過去データ互換のため）
const MENU_ID_SNAKE = "verbe" as const;
const MENU_AS_MENU = MENU_ID_SNAKE as unknown as MenuId;
// UI / 進捗は kebab（今回も同名でOK）
const UI_MODULE_ID = "verbe" as const;
const UI_AS_UI = UI_MODULE_ID as unknown as UIModuleId;

const LIMIT_PAIRS = 200; // TSVは51/50だが安全側
const COOLDOWN_N = 1; // 直近抑制

export type Pair = {
  id: number; // ★ カテゴリ/パート由来の安定ID（衝突防止）
  ja: string;
  fr: string;
};

export type Stat = { correct: number; wrong: number };
export type DirStat = { JA2FR: Stat; FR2JA: Stat };

/* ------------------ TSV ローダ ------------------ */
function buildFileName(cat: Category, part: number) {
  if (cat === "normal") return `verbesNormalesList-${part}.tsv`;
  return `verbesProminauxList-${part}.tsv`; // ユーザー指定どおり "Prominaux"
}

function buildUrl(cat: Category, part: number) {
  return new URL(
    `../data/verbe/${buildFileName(cat, part)}`,
    import.meta.url
  ).toString();
}

function idxOf(header: string[], names: string[]) {
  return header.findIndex((h) =>
    names.some((nm) => h.toLowerCase() === nm.toLowerCase())
  );
}

// TSVのヘッダは「フランス語\t日本語」or "fr\tja" を想定。柔軟に同定。
async function loadGroup(cat: Category, part: number): Promise<Pair[]> {
  const text = await fetch(buildUrl(cat, part)).then((r) => {
    if (!r.ok) throw new Error(`TSV load failed: ${buildFileName(cat, part)}`);
    return r.text();
  });

  const lines = text.trim().split(/\r?\n/);
  if (!lines.length) return [];

  const first = lines[0].replace(/^\uFEFF/, "");
  const header = first.split("\t").map((h) => h.trim());

  const iFR = idxOf(header, ["fr", "français", "フランス語"]);
  const iJA = idxOf(header, ["ja", "japonais", "日本語"]);
  const hasHeader = iFR !== -1 && iJA !== -1;
  const body = hasHeader ? lines.slice(1) : lines;

  const out: Pair[] = [];
  body.forEach((row, lineIdx) => {
    const cols = row.split("\t");

    let fr: string | undefined;
    let ja: string | undefined;

    if (hasHeader) {
      fr = cols[iFR]?.trim();
      ja = cols[iJA]?.trim();
    } else {
      // ヘッダが無い場合は [fr, ja] 前提（今回のデータ作成方針に合わせる）
      fr = cols[0]?.trim();
      ja = cols[1]?.trim();
    }

    if (!fr || !ja) return;

    // ★ 安定ID: cat(1/2) * 1e6 + part * 1e4 + 行番号
    const catCode = cat === "normal" ? 1 : 2;
    const id = catCode * 1_000_000 + part * 10_000 + (lineIdx + 1);

    out.push({ id, fr, ja });
  });
  return out;
}

/* ------------------ サーバ集計（kebab+snake 合算） ------------------ */
/* ------------------ サーバ集計 ------------------ */
async function fetchCountsByDir(
  itemIds: number[]
): Promise<Map<number, DirStat>> {
  // UI_AS_UI ("verbe") を指定すれば、supaMetrics 側で snake_case ("verbe") も含めて合算されるため
  // ここで手動マージする必要はない。
  // 以前は snake と kebab を別々に fetch して足し合わせていたが、
  // IDが同一 ("verbe") のためダブルカウントになっていた問題を修正。

  const res = await getCountsForItemsByDirSrv(UI_AS_UI, itemIds, "JA2FR").catch(
    () => new Map<number, Stat>()
  );
  const res2 = await getCountsForItemsByDirSrv(UI_AS_UI, itemIds, "FR2JA").catch(
    () => new Map<number, Stat>()
  );

  const merged = new Map<number, DirStat>();
  for (const id of itemIds) {
    merged.set(id, {
      JA2FR: res.get(id) ?? { correct: 0, wrong: 0 },
      FR2JA: res2.get(id) ?? { correct: 0, wrong: 0 },
    });
  }
  return merged;
}

/* ------------------ ユーティリティ ------------------ */
const zeroDirStat = (): DirStat => ({
  JA2FR: { correct: 0, wrong: 0 },
  FR2JA: { correct: 0, wrong: 0 },
});

export default function Verbe() {
  // 認証（uid は進捗保存・集計のトリガーに使用）
  const [uid, setUid] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth
      .getSession()
      .then((res) => setUid(res.data.session?.user?.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUid(session?.user?.id ?? null);
    });
    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  // セッション計測
  const sessionStartRef = useRef<number | null>(null);
  useEffect(() => {
    (async () => {
      const t0 = await startSession();
      sessionStartRef.current = t0;
    })();
    return () => {
      void endSession(MENU_AS_MENU, sessionStartRef.current);
    };
  }, []);

  // ===== グループ選択（カテゴリ→パート） =====
  const [cat, setCat] = useState<Category>("normal");
  const [part, setPart] = useState<number | null>(null);

  // モード & 向き
  const [mode, setMode] = useState<"drill" | "list">("drill");
  const [dir, setDir] = useState<DrillDir>("JA2FR");

  // データ
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [loadingPairs, setLoadingPairs] = useState(false);

  // ドリル状態
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [processing, setProcessing] = useState(false);

  // 方向別のインメモリ正誤
  const [stats, setStats] = useState<Record<number, DirStat>>({});
  // セッション内での増分（表示用）
  const [sessionDelta, setSessionDelta] = useState({ correct: 0, wrong: 0 });

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
  const clearRecent = () => {
    recentRef.current = [];
  };

  // グループが変わった瞬間に表示状態をクリア
  useEffect(() => {
    if (part == null) return;
    setPairs([]);
    setStats({});
    setIdx(-1);
    setRevealed(false);
    clearRecent();
    clearRecent();
    setLoadingPairs(true);
    // パート変更時はセッション増分はリセットしない（セッション全体での累計なので）
    // ただし、もし「パートごとの正答数」を表示したいならリセットすべきだが、
    // ヘッダーの表示は「Verbe（動詞ドリル）」全体の累計と思われるため維持する。
  }, [cat, part]);

  // グループ変更時に読み込み
  useEffect(() => {
    if (!part) return;
    (async () => {
      try {
        const data = await loadGroup(cat, part);
        const limited = data.slice(0, LIMIT_PAIRS);
        setPairs(limited);

        // サーバの方向別カウント復元
        const itemIds = limited.map((p) => p.id);
        const srv = await fetchCountsByDir(itemIds).catch(
          () => new Map<number, DirStat>()
        );
        const next: Record<number, DirStat> = {};
        for (const p of limited) next[p.id] = srv.get(p.id) ?? zeroDirStat();
        setStats(next);

        // 進捗復元（UI モジュール = kebab）
        let restored = false;
        if (uid) {
          try {
            type Progress = { last_item_id?: number } | null;
            const prog = (await loadProgressSrv(UI_AS_UI, {
              cat,
              part,
              dir,
            })) as Progress;
            if (prog?.last_item_id) {
              const lastId = prog.last_item_id;
              const i = limited.findIndex((x) => x.id === lastId);
              if (i >= 0) {
                setIdx(i);
                restored = true;
              }
            }
          } catch (e) {
            console.warn("[loadProgress] failed:", e);
          }
        }

        if (!restored) {
          // ★★★ 修正点 1：ここから ★★★
          // setIdx(0) せず、優先順位ソートを（`limited` と `next` を使って）実行

          const statFor = (id: number) =>
            next[id]?.[dir] ?? { correct: 0, wrong: 0 };
          const attempts = (s: Stat) => s.correct + s.wrong;

          const allHaveAtLeastOneCorrect = limited.every(
            (p) => (next[p.id]?.[dir]?.correct ?? 0) >= 1
          );
          const indices = limited.map((_, i) => i);

          let sortedIndices: number[];
          if (!allHaveAtLeastOneCorrect) {
            sortedIndices = indices.sort((a, b) => {
              const sa = statFor(limited[a].id);
              const sb = statFor(limited[b].id);
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
            sortedIndices = indices.sort((a, b) => {
              const sa = statFor(limited[a].id);
              const sb = statFor(limited[b].id);
              const accA = sa.correct / Math.max(1, sa.correct + sa.wrong);
              const accB = sb.correct / Math.max(1, sb.correct + sb.wrong);
              if (accA !== accB) return accA - accB;
              const aAtt = sa.correct + sa.wrong;
              const bAtt = sb.correct + sb.wrong;
              if (aAtt !== bAtt) return aAtt - bAtt;
              return a - b;
            });
          }
          // 最初のインデックスをソート結果の0番目に設定
          setIdx(sortedIndices[0] ?? 0);
          // ★★★ 修正点 1：ここまで ★★★
        }
        setRevealed(false);
      } finally {
        setLoadingPairs(false);
      }
    })();
  }, [cat, part, uid, dir]);

  // 現在カード
  const card = pairs[idx] ?? null;

  // 並び替え（2フェーズ）
  const sortedIndices = () => {
    const statFor = (id: number) =>
      stats[id]?.[dir] ?? { correct: 0, wrong: 0 };
    const attempts = (s: Stat) => s.correct + s.wrong;

    const allHaveAtLeastOneCorrect = pairs.every(
      (p) => (stats[p.id]?.[dir]?.correct ?? 0) >= 1
    );
    const indices = pairs.map((_, i) => i);

    if (!allHaveAtLeastOneCorrect) {
      return indices.sort((a, b) => {
        const sa = statFor(pairs[a].id);
        const sb = statFor(pairs[b].id);
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
        const sa = statFor(pairs[a].id);
        const sb = statFor(pairs[b].id);
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
    if (baseCandidates.length > 0) nextIdx = baseCandidates[0];
    else {
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
    if (pairs.length === 0) return;
    goNextPrioritized();
  };

  // 正誤の記録（方向別・snake 書き込み）
  const mark = async (kind: "correct" | "wrong") => {
    // 認証前（uid未取得）の書き込みを防止
    if (!uid) {
      console.warn("UID is not ready. Skipping mark action.");
      return;
    }

    if (!card) return;
    if (processing) return;

    setProcessing(true);

    setStats((prev) => {
      const cur = prev[card.id] ?? zeroDirStat();
      const curDir = cur[dir];
      const updated: Stat =
        kind === "correct"
          ? { correct: curDir.correct + 1, wrong: curDir.wrong }
          : { correct: curDir.correct, wrong: curDir.wrong + 1 };
      return { ...prev, [card.id]: { ...cur, [dir]: updated } };
    });

    setSessionDelta((prev) => ({
      correct: prev.correct + (kind === "correct" ? 1 : 0),
      wrong: prev.wrong + (kind === "wrong" ? 1 : 0),
    }));

    try {
      await recordAttemptSrv({
        menuId: MENU_AS_MENU,
        isCorrect: kind === "correct",
        itemId: card.id,
        skillTags: [
          "vocab:verbe",
          `cat:${cat}`,
          `part:${part ?? "?"}`,
          `dir:${dir}`,
        ],
        meta: { cat, part, dir },
        userId: uid,
      });
    } catch (e) {
      console.warn("[recordAttempt] failed", e);
    }
    goNextPrioritized();
    setProcessing(false);
  };

  // 進捗保存（UI モジュールは kebab）
  useEffect(() => {
    if (!card || !uid || part == null) return;
    void saveProgressSrv({
      moduleId: UI_AS_UI,
      context: { cat, part, dir },
      lastItemId: card.id,
    });
  }, [card, cat, part, dir, uid]);

  // ===== ヘッダー表示用：サーバ上の累計 正解/試行（kebab + snake 合算） =====
  const [sessionTotal, setSessionTotal] = useState<{
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
          .in("menu_id", [UI_MODULE_ID as unknown as string, MENU_ID_SNAKE]);
        if (error) throw error;
        type AttemptsRow = { is_correct: boolean; menu_id: string };
        const rows: AttemptsRow[] = (data ?? []) as AttemptsRow[];
        const correct = rows.filter((r) => r.is_correct).length;
        const tried = rows.length;
        setSessionTotal({ correct, tried });
      } catch (e) {
        console.warn("[load session total] failed:", e);
      }
    })();
  }, [uid]);

  // 今セッションで増えた分（UI内）
  // const sessionIncrement = ... (削除: stats を集計すると過去分も含まれてしまうため)

  const totalCorrect = sessionTotal.correct + sessionDelta.correct;
  const totalTried =
    sessionTotal.tried + sessionDelta.correct + sessionDelta.wrong;
  const acc = totalTried ? Math.round((totalCorrect / totalTried) * 100) : 0;

  // ホットキー
  useDrillHotkeys({
    enabled:
      part !== null &&
      mode === "drill" &&
      !loadingPairs &&
      pairs.length > 0 &&
      !processing,
    revealed,
    setRevealed,
    onCorrect: () => void mark("correct"),
    onWrong: () => void mark("wrong"),
    onNext: onAutoNext,
    onPrev,
  });



  return (
    <div className="min-h-svh bg-white">
      {/* ヘッダー */}
      <header className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-5xl px-4 py-3 flex flex-wrap gap-3 items-center justify-between">
          <h1 className="text-lg font-bold">🔤 Verbe（動詞ジム）</h1>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span>
              正答 {totalCorrect} / {totalTried}（{acc}%）
            </span>
          </div>

          <div className="flex gap-2">
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

      <main className="mx-auto max-w-5xl px-4 py-6">
        {/* グループ選択（カテゴリ→パート） */}
        <section>
          <label className="block text-sm text-slate-600">
            動詞セットの選択
          </label>

          {/* 大項目：カテゴリ */}
          <div className="mt-2 flex flex-wrap gap-2">
            {(Object.keys(CAT_LABEL) as Category[]).map((c) => (
              <button
                key={c}
                className={[
                  "chip",
                  c === cat ? "ring-2 ring-blue-200" : "",
                  c === "normal"
                    ? "bg-blue-50 text-blue-800 border-blue-200"
                    : "bg-violet-50 text-violet-800 border-violet-200",
                ].join(" ")}
                onClick={() => {
                  setCat(c);
                  setPart(null); // パート再選択を促す
                }}
                title={CAT_LABEL[c]}
              >
                <span className="font-medium">{CAT_LABEL[c]}</span>
              </button>
            ))}
          </div>

          {/* 小項目：パート */}
          <div className="mt-4 text-xs text-slate-500">
            {CAT_LABEL[cat]} の収録
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {PARTS[cat].map((n) => {
              const active = n === part;
              return (
                <button
                  key={n}
                  className={`chip ${active ? "ring-2 ring-blue-200" : ""}`}
                  onClick={() => setPart(n)}
                  title={PART_LABEL(cat, n)}
                >
                  <span className="font-medium">{PART_LABEL(cat, n)}</span>
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
                {part
                  ? `${CAT_LABEL[cat]} — ${PART_LABEL(cat, part)}`
                  : `${CAT_LABEL[cat]} — （パートを選択してください）`}
              </div>

              <div className="text-xs text-slate-500">
                語彙数：{loadingPairs ? "…" : pairs.length} 件
              </div>
            </div>
          </div>
        </section>

        {/* コンテンツ */}
        {part ? (
          loadingPairs ? (
            <div className="mt-8 text-slate-500">語彙を読み込み中…</div>
          ) : pairs.length > 0 && idx >= 0 ? (
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
                disabled={!uid || processing} // 認証中（uid未取得）または処理中はボタンを無効化
              />
            )
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

/* ========== 一覧ビュー ========== */
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
        const s =
          stats[p.id] ??
          ({
            JA2FR: { correct: 0, wrong: 0 },
            FR2JA: { correct: 0, wrong: 0 },
          } as DirStat);
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
  disabled, // 認証中（uid未取得）フラグ
}: {
  card: Pair | null;
  idx: number;
  total: number;
  revealed: boolean;
  setRevealed: (v: boolean) => void;
  onPrev: () => void;
  onNext: () => void;
  dir: DrillDir;
  stat: Stat;
  onCorrect: () => void;
  onWrong: () => void;
  disabled: boolean;
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
        {disabled && <span className="ml-2 text-amber-600">(認証中...)</span>}
      </div>

      <div className="mt-3 rounded-2xl border bg-white shadow p-6">
        <div className="text-center">
          <div className="text-2xl font-semibold whitespace-pre-wrap">
            {prompt}
          </div>

          {!revealed ? (
            <button
              className="btn-primary mt-5 px-6 py-2"
              onClick={() => setRevealed(true)}
              disabled={disabled}
            >
              {revealLabel}
            </button>
          ) : (
            <>
              <div className="mt-4 text-xl text-slate-700 whitespace-pre-wrap">
                {answer}
              </div>
              <div className="mt-5 flex items-center justify-center gap-2">
                <button
                  className="rounded-xl border px-4 py-2 text-sm hover:bg-green-50 disabled:opacity-40"
                  onClick={onCorrect}
                  title="覚えた（正解として記録）"
                  disabled={disabled}
                >
                  覚えた ✅
                </button>
                <button
                  className="rounded-xl border px-4 py-2 text-sm hover:bg-amber-50 disabled:opacity-40"
                  onClick={onWrong}
                  title="難しい（不正解として記録）"
                  disabled={disabled}
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
