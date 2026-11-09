import { useEffect } from "react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth";
import SetupNotice from "./components/SetupNotice";
import { supabase, supabaseConfigured } from "./supabase";
import Alerts from "./pages/Alerts";
import Companies from "./pages/Companies";
import Home from "./pages/Home";
import Jobs from "./pages/Jobs";
import Login from "./pages/Login";

function BrandMark() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#e8590c" />
      <path
        d="M6 11a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v2.2a2.8 2.8 0 0 0 0 5.6V21a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-2.2a2.8 2.8 0 0 0 0-5.6z"
        fill="#fff"
      />
      <path d="M19 10v12" stroke="#e8590c" strokeWidth="1.6" strokeDasharray="2 2" />
    </svg>
  );
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function NotFound() {
  return (
    <div className="empty">
      <h3>This page does not exist</h3>
      <p className="muted" style={{ margin: "0 0 14px" }}>
        The link may be old or mistyped.
      </p>
      <Link to="/" className="btn small">
        Go to the home page
      </Link>
    </div>
  );
}

export default function App() {
  const { user } = useAuth();

  return (
    <>
      <ScrollToTop />
      <header className="site-header">
        <div className="wrap bar">
          <Link to="/" className="brand">
            <BrandMark />
            Easy Apply
          </Link>
          <nav aria-label="Main">
            <NavLink to="/jobs">Jobs</NavLink>
            <NavLink to="/companies">Companies</NavLink>
            <NavLink to="/alerts">Alerts</NavLink>
            {user ? (
              <button type="button" title={user.email ?? undefined} onClick={() => supabase.auth.signOut()}>
                Sign out
              </button>
            ) : (
              <Link to="/login" className="nav-cta">
                Sign in
              </Link>
            )}
          </nav>
        </div>
      </header>

      <main className="wrap">
        {supabaseConfigured ? (
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/jobs" element={<Jobs />} />
            <Route path="/companies" element={<Companies />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/login" element={<Login />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        ) : (
          <SetupNotice />
        )}
      </main>

      <footer className="site-footer">
        <div className="wrap">
          Easy Apply reads public job boards and links you to each company&apos;s own application
          page. It never applies for you.
        </div>
      </footer>
    </>
  );
}
