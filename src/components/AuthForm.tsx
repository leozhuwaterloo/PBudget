"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useT } from "@/lib/i18n/context";
import PasswordInput from "@/components/PasswordInput";

// Public OAuth config the server page resolves from env and passes down. When a
// provider's env is unset its flag is false and its button never renders — the
// whole feature is dormant until the GOOGLE_*/APPLE_* env vars are set.
export type SocialConfig = {
  googleEnabled: boolean;
  appleEnabled: boolean;
  googleWebClientId?: string;
  googleIosClientId?: string;
  appleServicesId?: string;
};

// Init the native social-login plugin once per page load (idempotent guard).
let socialInited = false;

export default function AuthForm({ mode, social }: { mode: "login" | "signup"; social?: SocialConfig }) {
  const router = useRouter();
  const t = useT();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Social login is web-only unless the native plugin is bundled — Google/Apple
  // block OAuth in an embedded webview, so in-app we use the native SDK path.
  //   "web"    → browser: show buttons, use the OAuth redirect
  //   "native" → in-app WITH the social-login plugin: on-device OAuth
  //   "none"   → in-app WITHOUT the plugin (older build): hide social, email only
  const [socialMode, setSocialMode] = useState<"web" | "native" | "none" | null>(null);
  useEffect(() => {
    import("@capacitor/core").then(({ Capacitor }) => {
      if (!Capacitor.isNativePlatform()) return setSocialMode("web");
      import("@capgo/capacitor-social-login")
        .then(() => setSocialMode("native"))
        .catch(() => setSocialMode("none"));
    });
  }, []);
  const canSocial = socialMode === "web" || socialMode === "native";
  const showGoogle = !!social?.googleEnabled && canSocial;
  const showApple = !!social?.appleEnabled && canSocial;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch(`/api/auth/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, agreed }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error || t("common.genericError"));
      return;
    }
    router.push(mode === "signup" ? "/verify" : "/dashboard");
    router.refresh();
  };

  // Native (in-app) social sign-in: the @capgo/capacitor-social-login plugin runs
  // OAuth on-device and returns a signed id_token, which /api/auth/native verifies
  // + exchanges for a session cookie.
  async function nativeSignIn(provider: "google" | "apple") {
    setError("");
    setBusy(true);
    try {
      const { SocialLogin } = await import("@capgo/capacitor-social-login");
      if (!socialInited) {
        await SocialLogin.initialize({
          google: {
            webClientId: social?.googleWebClientId,
            iOSClientId: social?.googleIosClientId,
            iOSServerClientId: social?.googleWebClientId,
          },
          ...(social?.appleServicesId ? { apple: { clientId: social.appleServicesId } } : {}),
        });
        socialInited = true;
      }
      const r = await SocialLogin.login(
        provider === "google"
          ? { provider: "google", options: {} }
          : { provider: "apple", options: { scopes: ["email"] } },
      );
      const idToken = (r.result as { idToken?: string })?.idToken;
      if (!idToken) throw new Error("no id token");
      const res = await fetch("/api/auth/native", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, idToken }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean };
      if (!res.ok || !data.ok) throw new Error("rejected");
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError(t("auth.socialError"));
      setBusy(false);
    }
  }

  function onSocialClick(provider: "google" | "apple") {
    if (socialMode === "native") void nativeSignIn(provider);
    else window.location.href = `/api/auth/${provider}`;
  }

  return (
    <form className="auth card" onSubmit={submit}>
      <h1>{mode === "signup" ? t("auth.signupTitle") : t("auth.loginTitle")}</h1>
      <label htmlFor="email">{t("auth.email")}</label>
      <input
        id="email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <label htmlFor="password">{t("auth.password")}</label>
      <PasswordInput
        id="password"
        autoComplete={mode === "signup" ? "new-password" : "current-password"}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      {mode === "signup" && (
        <label className="row" style={{ gap: 8, marginTop: 12, alignItems: "flex-start", fontSize: 13 }}>
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ marginTop: 3 }} required />
          <span>
            {t("auth.agreePre")}{" "}
            <Link href="/terms" target="_blank">{t("auth.termsLink")}</Link>.
          </span>
        </label>
      )}
      {error && <div className="error">{error}</div>}
      {mode === "login" && (
        <p className="muted" style={{ marginTop: 8, textAlign: "right" }}>
          <Link href="/forgot">{t("auth.forgotPassword")}</Link>
        </p>
      )}
      <button
        className="btn btn-primary"
        style={{ marginTop: 16, width: "100%" }}
        disabled={busy || (mode === "signup" && !agreed)}
      >
        {busy ? "…" : mode === "signup" ? t("nav.signup") : t("nav.login")}
      </button>

      {(showGoogle || showApple) && (
        <>
          <div className="row" style={{ alignItems: "center", gap: 12, margin: "16px 0" }}>
            <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
            <span className="muted" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              {t("auth.or")}
            </span>
            <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
          </div>
          {showGoogle && (
            <button
              type="button"
              className="btn"
              style={{ width: "100%", justifyContent: "center", gap: 10 }}
              disabled={busy}
              onClick={() => onSocialClick("google")}
            >
              <GoogleIcon />
              {t("auth.continueWithGoogle")}
            </button>
          )}
          {showApple && (
            <button
              type="button"
              className="btn"
              style={{ width: "100%", justifyContent: "center", gap: 10, marginTop: showGoogle ? 10 : 0 }}
              disabled={busy}
              onClick={() => onSocialClick("apple")}
            >
              <AppleIcon />
              {t("auth.continueWithApple")}
            </button>
          )}
        </>
      )}

      <p className="muted" style={{ marginTop: 16 }}>
        {mode === "signup" ? (
          <>{t("auth.haveAccount")} <Link href="/login">{t("nav.login")}</Link></>
        ) : (
          <>{t("auth.newHere")} <Link href="/signup">{t("auth.createAccount")}</Link></>
        )}
      </p>
    </form>
  );
}

// Google "G" mark (official four-color).
function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92a8.78 8.78 0 0 0 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}

// Apple logo mark (uses currentColor so it inherits the button's theme text).
function AppleIcon() {
  return (
    <svg width="16" height="18" viewBox="0 0 14 17" fill="currentColor" aria-hidden="true">
      <path d="M11.6 9.02c-.02-1.77 1.45-2.62 1.51-2.66-.82-1.2-2.1-1.37-2.56-1.39-1.09-.11-2.13.64-2.68.64-.55 0-1.4-.62-2.31-.61-1.19.02-2.29.69-2.9 1.75-1.24 2.15-.32 5.32.89 7.06.59.85 1.29 1.8 2.21 1.77.89-.04 1.22-.57 2.29-.57 1.07 0 1.37.57 2.31.55.95-.02 1.56-.87 2.14-1.72.67-.99.95-1.94.96-1.99-.02-.01-1.85-.71-1.87-2.81zM9.86 3.8c.49-.6.82-1.42.73-2.25-.71.03-1.56.47-2.06 1.06-.45.53-.85 1.37-.74 2.18.79.06 1.59-.4 2.07-.99z" />
    </svg>
  );
}
