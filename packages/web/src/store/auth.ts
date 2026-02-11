import { create } from "zustand";
import {
  HavenApi,
  initSodium,
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

const PREKEY_BATCH_SIZE = 20;

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

    // Persist keys locally
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

    // Regenerate local keys since MemoryStore is ephemeral.
    const identity = generateIdentityKeyPair();
    const signedPre = generateSignedPreKey(identity);
    const oneTimeKeys = generateOneTimePreKeys(PREKEY_BATCH_SIZE);

    const { store } = get();
    await store.saveIdentityKeyPair(identity);
    await store.saveSignedPreKey(signedPre);
    await store.saveOneTimePreKeys(oneTimeKeys);

    // Upload the new keys to the server so other users can establish sessions
    const keys = prepareRegistrationKeys(identity, signedPre, oneTimeKeys);
    await api.updateKeys({
      identity_key: keys.identity_key,
      signed_prekey: keys.signed_prekey,
      signed_prekey_signature: keys.signed_prekey_signature,
    });
    // Also upload fresh one-time prekeys
    await api.uploadPreKeys({ prekeys: keys.one_time_prekeys });

    set({
      user: res.user,
      identityKeyPair: identity,
      signedPreKey: signedPre,
    });
  },

  logout() {
    const { api } = get();
    api.logout().catch(() => {});
    set({ user: null, identityKeyPair: null, signedPreKey: null });
  },
}));
