// src/pages/Hub.tsx
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { getModuleAccuracy } from "../lib/supaMetrics";
import { useEffect, useState } from "react";

export default function Hub() {
  const { user, loading, logout } = useAuth();
  const [mod, setMod] = useState<
    Record<string, { total: number; correct: number }>
  >({
    "news-vocab": { total: 0, correct: 0 },
    nominalisation: { total: 0, correct: 0 },
    "verb-gym": { total: 0, correct: 0 },
    freewrite: { total: 0, correct: 0 },
    futsuken: { total: 0, correct: 0 },
  });

  useEffect(() => {
    if (!user) return; // ← userがいなければ何もしない
    (async () => {
      const entries = [
        ["news-vocab", "news_vocab"],
        ["nominalisation", "nominalisation"],
        ["verb-gym", "verb_gym"],
        ["freewrite", "freewrite"],
        ["futsuken", "futsuken"],
      ] as const;
      const results = await Promise.all(
        entries.map(([, snake]) => getModuleAccuracy(snake))
      );
      const next: Record<string, { total: number; correct: number }> = {};
      entries.forEach(([k], i) => {
        next[k] = { total: results[i].total, correct: results[i].correct };
      });
      setMod(next);
    })();
  }, [user]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-svh">
        <p className="text-slate-600">ログイン情報を読み込み中…</p>
      </div>
    );
  }
  // user がまだ null のときのフォールバック
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  const StatBadge = ({
    label,
    value,
    emoji,
  }: {
    label: string;
    value: string | number;
    emoji?: string;
  }) => (
    <div className="rounded-2xl border bg-white/70 backdrop-blur p-3 shadow-sm hover:shadow transition">
      <div className="text-xs text-slate-500">
        {emoji ? `${emoji} ${label}` : label}
      </div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );

  const Card = ({
    title,
    desc,
    to,
    stat,
    emoji,
    hue = "rose",
    disabled = false,
  }: {
    title: string;
    desc: string;
    to: string;
    stat: { total: number; correct: number };
    emoji: string;
    hue?: "rose" | "violet" | "emerald" | "amber";
    disabled?: boolean;
  }) => {
    const acc = stat.total ? Math.round((stat.correct / stat.total) * 100) : 0;
    const ring =
      hue === "rose"
        ? `ring-rose-200 ${disabled ? "" : "hover:ring-rose-300"}`
        : hue === "violet"
        ? `ring-violet-200 ${disabled ? "" : "hover:ring-violet-300"}`
        : hue === "emerald"
        ? `ring-emerald-200 ${disabled ? "" : "hover:ring-emerald-300"}`
        : `ring-amber-200 ${disabled ? "" : "hover:ring-amber-300"}`;
    const grad =
      hue === "rose"
        ? "from-rose-50 to-white"
        : hue === "violet"
        ? "from-violet-50 to-white"
        : hue === "emerald"
        ? "from-emerald-50 to-white"
        : "from-amber-50 to-white";

    const lift = disabled ? "" : "hover:-translate-y-0.5";

    return (
      <div
        className={`flex flex-col justify-between rounded-3xl border shadow-sm ring-1 ${ring} bg-gradient-to-br ${grad} p-5 transition-transform ${lift}`}
      >
        {/* 上部コンテンツ */}
        <div>
          <div className="flex items-center gap-3">
            <span className="text-2xl">{emoji}</span>
            <h3 className="font-semibold">
              {title}{" "}
              {disabled && <span className="ml-2 chip text-xs">準備中</span>}
            </h3>
          </div>
          <p className="mt-2 text-sm text-slate-600">{desc}</p>

          <div className="mt-3 flex items-center gap-3 text-xs text-slate-600">
            <span className="inline-flex items-center gap-1 rounded-full border px-2 py-1 bg-white/70">
              📊 総問 {stat.total}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border px-2 py-1 bg-white/70">
              ✅ 正答 {stat.correct}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border px-2 py-1 bg-white/70">
              🎯 {acc}%
            </span>
          </div>
        </div>

        {/* 下部中央のボタン */}
        <div className="mt-6 flex justify-center">
          {disabled ? (
            <span
              className="btn-primary mt-5 px-6 py-2 pointer-events-none select-none"
              aria-disabled="true"
              role="button"
              tabIndex={-1}
              title="準備中です"
            >
              準備中
            </span>
          ) : (
            <Link to={to} className="btn-primary mt-5 px-6 py-2">
              はじめる <span aria-hidden>→</span>
            </Link>
          )}
        </div>
      </div>
    );
  };

  const totalAttempts =
    (mod["news-vocab"]?.total ?? 0) +
    (mod["nominalisation"]?.total ?? 0) +
    (mod["verb-gym"]?.total ?? 0) +
    (mod["freewrite"]?.total ?? 0) +
    (mod["futsuken"]?.total ?? 0);

  const totalCorrect =
    (mod["news-vocab"]?.correct ?? 0) +
    (mod["nominalisation"]?.correct ?? 0) +
    (mod["verb-gym"]?.correct ?? 0) +
    (mod["freewrite"]?.correct ?? 0) +
    (mod["futsuken"]?.correct ?? 0);

  const totalAcc = totalAttempts
    ? Math.round((totalCorrect / totalAttempts) * 100)
    : 0;

  return (
    <div className="relative min-h-svh bg-gradient-to-br from-sky-50 via-white to-rose-50">
      {/* ふわっと背景装飾 */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-24 -left-16 h-72 w-72 rounded-full bg-rose-200/30 blur-3xl" />
        <div className="absolute top-32 -right-10 h-72 w-72 rounded-full bg-violet-200/30 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-56 w-56 rounded-full bg-emerald-100/40 blur-3xl" />
      </div>

      {/* ヘッダー */}
      <header className="relative z-10 bg-white/70 backdrop-blur border-b">
        <div className="mx-auto max-w-screen-xl px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-xl bg-rose-500 text-white grid place-items-center shadow">
              ✨
            </div>
            <div className="font-bold">アミティエ フランス語学習アプリ</div>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Link to="/app/report" className="chip">
              📄 レポート
            </Link>
            <Link to="/app/study-time" className="chip">
              ⏱ 学習時間
            </Link>
            <span className="hidden sm:inline text-slate-600">
              {user.email}
            </span>
            <button className="chip" onClick={logout}>
              ログアウト
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-screen-xl px-4 py-8">
        {/* ヒーロー部 */}
        <section className="rounded-3xl border bg-white/70 backdrop-blur p-6 shadow-sm">
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">
                Bonjour,{" "}
                <span className="text-rose-600">
                  {user.email?.split("@")[0] ?? "ゲスト"}
                </span>
                さん
              </h1>
              <p className="mt-1 text-slate-600">
                まちがいは宝物。弱点を拾い上げて、得意に変えていこう ✨
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3 min-w-[260px]">
              <StatBadge label="総出題" value={totalAttempts} emoji="📊" />
              <StatBadge label="総正答" value={totalCorrect} emoji="✅" />
              <StatBadge label="正答率" value={`${totalAcc}%`} emoji="🎯" />
            </div>
          </div>
        </section>

        {/* メニュー */}
        <h2 className="mt-8 mb-3 text-lg font-semibold">学習メニュー</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card
            emoji="📰"
            title="① 時事単語"
            desc="ニュース頻出語をカードで学習"
            to="/app/news-vocab"
            stat={mod["news-vocab"]}
            hue="rose"
            disabled={false}
          />
          <Card
            emoji="✍️"
            title="② 名詞化ジム"
            desc="文全体の書き換えで名詞化を体得"
            to="/app/nominalisation"
            stat={mod["nominalisation"]}
            hue="violet"
            disabled={false}
          />
          <Card
            emoji="🧩"
            title="③ 動詞選択＋活用"
            desc="適切な動詞・時制・一致を選ぶ"
            to="/app/temps"
            stat={mod["verb-gym"]}
            hue="emerald"
            disabled={false}
          />
          <Card
            emoji="📝"
            title="④ 自由作文ループ"
            desc="作文→フィードバック→再テスト"
            to="/app/freewrite"
            stat={mod["freewrite"]}
            hue="amber"
            disabled
          />
          <Card
            emoji="📚"
            title="⑤ 仏検過去問"
            desc="過去問ドリルで実戦力アップ"
            to="/app/futsuken"
            stat={mod["futsuken"] ?? { total: 0, correct: 0 }}
            hue="rose"
          />
        </div>
      </main>
    </div>
  );
}
