import { useEffect } from "react";
import { Routes, Route, Link } from "react-router-dom";
import { supabase } from "./lib/supabase"; // ★ supabaseクライアントを必ずimport

import Landing from "./pages/Landing";
import Signup from "./pages/Signup";
import Login from "./pages/Login";
import Hub from "./pages/Hub";
import Report from "./pages/Report";
import ProtectedRoute from "./routes/ProtectedRoute";
import NewsVocab from "./pages/NewsVocab";
import StudyTime from "./pages/StudyTime";
import Futsuken from "./pages/Futsuken";

import {
  NominalisationStub,
  VerbGymStub,
  FreewriteStub,
} from "./pages/stubs/ModuleStub";

export default function App() {
  // ★ ここでセッション確認・ログ出力
  useEffect(() => {
    supabase.auth.getSession().then((res) => {
      console.log(
        "[auth] initial session:",
        res.data.session?.user?.id ?? null
      );
    });
    supabase.auth.onAuthStateChange((_event, session) => {
      console.log(
        "[auth] onAuthStateChange:",
        _event,
        "user:",
        session?.user?.id ?? null
      );
    });
  }, []);

  return (
    <>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/login" element={<Login />} />

        <Route
          path="/app"
          element={
            <ProtectedRoute>
              <Hub />
            </ProtectedRoute>
          }
        />
        <Route
          path="/app/report"
          element={
            <ProtectedRoute>
              <Report />
            </ProtectedRoute>
          }
        />
        <Route
          path="/app/news-vocab"
          element={
            <ProtectedRoute>
              <NewsVocab />
            </ProtectedRoute>
          }
        />
        <Route
          path="/app/study-time"
          element={
            <ProtectedRoute>
              <StudyTime />
            </ProtectedRoute>
          }
        />

        <Route
          path="/app/nominalisation"
          element={
            <ProtectedRoute>
              <NominalisationStub />
            </ProtectedRoute>
          }
        />
        <Route
          path="/app/verb-gym"
          element={
            <ProtectedRoute>
              <VerbGymStub />
            </ProtectedRoute>
          }
        />
        <Route
          path="/app/freewrite"
          element={
            <ProtectedRoute>
              <FreewriteStub />
            </ProtectedRoute>
          }
        />

        <Route
          path="/app/futsuken"
          element={
            <ProtectedRoute>
              <Futsuken />
            </ProtectedRoute>
          }
        />
      </Routes>

      {/* 常に右下に固定表示する「ホーム」ボタン */}
      <Link
        to="/app"
        className="fixed bottom-4 right-4 rounded-full bg-rose-500 text-white px-4 py-2 shadow-lg hover:bg-rose-600"
      >
        ホーム
      </Link>
    </>
  );
}
