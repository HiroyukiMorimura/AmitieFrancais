import { useEffect } from "react";
import { Routes, Route } from "react-router-dom";
import { supabase } from "./lib/supabase";

import Landing from "./pages/Landing";
import Signup from "./pages/Signup";
import Login from "./pages/Login";
import Hub from "./pages/Hub";
import Report from "./pages/Report";
import ProtectedRoute from "./routes/ProtectedRoute";
import NewsVocab from "./pages/NewsVocab";
import StudyTime from "./pages/StudyTime";
import Futsuken from "./pages/Futsuken";
import CompositionPage from "./pages/Composition";

import Nominalisation from "./pages/Nominalisation";
import Temps from "./pages/Verbe";

export default function App() {
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
              <Nominalisation />
            </ProtectedRoute>
          }
        />
        <Route
          path="/app/temps"
          element={
            <ProtectedRoute>
              <Temps />
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
        <Route
          path="/app/composition"
          element={
            <ProtectedRoute>
              <CompositionPage />
            </ProtectedRoute>
          }
        />
      </Routes>
    </>
  );
}
