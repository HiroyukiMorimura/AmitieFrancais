import { useMemo } from "react";
import { Link } from "react-router-dom";
import { tomokoMessages } from "../components/TomokoMessages";

export default function Landing() {
  const todaysMessage = useMemo(() => {
    if (!tomokoMessages.length) return "";
    const index = Math.floor(Math.random() * tomokoMessages.length);
    return tomokoMessages[index];
  }, []);

  return (
    // 全体の背景にログインページと同じ写真を敷きつつ、可読性確保のため薄いオーバーレイを重ねる
    <div className="relative min-h-svh w-full text-stone-700 overflow-hidden font-sans">
      <img
        src="/images/app_icon.jpg"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).src =
            "https://images.unsplash.com/photo-1503676260728-1c00da094a0b?q=80&w=1600&auto=format&fit=crop";
        }}
        alt=""
        className="pointer-events-none select-none fixed inset-0 h-full w-full object-cover -z-20"
      />
      <div className="fixed inset-0 bg-rose-50/90 backdrop-blur-sm -z-10" />
      {/* --- 背景の装飾（オーロラグラデーション） --- */}
      {/* 最先端感を出すための、ぼんやりとした光の表現 */}
      <div className="pointer-events-none absolute top-[-10%] left-[-20%] w-[70vw] h-[70vw] rounded-full bg-pink-200/60 blur-[100px] mix-blend-multiply animate-blob filter z-0" />
      <div className="pointer-events-none absolute top-[20%] right-[-20%] w-[60vw] h-[60vw] rounded-full bg-purple-200/60 blur-[100px] mix-blend-multiply animate-blob animation-delay-2000 filter z-0" />
      <div className="pointer-events-none absolute bottom-[-20%] left-[20%] w-[60vw] h-[60vw] rounded-full bg-orange-100/60 blur-[100px] mix-blend-multiply animate-blob animation-delay-4000 filter z-0" />

      {/* ヘッダー */}
      {/* 背景の透明度を上げ、境界線を柔らかくして浮遊感を出す */}
      <header className="fixed top-0 left-0 z-50 w-full border-b border-white/60 bg-white/60 backdrop-blur-md supports-[backdrop-filter]:bg-white/40 shadow-sm shadow-rose-100/50">
        <div className="w-full max-w-screen-xl mx-auto px-[clamp(16px,4vw,64px)] py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* ロゴアイコンを少しリッチに */}
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-rose-300 to-pink-400 text-white grid place-items-center shadow-lg shadow-rose-200">
              <span className="text-lg">✨</span>
            </div>
            <span className="text-lg font-bold tracking-tight text-stone-600">
              アミティエ{" "}
              <span className="hidden sm:inline">フランス語学習アプリ</span>
            </span>
          </div>
          {/* ナビゲーション（見た目だけ） */}
          <nav
            className="pointer-events-none select-none opacity-50 hidden sm:flex items-center gap-6 text-sm font-medium"
            aria-disabled
          ></nav>
        </div>
      </header>

      {/* ヒーローセクション */}
      <section className="relative z-10 w-full pt-[80px] min-h-svh flex items-center">
        <div className="w-full max-w-screen-xl mx-auto px-[clamp(16px,4vw,64px)] py-12 md:py-20 grid lg:grid-cols-12 gap-[clamp(32px,6vw,80px)] items-center">
          {/* 左側：テキストコンテンツ (lg:col-span-7) */}
          <div className="text-center lg:text-left lg:col-span-7">
            <h1 className="font-extrabold text-[clamp(32px,5vw,56px)] leading-[1.1] tracking-tight text-stone-800 drop-shadow-sm">
              フランス語学習、
              <br />
              <span className="bg-gradient-to-r from-rose-400 via-pink-400 to-purple-400 bg-clip-text text-transparent">
                もっと自由に、
                <br />
                心地よく。
              </span>
            </h1>
            <p className="mt-6 text-lg text-stone-600 max-w-2xl mx-auto lg:mx-0 leading-relaxed font-medium">
              毎日の「ちょっとだけ」を応援します。
              <br className="hidden sm:block" />
              ちょっとずつ単語を覚え、目標に近づいていきましょう。
            </p>

            {/* アクションボタン */}
            <div className="mt-10 flex flex-col sm:flex-row justify-center lg:justify-start gap-4">
              <Link
                to="/login"
                className="group relative inline-flex items-center justify-center px-8 py-4 font-bold text-white transition-all bg-gradient-to-r from-rose-400 to-pink-500 rounded-full shadow-xl shadow-rose-200 hover:shadow-rose-300 hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-rose-400"
              >
                アプリを始める
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="w-5 h-5 ml-2 -mr-1 transition-transform group-hover:translate-x-1"
                >
                  <path
                    fillRule="evenodd"
                    d="M16.72 7.72a.75.75 0 0 1 1.06 0l3.75 3.75a.75.75 0 0 1 0 1.06l-3.75 3.75a.75.75 0 1 1-1.06-1.06L18.94 13H3.75a.75.75 0 0 1 0-1.5h15.19l-2.47-2.47a.75.75 0 0 1 0-1.06Z"
                    clipRule="evenodd"
                  />
                </svg>
              </Link>
            </div>
          </div>

          {/* 右側：ビジュアル装飾 (lg:col-span-5) */}
          {/* 単なる画像配置から、浮遊感のあるコンポジションに変更 */}
          <div className="relative lg:col-span-5 hidden md:block mt-12 lg:mt-0">
            {/* 装飾的な背景の円 */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[120%] h-[120%] bg-gradient-to-br from-rose-100/50 to-purple-100/50 rounded-full blur-3xl -z-10" />

            <div className="relative z-10 perspective-1000">
              {/* メインのカード：少し傾けて浮遊感を出す */}
              <div className="relative w-full aspect-[4/5] rounded-[32px] overflow-hidden shadow-[0_25px_50px_-12px_rgba(0,0,0,0.15)] border-[6px] border-white bg-white transform rotate-[-2deg] hover:rotate-0 transition-all duration-500 ease-out">
                <img
                  src="/images/tomoko.jpg"
                  onError={(e) => {
                    const img = e.currentTarget as HTMLImageElement;
                    img.src =
                      "https://images.unsplash.com/photo-1522071820081-009f0129c71c?q=80&w=1600&auto=format&fit=crop"; // より女性らしく洗練された雰囲気の写真に変更
                  }}
                  alt="アプリの利用イメージ"
                  className="absolute inset-0 h-full w-full object-cover"
                  loading="lazy"
                />
                {/* 写真の上にグラスモーフィズムのUIパーツを重ねる */}
                <div className="absolute bottom-6 left-6 right-6 p-4 rounded-2xl bg-white/70 backdrop-blur-lg border border-white/50 shadow-lg">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-rose-100 flex items-center justify-center text-xl">
                      🌷
                    </div>
                    <div>
                      <p className="text-xs text-stone-500 font-medium">
                        朋子先生からのメッセージ
                      </p>
                      <p className="text-sm font-semibold text-stone-800 leading-relaxed">
                        {todaysMessage}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* 装飾パーツ（後ろに浮かぶ小さなカード） */}
              <div className="absolute -top-8 -right-8 w-32 h-32 rounded-2xl bg-gradient-to-br from-purple-200 to-rose-200 shadow-lg blur-[1px] opacity-80 animate-pulse-slow -z-10 rotate-12"></div>
            </div>
          </div>
        </div>
      </section>

      {/* フッター */}
      <footer className="relative z-10 w-full border-t border-stone-200/50 bg-white/30 backdrop-blur-md">
        <div className="mx-auto max-w-screen-xl px-4 py-8 text-xs text-stone-500 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="font-medium">
            © {new Date().getFullYear()} Lingua Amies.
          </div>
          <div
            className="flex gap-6 pointer-events-none select-none opacity-60"
            aria-disabled
          >
            <span>利用規約</span>
            <span>プライバシーポリシー</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ※補足：標準のTailwind CSS設定に加え、以下のカスタム設定（アニメーション用）が
// tailwind.config.js に含まれていることを想定しています。
// これがない場合、背景のフワフワした動き（animate-blob）は機能しませんが、
// デザイン自体は崩れません。
/*
theme: {
  extend: {
    animation: {
      blob: "blob 7s infinite",
      'pulse-slow': 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
    },
    keyframes: {
      blob: {
        "0%": { transform: "translate(0px, 0px) scale(1)" },
        "33%": { transform: "translate(30px, -50px) scale(1.1)" },
        "66%": { transform: "translate(-20px, 20px) scale(0.9)" },
        "100%": { transform: "translate(0px, 0px) scale(1)" },
      },
    },
    // 必要に応じてperspectiveプラグインなども
  },
},
*/
