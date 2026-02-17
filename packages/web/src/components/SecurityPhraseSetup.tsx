import { useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { generateRecoveryKey } from "@haven/core";
import { uploadBackup, cacheSecurityPhrase } from "../lib/backup.js";
import { useAuthStore } from "../store/auth.js";
import { useFocusTrap } from "../hooks/useFocusTrap.js";

type Step = "choose" | "custom" | "generated" | "saving";

export default function SecurityPhraseSetup() {
  const { t } = useTranslation();
  const completeBackupSetup = useAuthStore((s) => s.completeBackupSetup);

  const [step, setStep] = useState<Step>("choose");
  const [customPhrase, setCustomPhrase] = useState("");
  const [confirmPhrase, setConfirmPhrase] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);

  const handleGenerateKey = useCallback(() => {
    setRecoveryKey(generateRecoveryKey());
    setStep("generated");
  }, []);

  const handleSave = useCallback(async (phrase: string) => {
    setSaving(true);
    setError("");
    setStep("saving");
    try {
      await uploadBackup(phrase);
      cacheSecurityPhrase(phrase);
      completeBackupSetup();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("securityPhraseSetup.failedUpload"));
      setStep("custom"); // go back so user can retry
      setSaving(false);
    }
  }, [completeBackupSetup, t]);

  const handleCustomSubmit = useCallback(() => {
    if (customPhrase.length < 8) {
      setError(t("securityPhraseSetup.custom.phraseMinLength"));
      return;
    }
    if (customPhrase !== confirmPhrase) {
      setError(t("securityPhraseSetup.custom.phrasesDoNotMatch"));
      return;
    }
    handleSave(customPhrase);
  }, [customPhrase, confirmPhrase, handleSave, t]);

  const handleSkip = useCallback(() => {
    completeBackupSetup();
  }, [completeBackupSetup]);

  return (
    <div className="modal-overlay" role="presentation">
      <div className="modal-dialog" style={{ maxWidth: 460 }} ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="security-setup-title">
        {step === "choose" && (
          <>
            <h2 style={{ marginBottom: 8 }} id="security-setup-title">{t("securityPhraseSetup.title")}</h2>
            <p className="security-phrase-desc">
              {t("securityPhraseSetup.desc")}
            </p>
            <div className="security-phrase-options">
              <button
                className="btn-primary"
                onClick={() => setStep("custom")}
                style={{ marginBottom: 8 }}
              >
                {t("securityPhraseSetup.createPhrase")}
              </button>
              <button
                className="btn-primary"
                onClick={handleGenerateKey}
                style={{ marginBottom: 8 }}
              >
                {t("securityPhraseSetup.generateKey")}
              </button>
              <button
                className="security-phrase-skip"
                onClick={handleSkip}
              >
                {t("securityPhraseSetup.skipForNow")}
              </button>
              <p className="security-phrase-warning">
                {t("securityPhraseSetup.skipWarning")}
              </p>
            </div>
          </>
        )}

        {step === "custom" && (
          <>
            <h2 style={{ marginBottom: 8 }}>{t("securityPhraseSetup.custom.title")}</h2>
            <p className="security-phrase-desc">
              {t("securityPhraseSetup.custom.desc")}
            </p>
            <label className="security-phrase-label">{t("securityPhraseSetup.custom.phraseLabel")}</label>
            <input
              type="password"
              className="modal-input"
              placeholder={t("securityPhraseSetup.custom.phrasePlaceholder")}
              value={customPhrase}
              onChange={(e) => { setCustomPhrase(e.target.value); setError(""); }}
              autoFocus
            />
            <label className="security-phrase-label" style={{ marginTop: 12 }}>{t("securityPhraseSetup.custom.confirmLabel")}</label>
            <input
              type="password"
              className="modal-input"
              placeholder={t("securityPhraseSetup.custom.confirmPlaceholder")}
              value={confirmPhrase}
              onChange={(e) => { setConfirmPhrase(e.target.value); setError(""); }}
              onKeyDown={(e) => e.key === "Enter" && handleCustomSubmit()}
            />
            {error && <p className="modal-error">{error}</p>}
            <div className="security-phrase-actions">
              <button className="btn-secondary" onClick={() => setStep("choose")}>{t("securityPhraseSetup.custom.back")}</button>
              <button
                className="btn-primary"
                onClick={handleCustomSubmit}
                disabled={saving || !customPhrase || !confirmPhrase}
              >
                {t("securityPhraseSetup.custom.saveBackup")}
              </button>
            </div>
          </>
        )}

        {step === "generated" && (
          <>
            <h2 style={{ marginBottom: 8 }}>{t("securityPhraseSetup.generated.title")}</h2>
            <p className="security-phrase-desc">
              {t("securityPhraseSetup.generated.desc")}
            </p>
            <div className="recovery-key-display">
              <code>{recoveryKey}</code>
            </div>
            <button
              className="btn-secondary"
              style={{ width: "100%", marginBottom: 12 }}
              onClick={() => navigator.clipboard.writeText(recoveryKey)}
            >
              {t("securityPhraseSetup.generated.copyToClipboard")}
            </button>
            <label className="security-phrase-confirm-label">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              {t("securityPhraseSetup.generated.savedConfirm")}
            </label>
            {error && <p className="modal-error">{error}</p>}
            <div className="security-phrase-actions">
              <button className="btn-secondary" onClick={() => setStep("choose")}>{t("securityPhraseSetup.generated.back")}</button>
              <button
                className="btn-primary"
                onClick={() => handleSave(recoveryKey)}
                disabled={!confirmed || saving}
              >
                {t("securityPhraseSetup.generated.saveBackup")}
              </button>
            </div>
          </>
        )}

        {step === "saving" && (
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <p>{t("securityPhraseSetup.saving")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
