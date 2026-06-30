"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch(`/api/auth/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "Something went wrong");
      return;
    }
    router.push(mode === "signup" ? "/verify" : "/dashboard");
    router.refresh();
  };

  return (
    <form className="auth card" onSubmit={submit}>
      <h1>{mode === "signup" ? "Create your account" : "Welcome back"}</h1>
      <label htmlFor="email">Email</label>
      <input
        id="email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <label htmlFor="password">Password</label>
      <input
        id="password"
        type="password"
        autoComplete={mode === "signup" ? "new-password" : "current-password"}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      {error && <div className="error">{error}</div>}
      <button className="btn btn-primary" style={{ marginTop: 16, width: "100%" }} disabled={busy}>
        {busy ? "…" : mode === "signup" ? "Sign up" : "Log in"}
      </button>
      <p className="muted" style={{ marginTop: 16 }}>
        {mode === "signup" ? (
          <>Already have an account? <Link href="/login">Log in</Link></>
        ) : (
          <>New here? <Link href="/signup">Create an account</Link></>
        )}
      </p>
    </form>
  );
}
