// src/pages/Signup.tsx
import { useState } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";

export default function Signup() {
  const nav = useNavigate();

  // 入力状態
  const [fullName, setFullName] = useState(""); // ← name を fullName に統一
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // UI状態
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setOk(null);
    setLoading(true);
    try {
      // data は未使用なので error のみ参照
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          // プロフィールに名前を入れておきたい場合（任意）
          data: { full_name: fullName },
        },
      });
      if (error) {
        setErr(error.message);
        return;
      }
      setOk("登録しました。ログインしてください。");
      // Confirm email を OFF にしていれば即ログイン可能なので /login へ
      nav("/login");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative w-full min-h-svh overflow-hidden">
      <img
        src="/signup_bg.jpg"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).src =
            "https://images.unsplash.com/photo-1519681393784-d120267933ba?q=80&w=1600&auto=format&fit=crop";
        }}
        alt=""
        className="pointer-events-none select-none fixed inset-0 h-full w-full object-cover"
      />
      <div className="fixed inset-0 bg-white/55 backdrop-blur-sm" />

      <div className="relative z-10 flex min-h-svh items-center justify-center px-[clamp(16px,4vw,64px)] py-8">
        <div className="w-full max-w-md md:max-w-lg mx-auto rounded-3xl border border-white/70 bg-white/95 p-6 md:p-8 shadow-xl">
          <h1 className="text-2xl font-bold text-slate-800 text-center">
            アカウント作成
          </h1>

          <form className="mt-6 space-y-4" onSubmit={onSubmit}>
            <div>
              <label className="block text-sm text-slate-600">
                お名前（任意）
              </label>
              <input
                className="input"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                autoComplete="name"
              />
            </div>

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
                required
              />
            </div>

            <div>
              <label className="block text-sm text-slate-600">パスワード</label>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>

            {err && <p className="text-rose-600 text-sm">{err}</p>}
            {ok && <p className="text-emerald-600 text-sm">{ok}</p>}

            <button
              className="btn-primary btn-xl w-full disabled:opacity-60"
              type="submit"
              disabled={loading}
            >
              {loading ? "登録中…" : "登録する"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
