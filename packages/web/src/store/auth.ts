import { create } from "zustand";
import { getServerUrl } from "../lib/serverUrl";
import {
  HavenApi,
  initSodium,
  toBase64,
  fromBase64,
  generateIdentityKeyPair,
  generateSignedPreKey,
  generateOneTimePreKeys,
  prepareRegistrationKeys,
  MemoryStore,
  isLoginSuccess,
  type UserPublic,
  type IdentityKeyPair,
  type SignedPreKey,
  type DHKeyPair,
} from "@haven/core";
import { clearCryptoState } from "../lib/crypto.js";
import { checkBackupStatus, clearCachedPhrase } from "../lib/backup.js";
import { initNotifications } from "../lib/notifications.js";

const PREKEY_BATCH_SIZE = 20;

// ─── Persistent Identity Key Storage ─────────────────
// Identity keys MUST survive page reloads. If regenerated on every login,
// all existing SKDMs (encrypted with the old key) become undecryptable.

const IDENTITY_KEY_PREFIX = "haven:identity:";

export function persistIdentityKey(userId: string, kp: IdentityKeyPair): void {
  const data = JSON.stringify({
    publicKey: toBase64(kp.publicKey),
    privateKey: toBase64(kp.privateKey),
  });
  localStorage.setItem(IDENTITY_KEY_PREFIX + userId, data);
}

function loadPersistedIdentityKey(userId: string): IdentityKeyPair | null {
  const raw = localStorage.getItem(IDENTITY_KEY_PREFIX + userId);
  if (!raw) return null;
  try {
    const { publicKey, privateKey } = JSON.parse(raw);
    return {
      publicKey: fromBase64(publicKey),
      privateKey: fromBase64(privateKey),
    };
  } catch {
    return null;
  }
}

function clearPersistedIdentityKey(userId: string): void {
  localStorage.removeItem(IDENTITY_KEY_PREFIX + userId);
}

// ─── Persistent Signed PreKey Storage ────────────────
// Signed prekeys MUST survive page reloads. If regenerated on every login,
// pending X3DH messages encrypted with the old signed prekey can't be decrypted
// (the responder would use a different DH key, producing a different shared secret).

const SIGNED_PREKEY_PREFIX = "haven:signedPreKey:";

export function persistSignedPreKey(userId: string, spk: SignedPreKey): void {
  const data = JSON.stringify({
    publicKey: toBase64(spk.keyPair.publicKey),
    privateKey: toBase64(spk.keyPair.privateKey),
    signature: toBase64(spk.signature),
  });
  localStorage.setItem(SIGNED_PREKEY_PREFIX + userId, data);
}

function loadPersistedSignedPreKey(userId: string): SignedPreKey | null {
  const raw = localStorage.getItem(SIGNED_PREKEY_PREFIX + userId);
  if (!raw) return null;
  try {
    const { publicKey, privateKey, signature } = JSON.parse(raw);
    return {
      keyPair: {
        publicKey: fromBase64(publicKey),
        privateKey: fromBase64(privateKey),
      },
      signature: fromBase64(signature),
    };
  } catch {
    return null;
  }
}

interface AuthState {
  user: UserPublic | null;
  api: HavenApi;
  store: MemoryStore;
  identityKeyPair: IdentityKeyPair | null;
  signedPreKey: SignedPreKey | null;
  initialized: boolean;
  backupPending: boolean;
  backupAvailable: boolean;

  init(): Promise<void>;
  register(username: string, password: string, displayName?: string, inviteCode?: string, turnstileToken?: string): Promise<void>;
  login(username: string, password: string, totpCode?: string): Promise<"totp_required" | void>;
  logout(): void;
  completeBackupSetup(): void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  api: new HavenApi({ baseUrl: getServerUrl() }),
  store: new MemoryStore(),
  identityKeyPair: null,
  signedPreKey: null,
  initialized: false,
  backupPending: false,
  backupAvailable: false,

  async init() {
    if (get().initialized) return;
    await initSodium();
    await initNotifications();
    set({ initialized: true });
  },

  async register(username, password, displayName, inviteCode, turnstileToken) {
    await get().init();

    // Clear any stale crypto state from a previous session
    clearCryptoState();

    const identity = generateIdentityKeyPair();
    const signedPre = generateSignedPreKey(identity);
    const oneTimeKeys = generateOneTimePreKeys(PREKEY_BATCH_SIZE);

    const keys = prepareRegistrationKeys(identity, signedPre, oneTimeKeys);

    const { api, store } = get();
    const res = await api.register({
      username,
      password,
      display_name: displayName,
      identity_key: keys.identity_key,
      signed_prekey: keys.signed_prekey,
      signed_prekey_signature: keys.signed_prekey_signature,
      one_time_prekeys: keys.one_time_prekeys,
      invite_code: inviteCode,
      turnstile_token: turnstileToken,
    });

    // Persist keys to localStorage so they survive page reloads
    persistIdentityKey(res.user.id, identity);
    persistSignedPreKey(res.user.id, signedPre);

    await store.saveIdentityKeyPair(identity);
    await store.saveSignedPreKey(signedPre);
    await store.saveOneTimePreKeys(oneTimeKeys);

    set({
      user: res.user,
      identityKeyPair: identity,
      signedPreKey: signedPre,
      backupPending: true,
      backupAvailable: false,
    });
  },

  async login(username, password, totpCode) {
    await get().init();

    const { api } = get();
    const res = await api.login({ username, password, totp_code: totpCode });

    // If TOTP is required, signal the UI to show the TOTP step
    if (!isLoginSuccess(res)) {
      return "totp_required";
    }

    // Try to reuse the persisted identity key for this user.
    // Generating a new identity key on every login would invalidate all
    // existing SKDMs encrypted with the old key, causing decryption failures.
    let identity = loadPersistedIdentityKey(res.user.id);
    let identityChanged = false;

    if (!identity) {
      // No local identity key — check if server has an encrypted backup
      try {
        const status = await checkBackupStatus();
        if (status.hasBackup) {
          // Backup exists — defer key setup until user enters security phrase
          set({
            user: res.user,
            identityKeyPair: null,
            signedPreKey: null,
            backupPending: true,
            backupAvailable: true,
          });
          return;
        }
      } catch {
        // Backup check failed — proceed with new key generation
      }

      // No backup available — generate new keys
      identity = generateIdentityKeyPair();
      persistIdentityKey(res.user.id, identity);
      identityChanged = true;
    }

    // Reuse persisted signed prekey if identity key hasn't changed.
    // Generating a new signed prekey on every login breaks pending X3DH
    // messages — the responder would use a different DH key, producing a
    // different shared secret and causing decryption failure.
    let signedPre = identityChanged ? null : loadPersistedSignedPreKey(res.user.id);
    if (!signedPre) {
      signedPre = generateSignedPreKey(identity);
      persistSignedPreKey(res.user.id, signedPre);
    }

    // Always generate fresh one-time prekeys (they're consumed on use).
    const oneTimeKeys = generateOneTimePreKeys(PREKEY_BATCH_SIZE);

    const { store } = get();
    await store.saveIdentityKeyPair(identity);
    await store.saveSignedPreKey(signedPre);
    await store.saveOneTimePreKeys(oneTimeKeys);

    const keys = prepareRegistrationKeys(identity, signedPre, oneTimeKeys);

    if (identityChanged) {
      // New identity key — must update everything and clear stale crypto state
      clearCryptoState();
      await Promise.all([
        api.updateKeys({
          identity_key: keys.identity_key,
          signed_prekey: keys.signed_prekey,
          signed_prekey_signature: keys.signed_prekey_signature,
        }),
        // Clear stale OTPs (whose private keys are lost) before uploading fresh ones
        api.clearPreKeys().then(() =>
          api.uploadPreKeys({ prekeys: keys.one_time_prekeys }),
        ),
      ]);
    } else {
      // Same identity key — reuse signed prekey, refresh one-time prekeys.
      // Clear stale OTPs from previous sessions before uploading fresh ones.
      await Promise.all([
        api.updateKeys({
          identity_key: keys.identity_key,
          signed_prekey: keys.signed_prekey,
          signed_prekey_signature: keys.signed_prekey_signature,
        }),
        api.clearPreKeys().then(() =>
          api.uploadPreKeys({ prekeys: keys.one_time_prekeys }),
        ),
      ]);
    }

    set({
      user: res.user,
      identityKeyPair: identity,
      signedPreKey: signedPre,
      backupPending: false,
      backupAvailable: false,
    });
  },

  completeBackupSetup() {
    set({ backupPending: false });
  },

  logout() {
    const { api } = get();
    api.logout().catch(() => {});
    // Clear in-memory E2EE state (sessions, sender keys, etc.)
    clearCryptoState();
    clearCachedPhrase();
    set({
      user: null,
      identityKeyPair: null,
      signedPreKey: null,
      backupPending: false,
      backupAvailable: false,
    });
    // Note: we deliberately keep the persisted identity key in localStorage
    // so re-login on the same browser reuses it.
  },
}));

/** Convenience selector: is the current user an instance admin? */
export const useIsAdmin = () => useAuthStore((s) => s.user?.is_instance_admin === true);
