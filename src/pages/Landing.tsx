import { Link } from "react-router-dom";

export default function Landing() {
  return (
    <div className="min-h-svh w-full bg-white text-slate-800">
      {/* ヘッダー*/}
      <header className="w-full border-b border-white/60/50 bg-white/70 backdrop-blur">
        <div className="w-full max-w-none px-[clamp(16px,4vw,64px)] py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-xl bg-rose-500 text-white grid place-items-center shadow">
              ✨
            </div>
            <span className="text-lg font-bold">
              アミティエ フランス語学習アプリ
            </span>
          </div>
          {/* 見た目だけ。遷移しない */}
          <nav
            className="pointer-events-none select-none opacity-60 hidden sm:flex items-center gap-6 text-slate-600"
            aria-disabled
          >
            <span>お問い合わせ</span>
          </nav>
        </div>
      </header>

      {/* ヒーロー：フルブリード（画面全体に写真） */}
      <section className="relative w-full min-h-[calc(100svh-64px)] overflow-hidden">
        {/* 背景写真（全画面） */}
        <img
          src="/app_icon.jpg"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).src =
              "https://images.unsplash.com/photo-1503676260728-1c00da094a0b?q=80&w=1600&auto=format&fit=crop";
          }}
          alt=""
          className="pointer-events-none select-none absolute inset-0 h-full w-full object-cover"
        />
        {/* うっすら白のガラス風オーバーレイ */}
        <div className="absolute inset-0 bg-gradient-to-b from-white/80 via-white/60 to-white/80 backdrop-blur-[2px]" />

        {/* 中央のコンテンツ */}
        <div className="relative z-10 w-full max-w-none px-[clamp(16px,4vw,64px)] py-12 md:py-16 grid md:grid-cols-2 gap-[clamp(16px,4vw,64px)] items-center">
          <div className="text-center md:text-left">
            <h1 className="font-bold text-[clamp(26px,4vw,48px)] leading-tight tracking-tight">
              フランス語学習、
              <span className="inline-block rounded-xl bg-yellow-100 px-2 pb-1">
                やさしく・心地よく
              </span>
            </h1>
            <p className="mt-3 text-slate-700">
              毎日の「ちょっとだけ」を応援。
              <br />
              時事単語から開始できます。
            </p>

            <div className="mt-7 flex justify-center md:place-items-start">
              <Link to="/login" className="btn-primary btn-xl w-full sm:w-auto">
                🌷アプリを始める🌷
              </Link>
            </div>

            {/* 表示だけのチップ */}
            <ul
              className="mt-6 flex flex-wrap justify-center md:justify-start gap-2 pointer-events-none select-none"
              aria-disabled
            >
              <li className="chip">📰 時事単語</li>
              <li className="chip">✍️ 名詞化ドリル</li>
              <li className="chip">📈 学習記録</li>
              <li className="chip">🧑‍🏫 先生メモ</li>
            </ul>
          </div>
          {/* 装飾カード（中央寄せ） */}
          <div className="relative mx-auto w-full max-w-[clamp(280px,45vw,560px)]">
            <div className="relative aspect-[4/3] overflow-hidden rounded-[28px] shadow-2xl border border-white/70 bg-white/70 backdrop-blur">
              {/* 写真本体：4:3の枠に収めて比率維持で拡大縮小 */}
              <img
                src="/tomoko.jpg"
                onError={(e) => {
                  const img = e.currentTarget as HTMLImageElement;
                  // フォールバック（なければ Unsplash）
                  img.src =
                    "https://images.unsplash.com/photo-1519681393784-d120267933ba?q=80&w=1600&auto=format&fit=crop";
                }}
                alt="今日の学習トピック"
                className="absolute inset-0 h-full w-full object-cover"
                loading="lazy"
                decoding="async"
              />
            </div>
          </div>
        </div>
      </section>

      {/* フッター */}
      <footer className="w-full border-t bg-white/80">
        <div className="mx-auto max-w-screen-xl px-4 py-6 text-xs text-slate-500 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div>© {new Date().getFullYear()} Lingua</div>
          <div
            className="pointer-events-none select-none opacity-60"
            aria-disabled
          >
            利用規約・プライバシー
          </div>
        </div>
      </footer>
    </div>
  );
}
