import { create } from "zustand";
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
  type UserPublic,
  type IdentityKeyPair,
  type SignedPreKey,
  type DHKeyPair,
} from "@haven/core";
import { clearCryptoState } from "../lib/crypto.js";

const PREKEY_BATCH_SIZE = 20;

// ─── Persistent Identity Key Storage ─────────────────
// Identity keys MUST survive page reloads. If regenerated on every login,
// all existing SKDMs (encrypted with the old key) become undecryptable.

const IDENTITY_KEY_PREFIX = "haven:identity:";

function persistIdentityKey(userId: string, kp: IdentityKeyPair): void {
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

interface AuthState {
  user: UserPublic | null;
  api: HavenApi;
  store: MemoryStore;
  identityKeyPair: IdentityKeyPair | null;
  signedPreKey: SignedPreKey | null;
  initialized: boolean;

  init(): Promise<void>;
  register(username: string, password: string, displayName?: string): Promise<void>;
  login(username: string, password: string, totpCode?: string): Promise<void>;
  logout(): void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  api: new HavenApi({ baseUrl: window.location.origin }),
  store: new MemoryStore(),
  identityKeyPair: null,
  signedPreKey: null,
  initialized: false,

  async init() {
    if (get().initialized) return;
    await initSodium();
    set({ initialized: true });
  },

  async register(username, password, displayName) {
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
    });

    // Persist identity key to localStorage so it survives page reloads
    persistIdentityKey(res.user.id, identity);

    await store.saveIdentityKeyPair(identity);
    await store.saveSignedPreKey(signedPre);
    await store.saveOneTimePreKeys(oneTimeKeys);

    set({
      user: res.user,
      identityKeyPair: identity,
      signedPreKey: signedPre,
    });
  },

  async login(username, password, totpCode) {
    await get().init();

    const { api } = get();
    const res = await api.login({ username, password, totp_code: totpCode });

    // Try to reuse the persisted identity key for this user.
    // Generating a new identity key on every login would invalidate all
    // existing SKDMs encrypted with the old key, causing decryption failures.
    let identity = loadPersistedIdentityKey(res.user.id);
    let identityChanged = false;

    if (!identity) {
      // First login on this browser (or keys were cleared) — generate new keys
      identity = generateIdentityKeyPair();
      persistIdentityKey(res.user.id, identity);
      identityChanged = true;
    }

    // Always generate fresh prekeys (they're meant to be rotated)
    const signedPre = generateSignedPreKey(identity);
    const oneTimeKeys = generateOneTimePreKeys(PREKEY_BATCH_SIZE);

    const { store } = get();
    await store.saveIdentityKeyPair(identity);
    await store.saveSignedPreKey(signedPre);
    await store.saveOneTimePreKeys(oneTimeKeys);

    const keys = prepareRegistrationKeys(identity, signedPre, oneTimeKeys);

    if (identityChanged) {
      // New identity key — must update everything including identity key,
      // and clear stale crypto state
      clearCryptoState();
      await Promise.all([
        api.updateKeys({
          identity_key: keys.identity_key,
          signed_prekey: keys.signed_prekey,
          signed_prekey_signature: keys.signed_prekey_signature,
        }),
        api.uploadPreKeys({ prekeys: keys.one_time_prekeys }),
      ]);
    } else {
      // Same identity key — only refresh prekeys (signed + one-time)
      await Promise.all([
        api.updateKeys({
          identity_key: keys.identity_key,
          signed_prekey: keys.signed_prekey,
          signed_prekey_signature: keys.signed_prekey_signature,
        }),
        api.uploadPreKeys({ prekeys: keys.one_time_prekeys }),
      ]);
    }

    set({
      user: res.user,
      identityKeyPair: identity,
      signedPreKey: signedPre,
    });
  },

  logout() {
    const { api } = get();
    api.logout().catch(() => {});
    // Clear in-memory E2EE state (sessions, sender keys, etc.)
    clearCryptoState();
    set({ user: null, identityKeyPair: null, signedPreKey: null });
    // Note: we deliberately keep the persisted identity key in localStorage
    // so re-login on the same browser reuses it.
  },
}));
