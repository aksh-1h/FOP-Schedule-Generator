"use client";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  ShieldCheck,
  Layers3,
  Clock3,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { signIn } from "@/lib/client";
export default function Login() {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const router = useRouter();
  const [demoEnabled, setDemoEnabled] = useState(false);
  useEffect(() => {
    fetch("/api/demo/config")
      .then((r) => r.json())
      .then((d) => setDemoEnabled(d.enabled === true))
      .catch(() => {});
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await signIn(email, password);
      router.replace("/college");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login">
      <section className="login-story">
        <div className="brand">
          <span className="brand-icon">
            <CalendarDays size={23} />
          </span>
          <div>
            FOP <span>Timetable studio</span>
          </div>
        </div>
        <div className="login-copy">
          <div className="eyebrow">Faculty of Pharmacy</div>
          <h1>
            A clearer week.
            <br />
            For everyone.
          </h1>
          <p>
            Bring every course, classroom and faculty schedule into one
            thoughtfully organized timetable.
          </p>
          <div className="mini-week">
            <div className="mini-head">
              Your week, in harmony <span>Mon – Sat</span>
            </div>
            <div className="mini-grid">
              {Array.from({ length: 24 }, (_, i) => (
                <div key={i} className={`mini-cell m${i % 5}`}>
                  {[0, 7, 10, 15, 20].includes(i) ? (
                    <span>{i % 2 ? "Lab session" : "Theory"}</span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
          <div className="login-features">
            <span>
              <ShieldCheck size={17} /> Clash-free scheduling
            </span>
            <span>
              <Layers3 size={17} /> All courses together
            </span>
            <span>
              <Clock3 size={17} /> One weekly view
            </span>
          </div>
        </div>
        <small>Designed for the Faculty of Pharmacy</small>
      </section>
      <section className="login-form">
        <div className="login-form-inner">
          <span className="pill">Administration portal</span>
          <h2>Welcome back</h2>
          <p className="muted">Sign in to plan your college’s academic week.</p>
          {demoEnabled && (
            <div className="notice">
              <div>
                <strong>Demo access available</strong>
                <p>
                  Use demo@fop.local with the test password in the README. Demo
                  data is synthetic and resets when the server restarts.
                </p>
              </div>
            </div>
          )}
          <form onSubmit={submit}>
            <label>
              Email address
              <input
                type="email"
                autoComplete="username"
                placeholder="you@university.edu"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete="current-password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            {error && (
              <div role="alert" className="notice danger">
                {error}
              </div>
            )}
            <button className="dark-button" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
              <ArrowRight size={17} />
            </button>
          </form>
          <div className="login-note">
            <ShieldCheck size={18} />
            <span>
              Access is for provisioned administrators and Deans. Contact your
              administrator if you need an account.
            </span>
          </div>
        </div>
        <small>Faculty of Pharmacy · Academic operations</small>
      </section>
    </main>
  );
}
