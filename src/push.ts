export type PushSupport =
  | { ok: true }
  | { ok: false; reason: "unsupported" | "ios-not-installed" | "denied" };

function isIos(): boolean {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  return /iPhone|iPad|iPod/.test(ua);
}

function isInstalled(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || !!window.matchMedia?.("(display-mode: standalone)").matches;
}

/**
 * Whether push can work here, and if not, why. iOS 16.4+ allows push only for apps installed to
 * the home screen, so a Safari tab on iOS reports "ios-not-installed".
 */
export function pushSupport(): PushSupport {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return { ok: false, reason: "unsupported" };
  }
  // In a plain iOS tab PushManager is missing, so check this first to give the useful reason.
  if (isIos() && !isInstalled()) return { ok: false, reason: "ios-not-installed" };
  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    typeof Notification === "undefined"
  ) {
    return { ok: false, reason: "unsupported" };
  }
  if (Notification.permission === "denied") return { ok: false, reason: "denied" };
  return { ok: true };
}

function keyToBytes(key: string): Uint8Array<ArrayBuffer> {
  const padded = key.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (key.length % 4)) % 4);
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Ask for notification permission and subscribe to push. Call it from a user gesture (a click),
 * and only after a moment the user cares about. Returns the subscription JSON to send to your
 * server. An existing subscription is reused.
 */
export async function subscribePush(vapidPublicKey: string): Promise<PushSubscriptionJSON> {
  const support = pushSupport();
  if (!support.ok) throw new Error(`push unavailable: ${support.reason}`);
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("push unavailable: denied");
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyToBytes(vapidPublicKey),
    }));
  return sub.toJSON();
}

/** Remove the push subscription. Returns true when there was one to remove. */
export async function unsubscribePush(): Promise<boolean> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return false;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return sub ? sub.unsubscribe() : false;
}
