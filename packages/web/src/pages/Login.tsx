import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../store/auth";

export default function Login() {
  const { t } = useTranslation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await login(username, password, totpCode || undefined);
      navigate("/");
    } catch (err: any) {
      setError(err.message || t("login.failed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>{t("login.appName")}</h1>
        <p className="auth-subtitle">{t("login.subtitle")}</p>

        <form onSubmit={handleSubmit}>
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

          <div className="field">
            <label htmlFor="totp">{t("login.totpLabel")}</label>
            <input
              id="totp"
              type="text"
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value)}
              placeholder={t("login.totpPlaceholder")}
              inputMode="numeric"
              maxLength={6}
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
      </div>
    </div>
  );
}
