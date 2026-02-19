import { useState, useRef, useEffect, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../store/auth";

export default function Login() {
  const { t } = useTranslation();
  const [step, setStep] = useState<"credentials" | "totp">("credentials");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();
  const totpInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === "totp") {
      totpInputRef.current?.focus();
    }
  }, [step]);

  async function handleCredentials(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const result = await login(username, password);
      if (result === "totp_required") {
        setStep("totp");
      } else {
        navigate("/");
      }
    } catch (err: any) {
      setError(err.message || t("login.failed"));
    } finally {
      setLoading(false);
    }
  }

  async function handleTotp(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await login(username, password, totpCode);
      navigate("/");
    } catch (err: any) {
      setError(err.message || t("login.failed"));
    } finally {
      setLoading(false);
    }
  }

  function handleBack() {
    setStep("credentials");
    setTotpCode("");
    setError("");
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>{t("login.appName")}</h1>

        {step === "credentials" ? (
          <>
            <p className="auth-subtitle">{t("login.subtitle")}</p>

            <form onSubmit={handleCredentials}>
              <div className="field">
                <label htmlFor="username">{t("login.usernameLabel")}</label>
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              <div className="field">
                <label htmlFor="password">{t("login.passwordLabel")}</label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              {error && <div className="error">{error}</div>}

              <button type="submit" className="btn-primary" disabled={loading}>
                {loading ? t("login.submitLoading") : t("login.submit")}
              </button>
            </form>

            <p className="auth-link">
              {t("login.noAccount")} <Link to="/register">{t("login.createOne")}</Link>
            </p>
          </>
        ) : (
          <>
            <p className="auth-subtitle">{t("login.totpSubtitle")}</p>

            <form onSubmit={handleTotp}>
              <div className="field">
                <label htmlFor="totp">{t("login.totpInputLabel")}</label>
                <input
                  ref={totpInputRef}
                  id="totp"
                  type="text"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                  placeholder={t("login.totpInputPlaceholder")}
                  inputMode="numeric"
                  maxLength={6}
                  required
                  autoComplete="one-time-code"
                />
              </div>

              {error && <div className="error">{error}</div>}

              <button type="submit" className="btn-primary" disabled={loading || totpCode.length !== 6}>
                {loading ? t("login.totpSubmitLoading") : t("login.totpSubmit")}
              </button>
            </form>

            <button className="auth-back-link" onClick={handleBack} type="button">
              {t("login.totpBack")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
