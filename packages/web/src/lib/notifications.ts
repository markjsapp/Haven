import { isTauri } from "./tauriEnv";

let permissionGranted = false;

export async function initNotifications(): Promise<void> {
  if (isTauri()) {
    const { isPermissionGranted, requestPermission } = await import(
      "@tauri-apps/plugin-notification"
    );
    permissionGranted = await isPermissionGranted();
    if (!permissionGranted) {
      const result = await requestPermission();
      permissionGranted = result === "granted";
    }
  } else if ("Notification" in window) {
    if (Notification.permission === "granted") {
      permissionGranted = true;
    } else if (Notification.permission !== "denied") {
      const result = await Notification.requestPermission();
      permissionGranted = result === "granted";
    }
  }
}

export async function sendNotification(
  title: string,
  body: string,
): Promise<void> {
  if (!permissionGranted) return;
  if (document.hasFocus()) return;

  if (isTauri()) {
    const { sendNotification: tauriNotify } = await import(
      "@tauri-apps/plugin-notification"
    );
    tauriNotify({ title, body });
  } else if ("Notification" in window) {
    new Notification(title, { body });
  }
}
