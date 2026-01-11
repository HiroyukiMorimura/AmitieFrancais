// src/pages/Signup.tsx
import { useState } from "react";
import { supabase } from "../lib/supabase";

export default function Signup() {
  // 入力状態
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

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
      if (password !== confirmPassword) {
        setErr("パスワードが一致しません");
        return;
      }
      
      // サインアップを試行
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          // プロフィールに名前を入れておきたい場合（任意）
          data: { full_name: fullName },
        },
      });
      
      // Supabaseの設定によっては、既存ユーザーの場合でもエラーを返さない
      // data.user が存在するが identities が空の場合、既に登録済み
      if (data.user && (!data.user.identities || data.user.identities.length === 0)) {
        setErr("そのメールアドレスは登録されています");
        return;
      }
      
      if (error) {
        // エラーメッセージが "User already registered" の場合は日本語に変換
        if (error.message.includes("already registered") || 
            error.message.includes("already exists") ||
            error.message.includes("already been registered") ||
            error.message.includes("User already exists")) {
          setErr("そのメールアドレスは登録されています");
        } else {
          setErr(error.message);
        }
        return;
      }
      
      setOk(
        '登録しました。"Supabase Auth <noreply@mail.app.supabase.io>" から届くメールの "Confirm your mail" をクリックしてメール認証を完了してください。'
      );
      // メール確認が完了するまでログインできないため、自動遷移しない
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
            <div>
              <label className="block text-sm text-slate-600">
                パスワード（確認）
              </label>
              <input
                className="input"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
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
