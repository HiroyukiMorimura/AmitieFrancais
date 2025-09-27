/* eslint-disable no-console */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

type RangeKey = "14d" | "30d" | "90d";
type DayDatum = { date: string; seconds: number };

export default function StudyTime() {
  const [range, setRange] = useState<RangeKey>("14d");
  const [data, setData] = useState<DayDatum[]>([]);
  const [loading, setLoading] = useState(true);

  // 期間の計算
  const days = range === "14d" ? 14 : range === "30d" ? 30 : 90;

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth.user?.id;
        if (!uid) {
          setData([]);
          setLoading(false);
          return;
        }

        const since = new Date();
        since.setDate(since.getDate() - (days - 1)); // 今日を含めてN日
        const { data: sessions, error } = await supabase
          .from("study_sessions")
          .select("started_at, duration_sec, menu")
          .eq("user_id", uid)
          .gte("started_at", since.toISOString())
          .order("started_at", { ascending: true });

        if (error) {
          console.error("[study_sessions]", error);
          setData([]);
          setLoading(false);
          return;
        }

        // 期間の全日を0で初期化
        const byDay = new Map<string, number>();
        const today = new Date();
        for (let i = days - 1; i >= 0; i--) {
          const d = new Date(today);
          d.setDate(today.getDate() - i);
          const key = d.toISOString().slice(0, 10);
          byDay.set(key, 0);
        }

        // 累積
        (sessions ?? []).forEach((s) => {
          const key = new Date(s.started_at as string)
            .toISOString()
            .slice(0, 10);
          const prev = byDay.get(key) ?? 0;
          byDay.set(key, prev + (s.duration_sec as number));
        });

        setData(
          Array.from(byDay.entries()).map(([date, seconds]) => ({
            date,
            seconds,
          }))
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [days]);

  const totalMin = useMemo(
    () =>
      Math.round((data.reduce((sum, d) => sum + d.seconds, 0) / 60) * 10) / 10,
    [data]
  );

  return (
    <div className="min-h-svh bg-white">
      <header className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
          <h1 className="text-lg font-bold">⏱ 学習時間（{labelOf(range)}）</h1>
          <RangeSwitch value={range} onChange={setRange} />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 space-y-6">
        <section className="glass-card p-4">
          <div className="text-sm text-slate-600">
            期間合計：<span className="font-semibold">{totalMin} 分</span>
          </div>
          <div className="mt-3">
            {loading ? (
              <div className="text-slate-500">読み込み中…</div>
            ) : (
              <StudyTimeChart
                data={data}
                title={`直近${days}日の学習時間（分）`}
              />
            )}
          </div>
          <p className="mt-3 text-xs text-slate-500">
            *
            セッションはページ滞在時間ベースで記録しています（NewsVocabなどの画面を離れると保存）。
          </p>
        </section>
      </main>
    </div>
  );
}

function labelOf(r: RangeKey) {
  return r === "14d" ? "14日" : r === "30d" ? "30日" : "90日";
}

function RangeSwitch({
  value,
  onChange,
}: {
  value: RangeKey;
  onChange: (v: RangeKey) => void;
}) {
  return (
    <div className="inline-flex rounded-xl border bg-white shadow-sm overflow-hidden">
      {(["14d", "30d", "90d"] as RangeKey[]).map((k) => (
        <button
          key={k}
          className={`px-3 py-1.5 text-sm ${
            value === k ? "bg-slate-100 font-semibold" : "hover:bg-slate-50"
          }`}
          onClick={() => onChange(k)}
        >
          {labelOf(k)}
        </button>
      ))}
    </div>
  );
}

/** SVGの軽量棒グラフ */
function StudyTimeChart({ data, title }: { data: DayDatum[]; title: string }) {
  if (!data.length)
    return <div className="text-slate-500">データがありません</div>;
  const max = Math.max(...data.map((d) => d.seconds), 1);
  const W = 800,
    H = 200,
    P = 28;
  const barW = (W - P * 2) / data.length;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
      <text x={P} y={16} fontSize="12" fill="currentColor">
        {title}
      </text>
      <line
        x1={P}
        y1={H - P}
        x2={W - P}
        y2={H - P}
        stroke="currentColor"
        opacity="0.2"
      />
      {data.map((d, i) => {
        const h = Math.round(((d.seconds || 0) / max) * (H - P * 2));
        const x = P + i * barW + 2;
        const y = H - P - h;
        return (
          <g key={d.date}>
            <rect x={x} y={y} width={barW - 4} height={h} rx="4" />
            {/* ラベル（隔日） */}
            {i % Math.ceil(data.length / 10) === 0 && (
              <text
                x={x + (barW - 4) / 2}
                y={H - 6}
                fontSize="10"
                textAnchor="middle"
                fill="currentColor"
                opacity="0.7"
              >
                {d.date.slice(5).replace("-", "/")}
              </text>
            )}
            {/* 値がある日には分表示 */}
            {d.seconds > 0 && (
              <text
                x={x + (barW - 4) / 2}
                y={y - 4}
                fontSize="10"
                textAnchor="middle"
                fill="currentColor"
              >
                {Math.round(d.seconds / 60)}m
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
