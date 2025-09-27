// src/routes/ProtectedRoute.tsx
import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import type { PropsWithChildren } from "react"; // ★ 型は import type

export default function ProtectedRoute({ children }: PropsWithChildren) {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then((res) => {
      setAuthed(!!res.data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setAuthed(!!session);
    });
    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  if (!ready) return null;
  return authed ? <>{children}</> : <Navigate to="/login" replace />;
}
