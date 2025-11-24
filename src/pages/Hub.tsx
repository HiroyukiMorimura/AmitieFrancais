// src/pages/Hub.tsx
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
      <div className="flex items-center justify-center min-h-svh">
        <p className="text-slate-600">ログイン情報を読み込み中…</p>
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

  const Card = (props: {
    title: string;
    desc: string;
    to: string;
    stat?: Stat; // 受け取るが未使用（互換のため残す）
    emoji: string;
    image?: string; // /images/xxx.jpg のルート相対パス
    hue?: "rose" | "violet" | "emerald" | "amber";
    disabled?: boolean;
  }) => {
    const {
      title,
      desc,
      to,
      emoji,
      image,
      hue = "rose",
      disabled = false,
    } = props;

    const ring =
      hue === "rose"
        ? `ring-rose-200 ${disabled ? "" : "hover:ring-rose-300"}`
        : hue === "violet"
        ? `ring-violet-200 ${disabled ? "" : "hover:ring-violet-300"}`
        : hue === "emerald"
        ? `ring-emerald-200 ${disabled ? "" : "hover:ring-emerald-300"}`
        : `ring-amber-200 ${disabled ? "" : "hover:ring-amber-300"}`;

    const lift = disabled ? "" : "hover:-translate-y-0.5";

    return (
      <div
        className={`relative flex flex-col justify-end overflow-hidden rounded-3xl border shadow-sm ring-1 ${ring} p-0 ${lift}`}
        style={{ minHeight: "220px" }}
      >
        {/* 背景画像（軽い拡大／ぼかし無し） */}
        {image && (
          <img
            src={image}
            alt={title}
            className="absolute inset-0 h-full w-full object-cover scale-105"
            loading="lazy"
            decoding="async"
          />
        )}
        {/* 明るめオーバーレイ（文字を邪魔しない） */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/20 via-white/10 to-transparent" />

        {/* 前面コンテンツ（中央揃え・タイトルやや上寄せ） */}
        <div className="relative z-10 p-4 text-center mb-6">
          <div className="inline-flex items-center gap-2 rounded-xl bg-white/80 backdrop-blur-sm px-2.5 py-1 mx-auto">
            <span className="text-base">{emoji}</span>
            <h3 className="font-semibold">{title}</h3>
            {disabled && <span className="ml-2 chip text-xs">準備中</span>}
          </div>
          <p className="mt-2 max-w-[90%] rounded-xl bg-white/75 px-3 py-2 text-sm text-slate-700 backdrop-blur-sm mx-auto">
            {desc}
          </p>
          <div className="mt-4 flex justify-center">
            {disabled ? (
              <span
                className="btn-primary px-6 py-2 pointer-events-none select-none"
                aria-disabled="true"
                role="button"
                tabIndex={-1}
                title="準備中です"
              >
                準備中
              </span>
            ) : (
              <Link to={to} className="btn-primary px-6 py-2">
                はじめる <span aria-hidden>→</span>
              </Link>
            )}
          </div>
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
    <div className="relative min-h-svh bg-gradient-to-br from-sky-50 via-white to-rose-50">
      {/* 背景装飾 */}
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
                Bonjour, <span className="text-rose-600">{displayName}</span>
                さん
              </h1>
              <p className="mt-1 text-slate-600">
                まちがいは宝物。弱点を拾い上げて、得意に変えていこう ✨
              </p>
            </div>

            {/* ★ 新しい4指標（全期間） */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 min-w-[260px]">
              <StatBadge
                label="勉強時間（全期間）"
                value={`${totalStudyHours}時間 ${totalStudyMinutes}分`}
                emoji="⏱"
              />
              <StatBadge
                label="勉強日数（全期間）"
                value={studyDays}
                emoji="📅"
              />
              <StatBadge label="連続勉強日数" value={studyStreak} emoji="🔥" />
              <StatBadge label="総正答" value={totalCorrect} emoji="✅" />
            </div>
          </div>
        </section>

        {/* メニュー */}
        <h2 className="mt-8 mb-3 text-lg font-semibold">学習メニュー</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card
            emoji="📰"
            title="① 時事単語ドリル"
            desc="ニュース頻出語をカードで学習"
            to="/app/news-vocab"
            stat={mod["news-vocab"]}
            hue="rose"
            image="/images/vocab.jpg"
            disabled={false}
          />
          <Card
            emoji="✍️"
            title="② 名詞化ドリル"
            desc="よりハイレベルなフランス語を書く基礎固め"
            to="/app/nominalisation"
            stat={mod["nominalisation"]}
            hue="violet"
            image="/images/nominalisation.jpg"
            disabled={false}
          />
          <Card
            emoji="🔤"
            title="③ 動詞ドリル"
            desc="会話にも重要な動詞を徹底的に学ぶ"
            to="/app/temps"
            stat={mod["verb-gym"]}
            hue="emerald"
            image="/images/verbe.jpg"
            disabled={false}
          />
          <Card
            emoji="📝"
            title="④ 仏作文"
            desc="日常会話で書けそうで書けない文章の特訓"
            to="/app/composition"
            stat={mod["composition"]}
            hue="amber"
            image="/images/composition.jpg"
            disabled={false}
          />
          {/* 将来のメニュー
          <Card
            emoji="📚"
            title="⑤ 仏検過去問"
            desc="過去問ドリルで実戦力アップ"
            to="/app/futsuken"
            stat={mod["futsuken"]}
            hue="rose"
            image="/images/futsuken.jpg"
            disabled={true}
          /> */}
        </div>
      </main>
    </div>
  );
}
