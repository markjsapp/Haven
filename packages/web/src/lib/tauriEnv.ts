/**
 * Detect whether the app is running inside a Tauri desktop shell.
 * Tauri v2 injects `__TAURI_INTERNALS__` onto the window object.
 */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
