// src/pages/Login.tsx
import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { supabase } from "../lib/supabase";

export default function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState("demo@lingua.app");
  const [password, setPassword] = useState("demo1234");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      // data は未使用なので error だけ取り出す
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      // サインイン成功 → /app へ
      nav("/app", { replace: true });
    } catch (e: unknown) {
      if (e instanceof Error) {
        setErr(e.message);
      } else {
        setErr("ログインに失敗しました");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative w-full min-h-svh overflow-hidden">
      <img
        src="/images/app_icon.jpg"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).src =
            "https://images.unsplash.com/photo-1503676260728-1c00da094a0b?q=80&w=1600&auto=format&fit=crop";
        }}
        alt=""
        className="pointer-events-none select-none fixed inset-0 h-full w-full object-cover"
      />
      <div className="fixed inset-0 bg-white/55 backdrop-blur-sm" />

      <div className="relative z-10 flex min-h-svh items-center justify-center px-[clamp(16px,4vw,64px)] py-8">
        <div className="w-full max-w-md md:max-w-lg mx-auto rounded-3xl border border-white/70 bg-white/95 p-6 md:p-8 shadow-xl">
          <h1 className="text-2xl font-bold text-slate-800 text-center">
            ログイン
          </h1>
          <p className="mt-1 text-center text-slate-500 text-sm">
            デモ用：<code>demo@lingua.app</code> / <code>demo1234</code>
          </p>

          <div className="mt-5">
            <Link
              to="/signup"
              className="w-full inline-flex items-center justify-center rounded-3xl
                         border border-slate-200 bg-white text-slate-700
                         px-6 py-3 shadow hover:bg-slate-50 transition
                         focus:outline-none focus:ring-4 focus:ring-sky-100"
            >
              ✨ アカウントを新規作成
            </Link>
          </div>

          <div className="my-4 flex items-center gap-3 text-xs text-slate-400">
            <div className="h-px flex-1 bg-slate-200" />
            <span>または</span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          <form className="space-y-4" onSubmit={onSubmit}>
            <div>
              <label className="block text-sm text-slate-600">
                メールアドレス
              </label>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-600">パスワード</label>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>

            {err && <p className="text-rose-600 text-sm">{err}</p>}

            <button
              className="btn-primary btn-xl w-full disabled:opacity-60"
              type="submit"
              disabled={loading}
            >
              {loading ? "ログイン中…" : "ログインする"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
