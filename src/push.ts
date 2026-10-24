export type PushSupport =
  | { ok: true }
  | { ok: false; reason: "unsupported" | "ios-not-installed" | "denied" };

function isIos(): boolean {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  // iPadOS 13+ reports a Mac user agent; a touch screen tells it apart from a real Mac.
  return /Macintosh/.test(ua) && typeof navigator !== "undefined" && navigator.maxTouchPoints > 1;
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

function keyToBytes(key: string) {
  const bad = () => new Error("invalid VAPID public key: expected 65 bytes as base64url");
  let raw: string;
  try {
    const padded = key.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (key.length % 4)) % 4);
    raw = atob(padded);
  } catch {
    throw bad();
  }
  if (raw.length !== 65) throw bad();
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return false;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

/**
 * Ask for notification permission and subscribe to push. Call it from a user gesture (a click),
 * and only after a moment the user cares about. Returns the subscription JSON to send to your
 * server. An existing subscription is reused.
 */
export async function subscribePush(vapidPublicKey: string): Promise<PushSubscriptionJSON> {
  const support = pushSupport();
  if (!support.ok) throw new Error(`push unavailable: ${support.reason}`);
  // Check the key and the worker before prompting, so a mistake does not spend the permission prompt.
  const keyBytes = keyToBytes(vapidPublicKey);
  if (!(await navigator.serviceWorker.getRegistration())) {
    throw new Error("push unavailable: no service worker");
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("push unavailable: denied");
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  let reuse = existing;
  if (existing && !sameKey(existing.options?.applicationServerKey, keyBytes)) {
    // Subscribed with another VAPID key (a rotation); sends would fail, so start over.
    await existing.unsubscribe();
    reuse = null;
  }
  const sub =
    reuse ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes }));
  return sub.toJSON();
}

/** Remove the push subscription. Returns true when there was one to remove. */
export async function unsubscribePush(): Promise<boolean> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return false;
  if (!(await navigator.serviceWorker.getRegistration())) return false;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return sub ? sub.unsubscribe() : false;
}
