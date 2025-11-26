import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { getModuleAccuracy, getDailyStudySeconds } from "../lib/supaMetrics";
import { useEffect, useState } from "react";

type Stat = { total: number; correct: number };
type StudyBucket = { day: string; sec: number };

// ===== ヘルパー（全期間の欠損日を0埋め & 連続日数計算） =====
function toDate(d: string) {
  return new Date(d + "T00:00:00");
}
function toDayStr(d: Date) {
  return d.toISOString().slice(0, 10);
}
function padDailyBuckets(all: StudyBucket[]) {
  if (!all || all.length === 0) return [];
  const sorted = all.slice().sort((a, b) => a.day.localeCompare(b.day));
  const start = toDate(sorted[0].day);
  const today = new Date();
  const end = toDate(toDayStr(today));
  const map = new Map(sorted.map((x) => [x.day, x.sec ?? 0]));
  const out: StudyBucket[] = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = toDayStr(d);
    out.push({ day: key, sec: map.get(key) ?? 0 });
  }
  return out;
}
function computeStreak(all: StudyBucket[]) {
  const padded = padDailyBuckets(all);
  let streak = 0;
  for (let i = padded.length - 1; i >= 0; i--) {
    if ((padded[i].sec ?? 0) > 0) streak++;
    else break;
  }
  return streak;
}

export default function Hub() {
  const { user, loading, logout } = useAuth();

  const [mod, setMod] = useState<Record<string, Stat>>({
    "news-vocab": { total: 0, correct: 0 },
    nominalisation: { total: 0, correct: 0 },
    "verb-gym": { total: 0, correct: 0 },
    composition: { total: 0, correct: 0 },
    futsuken: { total: 0, correct: 0 },
  });

  const [studyBuckets, setStudyBuckets] = useState<StudyBucket[]>([]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      // モジュール正答集計（キーを"verb-gym"に統一）
      const entries = [
        ["news-vocab", "news_vocab"],
        ["nominalisation", "nominalisation"],
        ["verb-gym", "verbe"],
        ["composition", "composition"],
        ["futsuken", "futsuken"],
      ] as const;

      const results = await Promise.all(
        entries.map(([, snake]) => getModuleAccuracy(snake))
      );
      const next: Record<string, Stat> = {};
      entries.forEach(([k], i) => {
        next[k] = { total: results[i].total, correct: results[i].correct };
      });
      setMod(next);

      // 学習時間（全期間）。引数なし対応がなければ十分に大きい日数で代替
      const buckets = (await getDailyStudySeconds(36500)) ?? [];
      setStudyBuckets(buckets);
    })();
  }, [user]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-svh bg-rose-50/50">
        <p className="text-rose-400 font-medium animate-pulse">
          読み込んでいます... 🌸
        </p>
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  const metadataName = user.user_metadata?.full_name;
  const hasMetadataName =
    typeof metadataName === "string" && metadataName.trim().length > 0;
  const displayName =
    (hasMetadataName ? metadataName.trim() : user.email?.split("@")[0]) ??
    "ゲスト";

  const StatBadge = ({
    label,
    value,
    emoji,
    color = "rose",
  }: {
    label: string;
    value: string | number;
    emoji?: string;
    color?: "rose" | "sky" | "violet" | "amber";
  }) => {
    const colorStyles = {
      rose: "bg-rose-50 text-rose-600 border-rose-100",
      sky: "bg-sky-50 text-sky-600 border-sky-100",
      violet: "bg-violet-50 text-violet-600 border-violet-100",
      amber: "bg-amber-50 text-amber-600 border-amber-100",
    };

    return (
      <div
        className={`flex flex-col items-center justify-center rounded-2xl border p-3 shadow-sm transition hover:scale-105 hover:shadow-md ${colorStyles[color]}`}
      >
        <div className="text-2xl mb-1">{emoji}</div>
        <div className="text-xs font-medium opacity-80">{label}</div>
        <div className="text-lg font-bold">{value}</div>
      </div>
    );
  };

  const Card = (props: {
    title: string;
    desc: string;
    to: string;
    stat?: Stat;
    emoji: string;
    hue?: "rose" | "violet" | "emerald" | "amber" | "sky";
    disabled?: boolean;
  }) => {
    const {
      title,
      desc,
      to,
      emoji,
      hue = "rose",
      disabled = false,
    } = props;

    // パステルカラー定義
    const styles = {
      rose: {
        bg: "bg-gradient-to-br from-rose-50 to-white",
        border: "border-rose-100",
        text: "text-rose-600",
        ring: "hover:ring-rose-200",
        shadow: "shadow-rose-100",
        btn: "bg-rose-100 text-rose-700 hover:bg-rose-200",
      },
      violet: {
        bg: "bg-gradient-to-br from-violet-50 to-white",
        border: "border-violet-100",
        text: "text-violet-600",
        ring: "hover:ring-violet-200",
        shadow: "shadow-violet-100",
        btn: "bg-violet-100 text-violet-700 hover:bg-violet-200",
      },
      emerald: {
        bg: "bg-gradient-to-br from-emerald-50 to-white",
        border: "border-emerald-100",
        text: "text-emerald-600",
        ring: "hover:ring-emerald-200",
        shadow: "shadow-emerald-100",
        btn: "bg-emerald-100 text-emerald-700 hover:bg-emerald-200",
      },
      amber: {
        bg: "bg-gradient-to-br from-amber-50 to-white",
        border: "border-amber-100",
        text: "text-amber-600",
        ring: "hover:ring-amber-200",
        shadow: "shadow-amber-100",
        btn: "bg-amber-100 text-amber-700 hover:bg-amber-200",
      },
      sky: {
        bg: "bg-gradient-to-br from-sky-50 to-white",
        border: "border-sky-100",
        text: "text-sky-600",
        ring: "hover:ring-sky-200",
        shadow: "shadow-sky-100",
        btn: "bg-sky-100 text-sky-700 hover:bg-sky-200",
      },
    };

    const s = styles[hue];
    const lift = disabled ? "" : "hover:-translate-y-1 hover:shadow-lg";

    return (
      <div
        className={`group relative flex flex-col items-center text-center rounded-[2rem] border ${s.border} ${s.bg} p-6 shadow-sm transition-all duration-300 ${lift} ${s.ring} ring-1 ring-transparent`}
      >
        {/* ふわふわ浮かぶ絵文字 */}
        <div className="mb-4 text-6xl drop-shadow-sm transition-transform duration-500 ease-in-out group-hover:scale-110 animate-float">
          {emoji}
        </div>

        <h3 className={`mb-2 text-lg font-bold ${s.text}`}>{title}</h3>
        <p className="mb-6 text-sm text-slate-600 leading-relaxed">{desc}</p>

        <div className="mt-auto">
          {disabled ? (
            <span
              className="inline-block rounded-full bg-slate-100 px-6 py-2 text-sm text-slate-400 select-none"
            >
              準備中... 💤
            </span>
          ) : (
            <Link
              to={to}
              className={`inline-flex items-center justify-center rounded-full px-8 py-2.5 text-sm font-bold transition-colors ${s.btn}`}
            >
              はじめる
            </Link>
          )}
        </div>
      </div>
    );
  };

  // ===== ヒーロー部の表示用集計（全期間） =====
  const totalCorrect =
    (mod["news-vocab"]?.correct ?? 0) +
    (mod["nominalisation"]?.correct ?? 0) +
    (mod["verb-gym"]?.correct ?? 0) +
    (mod["composition"]?.correct ?? 0) +
    (mod["futsuken"]?.correct ?? 0);

  const totalStudySec = studyBuckets.reduce((s, d) => s + (d.sec ?? 0), 0);
  const totalStudyHours = Math.floor(totalStudySec / 3600);
  const totalStudyMinutes = Math.round((totalStudySec % 3600) / 60);
  const studyDays = studyBuckets.filter((d) => (d.sec ?? 0) > 0).length;
  const studyStreak = computeStreak(studyBuckets);

  return (
    <div className="relative min-h-svh bg-[#fffafb] font-sans text-slate-700 overflow-x-hidden">
      {/* カスタムアニメーション定義 */}
      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
        .animate-float {
          animation: float 3s ease-in-out infinite;
        }
      `}</style>

      {/* 背景装飾（パステル） */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-[20%] -left-[10%] h-[70vh] w-[70vh] rounded-full bg-rose-100/40 blur-3xl opacity-60 mix-blend-multiply" />
        <div className="absolute top-[10%] -right-[10%] h-[60vh] w-[60vh] rounded-full bg-sky-100/40 blur-3xl opacity-60 mix-blend-multiply" />
        <div className="absolute -bottom-[20%] left-[20%] h-[60vh] w-[60vh] rounded-full bg-amber-100/40 blur-3xl opacity-60 mix-blend-multiply" />
      </div>

      {/* ヘッダー */}
      <header className="relative z-10">
        <div className="mx-auto max-w-screen-xl px-6 py-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-rose-300 to-rose-400 text-white shadow-md">
              <span className="text-xl">✨</span>
            </div>
            <div className="font-bold text-slate-700 tracking-wide">Amitié</div>
          </div>
          <div className="flex items-center gap-3 text-sm font-medium">
            <Link
              to="/app/report"
              className="hidden sm:inline-flex items-center gap-1 rounded-full bg-white/60 px-4 py-1.5 text-slate-600 hover:bg-white hover:text-rose-500 transition shadow-sm"
            >
              📄 レポート
            </Link>
            <button
              onClick={logout}
              className="rounded-full bg-white/60 px-4 py-1.5 text-slate-600 hover:bg-white hover:text-rose-500 transition shadow-sm"
            >
              ログアウト
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-screen-xl px-6 pb-20">
        {/* ヒーロー部 */}
        <section className="mt-4 mb-12 text-center">
          <h1 className="text-3xl md:text-4xl font-bold text-slate-800 mb-3">
            Bonjour, <span className="text-rose-400">{displayName}</span>!
          </h1>
          <p className="text-slate-500 mb-10">
            今日も楽しくフランス語に触れましょう 🇫🇷
          </p>

          {/* 統計バッジ */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-3xl mx-auto">
            <StatBadge
              label="勉強時間"
              value={`${totalStudyHours}h ${totalStudyMinutes}m`}
              emoji="⏱️"
              color="sky"
            />
            <StatBadge
              label="勉強日数"
              value={`${studyDays}日`}
              emoji="📅"
              color="rose"
            />
            <StatBadge
              label="連続日数"
              value={`${studyStreak}日`}
              emoji="🔥"
              color="amber"
            />
            <StatBadge
              label="総正答数"
              value={`${totalCorrect}問`}
              emoji="✅"
              color="violet"
            />
          </div>
        </section>

        {/* メニュー */}
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <Card
            emoji="📰"
            title="時事単語"
            desc="ニュースに出てくる言葉をチェック！"
            to="/app/news-vocab"
            hue="rose"
          />
          <Card
            emoji="✍️"
            title="名詞化"
            desc="スマートな文章を書くための第一歩"
            to="/app/nominalisation"
            hue="violet"
          />
          <Card
            emoji="🗣️"
            title="動詞ジム"
            desc="会話の瞬発力を鍛えるトレーニング"
            to="/app/temps"
            hue="emerald"
          />
          <Card
            emoji="📝"
            title="仏作文"
            desc="言いたいことをフランス語にする練習"
            to="/app/composition"
            hue="amber"
          />
        </div>
      </main>
    </div>
  );
}
