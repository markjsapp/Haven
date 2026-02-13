import { useState, useCallback, useRef } from "react";
import {
  generateIdentityKeyPair,
  generateSignedPreKey,
  generateOneTimePreKeys,
  prepareRegistrationKeys,
  toBase64,
} from "@haven/core";
import { downloadAndRestoreBackup, cacheSecurityPhrase } from "../lib/backup.js";
import { useAuthStore, persistIdentityKey } from "../store/auth.js";
import { clearCryptoState } from "../lib/crypto.js";
import { useFocusTrap } from "../hooks/useFocusTrap.js";

const PREKEY_BATCH_SIZE = 20;

export default function SecurityPhraseRestore() {
  const completeBackupSetup = useAuthStore((s) => s.completeBackupSetup);

  const [phrase, setPhrase] = useState("");
  const [error, setError] = useState("");
  const [restoring, setRestoring] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);

  const handleRestore = useCallback(async () => {
    if (!phrase.trim()) return;
    setRestoring(true);
    setError("");
    try {
      await downloadAndRestoreBackup(phrase.trim());
      cacheSecurityPhrase(phrase.trim());

      // After restore, upload fresh prekeys (identity key came from backup)
      const { api, identityKeyPair, store } = useAuthStore.getState();
      if (identityKeyPair) {
        const signedPre = generateSignedPreKey(identityKeyPair);
        const oneTimeKeys = generateOneTimePreKeys(PREKEY_BATCH_SIZE);
        await store.saveIdentityKeyPair(identityKeyPair);
        await store.saveSignedPreKey(signedPre);
        await store.saveOneTimePreKeys(oneTimeKeys);

        const keys = prepareRegistrationKeys(identityKeyPair, signedPre, oneTimeKeys);
        await Promise.all([
          api.updateKeys({
            identity_key: keys.identity_key,
            signed_prekey: keys.signed_prekey,
            signed_prekey_signature: keys.signed_prekey_signature,
          }),
          api.uploadPreKeys({ prekeys: keys.one_time_prekeys }),
        ]);

        useAuthStore.setState({ signedPreKey: signedPre });
      }

      completeBackupSetup();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Restore failed";
      if (msg.includes("wrong secret key") || msg.includes("ciphertext")) {
        setError("Incorrect security phrase. Please try again.");
      } else {
        setError(msg);
      }
      setRestoring(false);
    }
  }, [phrase, completeBackupSetup]);

  const handleSkip = useCallback(async () => {
    // Generate fresh keys — historical messages won't be readable
    setRestoring(true);
    try {
      const { api, user, store } = useAuthStore.getState();
      if (!user) return;

      clearCryptoState();
      const identity = generateIdentityKeyPair();
      persistIdentityKey(user.id, identity);
      const signedPre = generateSignedPreKey(identity);
      const oneTimeKeys = generateOneTimePreKeys(PREKEY_BATCH_SIZE);

      await store.saveIdentityKeyPair(identity);
      await store.saveSignedPreKey(signedPre);
      await store.saveOneTimePreKeys(oneTimeKeys);

      const keys = prepareRegistrationKeys(identity, signedPre, oneTimeKeys);
      await Promise.all([
        api.updateKeys({
          identity_key: keys.identity_key,
          signed_prekey: keys.signed_prekey,
          signed_prekey_signature: keys.signed_prekey_signature,
        }),
        api.uploadPreKeys({ prekeys: keys.one_time_prekeys }),
      ]);

      useAuthStore.setState({
        identityKeyPair: identity,
        signedPreKey: signedPre,
      });
      completeBackupSetup();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate new keys");
      setRestoring(false);
    }
  }, [completeBackupSetup]);

  return (
    <div className="modal-overlay" role="presentation">
      <div className="modal-dialog" style={{ maxWidth: 460 }} ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="security-restore-title">
        <h2 style={{ marginBottom: 8 }} id="security-restore-title">Restore Your Keys</h2>
        <p className="security-phrase-desc">
          An encrypted key backup was found for your account.
          Enter your security phrase or recovery key to restore your messages.
        </p>
        <label className="security-phrase-label">Security Phrase / Recovery Key</label>
        <input
          type="password"
          className="modal-input"
          placeholder="Enter your security phrase..."
          value={phrase}
          onChange={(e) => { setPhrase(e.target.value); setError(""); }}
          onKeyDown={(e) => e.key === "Enter" && handleRestore()}
          autoFocus
          disabled={restoring}
        />
        {error && <p className="modal-error">{error}</p>}
        <div className="security-phrase-actions">
          <button
            className="security-phrase-skip"
            onClick={handleSkip}
            disabled={restoring}
          >
            Skip (generate new keys)
          </button>
          <button
            className="btn-primary"
            onClick={handleRestore}
            disabled={restoring || !phrase.trim()}
          >
            {restoring ? "Restoring..." : "Restore Keys"}
          </button>
        </div>
        <p className="security-phrase-warning">
          Skipping will generate fresh keys. You won't be able to read previous encrypted messages.
        </p>
      </div>
    </div>
  );
}
