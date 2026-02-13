import { useState, useCallback } from "react";
import { generateRecoveryKey } from "@haven/core";
import { uploadBackup, cacheSecurityPhrase } from "../lib/backup.js";
import { useAuthStore } from "../store/auth.js";

type Step = "choose" | "custom" | "generated" | "saving";

export default function SecurityPhraseSetup() {
  const completeBackupSetup = useAuthStore((s) => s.completeBackupSetup);

  const [step, setStep] = useState<Step>("choose");
  const [customPhrase, setCustomPhrase] = useState("");
  const [confirmPhrase, setConfirmPhrase] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

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
      setError(e instanceof Error ? e.message : "Failed to upload backup");
      setStep("custom"); // go back so user can retry
      setSaving(false);
    }
  }, [completeBackupSetup]);

  const handleCustomSubmit = useCallback(() => {
    if (customPhrase.length < 8) {
      setError("Security phrase must be at least 8 characters");
      return;
    }
    if (customPhrase !== confirmPhrase) {
      setError("Phrases do not match");
      return;
    }
    handleSave(customPhrase);
  }, [customPhrase, confirmPhrase, handleSave]);

  const handleSkip = useCallback(() => {
    completeBackupSetup();
  }, [completeBackupSetup]);

  return (
    <div className="modal-overlay">
      <div className="modal-dialog" style={{ maxWidth: 460 }}>
        {step === "choose" && (
          <>
            <h2 style={{ marginBottom: 8 }}>Set Up Key Backup</h2>
            <p className="security-phrase-desc">
              Protect your encrypted messages by creating a security phrase.
              You'll need this to restore your messages if you log in on a new device.
            </p>
            <div className="security-phrase-options">
              <button
                className="btn-primary"
                onClick={() => setStep("custom")}
                style={{ marginBottom: 8 }}
              >
                Create a Security Phrase
              </button>
              <button
                className="btn-primary"
                onClick={handleGenerateKey}
                style={{ marginBottom: 8 }}
              >
                Generate a Recovery Key
              </button>
              <button
                className="security-phrase-skip"
                onClick={handleSkip}
              >
                Skip for now
              </button>
              <p className="security-phrase-warning">
                Without a security phrase, you won't be able to read your messages on other devices.
              </p>
            </div>
          </>
        )}

        {step === "custom" && (
          <>
            <h2 style={{ marginBottom: 8 }}>Create Security Phrase</h2>
            <p className="security-phrase-desc">
              Choose a strong phrase you'll remember. You'll need it to restore your keys on other devices.
            </p>
            <label className="security-phrase-label">Security Phrase</label>
            <input
              type="password"
              className="modal-input"
              placeholder="Enter a security phrase..."
              value={customPhrase}
              onChange={(e) => { setCustomPhrase(e.target.value); setError(""); }}
              autoFocus
            />
            <label className="security-phrase-label" style={{ marginTop: 12 }}>Confirm Phrase</label>
            <input
              type="password"
              className="modal-input"
              placeholder="Confirm your security phrase..."
              value={confirmPhrase}
              onChange={(e) => { setConfirmPhrase(e.target.value); setError(""); }}
              onKeyDown={(e) => e.key === "Enter" && handleCustomSubmit()}
            />
            {error && <p className="modal-error">{error}</p>}
            <div className="security-phrase-actions">
              <button className="btn-secondary" onClick={() => setStep("choose")}>Back</button>
              <button
                className="btn-primary"
                onClick={handleCustomSubmit}
                disabled={saving || !customPhrase || !confirmPhrase}
              >
                Save Backup
              </button>
            </div>
          </>
        )}

        {step === "generated" && (
          <>
            <h2 style={{ marginBottom: 8 }}>Your Recovery Key</h2>
            <p className="security-phrase-desc">
              Copy this key and store it somewhere safe. You'll need it to restore your messages on other devices.
            </p>
            <div className="recovery-key-display">
              <code>{recoveryKey}</code>
            </div>
            <button
              className="btn-secondary"
              style={{ width: "100%", marginBottom: 12 }}
              onClick={() => navigator.clipboard.writeText(recoveryKey)}
            >
              Copy to Clipboard
            </button>
            <label className="security-phrase-confirm-label">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I have saved my recovery key
            </label>
            {error && <p className="modal-error">{error}</p>}
            <div className="security-phrase-actions">
              <button className="btn-secondary" onClick={() => setStep("choose")}>Back</button>
              <button
                className="btn-primary"
                onClick={() => handleSave(recoveryKey)}
                disabled={!confirmed || saving}
              >
                Save Backup
              </button>
            </div>
          </>
        )}

        {step === "saving" && (
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <p>Encrypting and uploading backup...</p>
          </div>
        )}
      </div>
    </div>
  );
}
