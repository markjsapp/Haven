import { isTauri } from "./tauriEnv";

const SERVER_URL_KEY = "haven:server-url";

/** Get the stored server URL from localStorage (set during Tauri first-launch). */
export function getStoredServerUrl(): string | null {
  try {
    return window.localStorage.getItem(SERVER_URL_KEY);
  } catch {
    return null;
  }
}

/** Persist the server URL to localStorage. */
export function setStoredServerUrl(url: string): void {
  window.localStorage.setItem(SERVER_URL_KEY, url);
}

/** Clear the stored server URL. */
export function clearStoredServerUrl(): void {
  window.localStorage.removeItem(SERVER_URL_KEY);
}

/**
 * Whether the user needs to provide a server URL before the app can work.
 * True when running in Tauri with no stored URL.
 */
export function needsServerUrl(): boolean {
  return isTauri() && !getStoredServerUrl();
}

/**
 * Resolve the base URL for API and WebSocket connections.
 *
 * Priority:
 *   1. Stored server URL from Tauri connect screen (localStorage)
 *   2. VITE_SERVER_URL env variable (build-time override)
 *   3. window.location.origin (browser/embedded — existing behavior)
 */
export function getServerUrl(): string {
  const stored = getStoredServerUrl();
  if (stored) return stored.replace(/\/+$/, "");

  if (import.meta.env.VITE_SERVER_URL) {
    return (import.meta.env.VITE_SERVER_URL as string).replace(/\/+$/, "");
  }

  return window.location.origin;
}
