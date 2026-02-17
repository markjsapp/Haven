import { useState, useEffect, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../store/auth";

export default function Register() {
  const { t } = useTranslation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [inviteRequired, setInviteRequired] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const register = useAuthStore((s) => s.register);
  const api = useAuthStore((s) => s.api);
  const navigate = useNavigate();

  useEffect(() => {
    api.checkInviteRequired()
      .then((res) => setInviteRequired(res.invite_required))
      .catch(() => setInviteRequired(false));
  }, [api]);

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

    setLoading(true);
    try {
      await register(
        username,
        password,
        displayName || undefined,
        inviteCode || undefined,
      );
      navigate("/");
    } catch (err: any) {
      setError(err.message || t("register.failed"));
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
