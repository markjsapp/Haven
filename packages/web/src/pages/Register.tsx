import { useState, useEffect, useRef, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../store/auth";

declare global {
  interface Window {
    turnstile?: {
      render: (container: string | HTMLElement, options: {
        sitekey: string;
        callback: (token: string) => void;
        "expired-callback"?: () => void;
        theme?: "light" | "dark" | "auto";
      }) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

export default function Register() {
  const { t } = useTranslation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [inviteRequired, setInviteRequired] = useState<boolean | null>(null);
  const [turnstileSiteKey, setTurnstileSiteKey] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const register = useAuthStore((s) => s.register);
  const api = useAuthStore((s) => s.api);
  const navigate = useNavigate();

  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    api.checkInviteRequired()
      .then((res) => setInviteRequired(res.invite_required))
      .catch(() => setInviteRequired(false));

    api.getChallenge()
      .then((res) => {
        if (res.turnstile_site_key) {
          setTurnstileSiteKey(res.turnstile_site_key);
        }
      })
      .catch(() => {});
  }, [api]);

  // Load and render Turnstile widget when site key is available
  useEffect(() => {
    if (!turnstileSiteKey) return;

    const scriptId = "cf-turnstile-script";
    if (!document.getElementById(scriptId)) {
      const script = document.createElement("script");
      script.id = scriptId;
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      document.head.appendChild(script);
    }

    function renderWidget() {
      if (!window.turnstile || !turnstileRef.current) return;
      if (widgetIdRef.current !== null) return;

      widgetIdRef.current = window.turnstile.render(turnstileRef.current, {
        sitekey: turnstileSiteKey!,
        callback: (token: string) => setTurnstileToken(token),
        "expired-callback": () => setTurnstileToken(null),
        theme: "dark",
      });
    }

    // Turnstile script may already be loaded
    if (window.turnstile) {
      renderWidget();
    } else {
      const script = document.getElementById(scriptId);
      script?.addEventListener("load", renderWidget);
    }

    return () => {
      if (widgetIdRef.current !== null && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [turnstileSiteKey]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError(t("register.passwordsMismatch"));
      return;
    }
    if (password.length < 8) {
      setError(t("register.passwordTooShort"));
      return;
    }
    if (turnstileSiteKey && !turnstileToken) {
      setError(t("register.turnstileError"));
      return;
    }

    setLoading(true);
    try {
      await register(
        username,
        password,
        displayName || undefined,
        inviteCode || undefined,
        turnstileToken || undefined,
      );
      navigate("/");
    } catch (err: any) {
      setError(err.message || t("register.failed"));
      // Reset Turnstile widget so user can retry
      if (widgetIdRef.current !== null && window.turnstile) {
        window.turnstile.reset(widgetIdRef.current);
        setTurnstileToken(null);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>{t("register.appName")}</h1>
        <p className="auth-subtitle">{t("register.subtitle")}</p>

        <form onSubmit={handleSubmit}>
          {inviteRequired && (
            <div className="field">
              <label htmlFor="inviteCode">{t("register.inviteCodeLabel")}</label>
              <input
                id="inviteCode"
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder={t("register.inviteCodePlaceholder")}
              />
            </div>
          )}

          <div className="field">
            <label htmlFor="username">{t("register.usernameLabel")}</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus={!inviteRequired}
              minLength={3}
              maxLength={32}
              pattern="^[a-zA-Z0-9_-]+$"
              title={t("register.usernameTitle")}
            />
          </div>

          <div className="field">
            <label htmlFor="displayName">{t("register.displayNameLabel")}</label>
            <input
              id="displayName"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="password">{t("register.passwordLabel")}</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>

          <div className="field">
            <label htmlFor="confirmPassword">{t("register.confirmPasswordLabel")}</label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>

          {turnstileSiteKey && (
            <div className="turnstile-container" ref={turnstileRef} />
          )}

          {error && <div className="error">{error}</div>}

          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? t("register.submitLoading") : t("register.submit")}
          </button>

          <p className="auth-note">
            {t("register.encryptionNote")}
          </p>
        </form>

        <p className="auth-link">
          {t("register.alreadyHaveAccount")} <Link to="/login">{t("register.signIn")}</Link>
        </p>
      </div>
    </div>
  );
}
