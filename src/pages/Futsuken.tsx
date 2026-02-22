import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import {
  startSession,
  endSession,
  recordAttempt,
  saveProgress as saveProgressSrv,
  loadProgress as loadProgressSrv,
} from "../lib/metricsClient";

type Item = {
  id: number; // TSVでは行番号、将来DBなら futsuken_items.id
  prompt: string;
  answer: string;
  note?: string;
};

type Stat = { correct: number; wrong: number };

export default function Futsuken() {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  // ドリル状態
  const [idx, setIdx] = useState(0);
  const [reveal, setReveal] = useState(false);
  const [stats, setStats] = useState<Record<number, Stat>>({});

  // セッション計測
  const [sessionStart, setSessionStart] = useState<number | null>(null);

  // 初期化：セッション開始
  useEffect(() => {
    (async () => {
      const t0 = await startSession();
      setSessionStart(t0);
    })();

    return () => {
      void endSession("futsuken", sessionStart);
    };
  }, [sessionStart]);

  // TSV 読み込み（public/data/futsuken.tsv）
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const res = await fetch("/data/futsuken.tsv", { cache: "no-cache" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();

        // index.html フォールバック検知
        const head = text.slice(0, 200).toLowerCase();
        if (head.includes("<!doctype html") || head.includes("<html")) {
          throw new Error(
            "TSV の代わりに HTML が返りました。ファイルを public/data に配置しているか確認してください。"
          );
        }

        const cleaned = text.replace(/^\uFEFF/, "");
        const lines = cleaned
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith("#"));

        const normalizePrompt = (raw: string) => {
          // 1) 先頭/末尾の引用符を除去
          let s = raw.replace(/^"+/, "").replace(/"+$/, "");

          // 2) 最初の半角スペースの直後で改行
          const i = s.indexOf(" ");
          if (i >= 0) {
            s = s.slice(0, i) + "\n" + s.slice(i + 1);
          }

          // 3) "B:" / "B：" があれば、その直前で改行
          s = s.replace(/ ?(?=B\s*[:：])/g, "\n");
          return s;
        };

        // TSV → Item[]
        const parsed: Item[] = lines.map((l, i) => {
          const cols = l.split("\t");

          const promptRaw = (cols[0] ?? "").trim();
          const prompt = normalizePrompt(promptRaw);

          const answer = (cols[1] ?? "").trim();
          const note =
            cols.length > 2 ? cols.slice(2).join(" / ").trim() : undefined;

          return { id: i + 1, prompt, answer, note };
        });

        setItems(parsed);
        // セッション内統計の初期化/引継ぎ
        setStats((prev) => {
          const next: Record<number, Stat> = {};
          for (const it of parsed)
            next[it.id] = prev[it.id] ?? { correct: 0, wrong: 0 };
          return next;
        });

        // まずは先頭
        setIdx(0);
        setReveal(false);

        // ★ 前回の続きから復元
        try {
          const prog = await loadProgressSrv("futsuken", {});
          if (prog?.last_item_id) {
            const i = parsed.findIndex((x) => x.id === prog.last_item_id);
            if (i >= 0) setIdx(i);
          }
        } catch (e) {
          console.warn("[loadProgress] futsuken failed:", e);
        }
      } catch (e) {
        console.error("TSV load failed:", e);
        setItems([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const total = items.length;
  const item = items[idx] ?? null;
  const stat = item
    ? stats[item.id] ?? { correct: 0, wrong: 0 }
    : { correct: 0, wrong: 0 };

  // ヘッダー用（任意）
  const totalCorrect = useMemo(
    () => Object.values(stats).reduce((a, s) => a + s.correct, 0),
    [stats]
  );
  const totalTried = useMemo(
    () => Object.values(stats).reduce((a, s) => a + s.correct + s.wrong, 0),
    [stats]
  );
  const acc = totalTried ? Math.round((totalCorrect / totalTried) * 100) : 0;

  // 次カード（単純に次へ。最後は先頭に）
  const next = () => {
    if (!total) return;
    setIdx((v) => (v + 1) % total);
    setReveal(false);
  };
  const prev = () => {
    if (!total) return;
    setIdx((v) => (v - 1 + total) % total);
    setReveal(false);
  };

  const mark = async (ok: boolean) => {
    if (!item) return;

    // セッション内の正誤
    setStats((p) => {
      const cur = p[item.id] ?? { correct: 0, wrong: 0 };
      const nextS = ok
        ? { correct: cur.correct + 1, wrong: cur.wrong }
        : { correct: cur.correct, wrong: cur.wrong + 1 };
      return { ...p, [item.id]: nextS };
    });

    // Supabase（学習イベント）
    try {
      await recordAttempt({
        menuId: "futsuken",
        isCorrect: ok,
        itemId: item.id,
        skillTags: [],
        meta: { prompt: item.prompt },
        userId: uid ?? "local",
      });
    } catch (e) {
      console.warn("[recordAttempt] futsuken failed:", e);
    }

    next();
  };

  // 現在の item が変わるたび進捗保存
  useEffect(() => {
    if (!item) return;
    void saveProgressSrv({
      moduleId: "futsuken",
      context: {},
      lastItemId: item.id,
    });
  }, [item]);

  return (
    <div className="min-h-svh bg-white">
      {/* ヘッダー */}
      <header className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
          <h1 className="text-lg font-bold flex items-center gap-2">
            <Link to="/app" className="text-rose-500 hover:text-rose-600" title="ホームに戻る">🏠</Link>
            ⑤ 仏検過去問
          </h1>
          <div className="text-sm text-slate-600">
            問題数：{loading ? "…" : total}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        {loading ? (
          <div className="text-slate-500">問題を読み込み中…</div>
        ) : !item ? (
          <div className="text-slate-500">問題がありません</div>
        ) : (
          <section className="mt-2">
            <div className="text-sm text-slate-500">
              {idx + 1} / {total}（正解 {stat.correct}・間違い {stat.wrong}）
              ・正答 {totalCorrect} / {totalTried}（{acc}%）
            </div>

            <div className="mt-3 rounded-2xl border bg-white shadow p-6">
              {/* 問題 */}
              <div className="text-center">
                <div className="text-xs text-slate-500 mb-1">問題</div>
                <div className="text-xl md:text-2xl font-semibold leading-relaxed whitespace-pre-line">
                  {item.prompt}
                </div>

                {!reveal ? (
                  <button
                    className="btn-primary mt-5 px-6 py-2"
                    onClick={() => setReveal(true)}
                  >
                    答えを表示
                  </button>
                ) : (
                  <>
                    <div className="mt-5 text-xs text-slate-500">答え</div>
                    <div className="mt-1 text-lg md:text-xl text-rose-700 font-medium whitespace-pre-line">
                      {item.answer}
                    </div>
                    {item.note && (
                      <p className="mt-2 text-sm text-slate-600">{item.note}</p>
                    )}

                    <div className="mt-5 flex items-center justify-center gap-2">
                      <button
                        className="rounded-xl border px-4 py-2 text-sm hover:bg-green-50"
                        onClick={() => void mark(true)}
                        title="覚えた（正解として記録）"
                      >
                        覚えた ✅
                      </button>
                      <button
                        className="rounded-xl border px-4 py-2 text-sm hover:bg-amber-50"
                        onClick={() => void mark(false)}
                        title="難しい（不正解として記録）"
                      >
                        難しい 😵
                      </button>
                    </div>
                  </>
                )}
              </div>

              {/* ページャ */}
              <div className="mt-6 flex items-center justify-between">
                <button
                  className="rounded-xl border px-4 py-2 text-sm hover:bg-slate-50"
                  onClick={prev}
                >
                  ← 前へ
                </button>
                <button
                  className="rounded-xl border px-4 py-2 text-sm hover:bg-slate-50"
                  onClick={next}
                >
                  次へ →
                </button>
              </div>
            </div>

            <p className="mt-3 text-xs text-slate-500">
              ※ 正誤は Supabase（learning_events）、滞在時間は
              study_sessions、進捗は user_progress に保存されます。
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
