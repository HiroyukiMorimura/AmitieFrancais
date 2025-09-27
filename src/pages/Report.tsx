import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";

type TopicStat = {
  user_id: string;
  topic_id: number;
  subtopic: string;
  big_category: string;
  attempts: number;
  corrects: number;
  wrongs: number;
  accuracy_percent: number;
};

type CatStat = {
  user_id: string;
  big_category: string;
  attempts: number;
  corrects: number;
  wrongs: number;
  accuracy_percent: number;
};

export default function Report() {
  const [topicStats, setTopicStats] = useState<TopicStat[]>([]);
  const [catStats, setCatStats] = useState<CatStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [reportText, setReportText] = useState<string>("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth.user?.id;
        if (!uid) {
          setTopicStats([]);
          setCatStats([]);
          return;
        }

        // 直近14日（ビュー）
        const { data: t, error: te } = await supabase
          .from("v_user_topic_stats_14d")
          .select("*")
          .eq("user_id", uid);

        const { data: c, error: ce } = await supabase
          .from("v_user_category_stats")
          .select("*")
          .eq("user_id", uid);

        if (te) console.error("[v_user_topic_stats_14d]", te);
        if (ce) console.error("[v_user_category_stats]", ce);

        setTopicStats(t ?? []);
        setCatStats(c ?? []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const totals = useMemo(() => {
    const attempts = topicStats.reduce((s, x) => s + x.attempts, 0);
    const corrects = topicStats.reduce((s, x) => s + x.corrects, 0);
    const wrongs = topicStats.reduce((s, x) => s + x.wrongs, 0);
    const acc = attempts ? Math.round((corrects / attempts) * 100) : 0;
    return { attempts, corrects, wrongs, acc };
  }, [topicStats]);

  const weakest = useMemo(
    () =>
      topicStats
        .filter((x) => x.attempts >= 3)
        .sort((a, b) => a.accuracy_percent - b.accuracy_percent)
        .slice(0, 5),
    [topicStats]
  );

  const strongest = useMemo(
    () =>
      topicStats
        .filter((x) => x.attempts >= 3)
        .sort((a, b) => b.accuracy_percent - a.accuracy_percent)
        .slice(0, 5),
    [topicStats]
  );

  const genReport = async () => {
    const payload = {
      period: "last_14_days",
      totals,
      by_category: catStats,
      weakest_topics: weakest,
      strongest_topics: strongest,
    };
    // ★ ここで Edge Function / API 経由で LLM を叩くのが本実装
    setReportText(
      `【スタブ】このJSONを LLM に渡します:\n\n${JSON.stringify(
        payload,
        null,
        2
      )}`
    );
  };

  return (
    <div className="min-h-svh bg-slate-50">
      {/* ヘッダー */}
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="mx-auto max-w-screen-xl px-4 py-4 flex items-center justify-between">
          <h1 className="text-xl font-bold">📄 学習レポート</h1>
          <div className="flex items-center gap-2">
            {/* ← ご要望どおり、レポートの横に「学習時間」ボタン */}
            <Link
              to="/app/study-time"
              className="rounded-xl border bg-white/90 px-3 py-1.5 text-sm shadow hover:bg-slate-50"
            >
              ⏱ 学習時間
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-screen-xl px-4 py-6 space-y-6">
        {/* 概要 */}
        <section className="glass-card p-4">
          <h2 className="font-semibold">概要（直近14日）</h2>
          {loading ? (
            <p className="text-slate-600 text-sm mt-2">読み込み中…</p>
          ) : (
            <div className="mt-2 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <StatItem label="総出題" value={totals.attempts} />
              <StatItem label="正答" value={totals.corrects} />
              <StatItem label="誤答" value={totals.wrongs} />
              <StatItem label="正答率" value={`${totals.acc}%`} />
            </div>
          )}
          <button
            className="btn-primary mt-4 px-4 py-2 text-sm"
            onClick={genReport}
            disabled={loading}
          >
            レポートを生成（スタブ）
          </button>
        </section>

        {/* 大項目別 */}
        <section className="glass-card p-4">
          <h3 className="font-semibold">大項目別（累計）</h3>
          {loading ? (
            <p className="text-slate-600 text-sm mt-2">読み込み中…</p>
          ) : catStats.length === 0 ? (
            <p className="text-slate-600 text-sm mt-2">データがありません。</p>
          ) : (
            <div className="mt-3 grid md:grid-cols-2 lg:grid-cols-3 gap-3">
              {catStats.map((c) => (
                <div
                  key={c.big_category}
                  className="rounded-xl border p-3 bg-white"
                >
                  <div className="font-medium">{c.big_category}</div>
                  <div className="text-sm text-slate-600">
                    回数 {c.attempts}／正答 {c.corrects}／誤答 {c.wrongs}
                    ／正答率 {c.accuracy_percent}%
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 弱点・強み */}
        <section className="grid lg:grid-cols-2 gap-4">
          <div className="glass-card p-4">
            <h3 className="font-semibold">弱点トピック（attempts ≥ 3）</h3>
            {loading ? (
              <p className="text-slate-600 text-sm mt-2">読み込み中…</p>
            ) : weakest.length === 0 ? (
              <p className="text-slate-600 text-sm mt-2">
                データがありません。
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {weakest.map((t) => (
                  <li
                    key={t.topic_id}
                    className="rounded-xl border p-3 bg-white"
                  >
                    <div className="text-sm font-medium">
                      {t.big_category} — {t.subtopic}
                    </div>
                    <div className="text-xs text-slate-600">
                      正答率 {t.accuracy_percent}%（{t.corrects}/{t.attempts}）
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="glass-card p-4">
            <h3 className="font-semibold">強みトピック（attempts ≥ 3）</h3>
            {loading ? (
              <p className="text-slate-600 text-sm mt-2">読み込み中…</p>
            ) : strongest.length === 0 ? (
              <p className="text-slate-600 text-sm mt-2">
                データがありません。
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {strongest.map((t) => (
                  <li
                    key={t.topic_id}
                    className="rounded-xl border p-3 bg-white"
                  >
                    <div className="text-sm font-medium">
                      {t.big_category} — {t.subtopic}
                    </div>
                    <div className="text-xs text-slate-600">
                      正答率 {t.accuracy_percent}%（{t.corrects}/{t.attempts}）
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* 生成結果（スタブ） */}
        {reportText && (
          <section className="glass-card p-4 whitespace-pre-wrap text-sm bg-white">
            {reportText}
          </section>
        )}
      </main>
    </div>
  );
}

function StatItem({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border p-3 bg-white">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}
