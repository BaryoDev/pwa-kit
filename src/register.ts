/**
 * Register the service worker once the page has loaded. Safe to call on the server (no-op).
 *
 * When a new worker takes control after a deploy, the page reloads once so it runs against the
 * fresh assets instead of stale cached chunks (a common cause of a blank page or stuck spinner
 * after shipping). This only happens on an update, never the first install. Pass
 * `{ reloadOnUpdate: false }` to opt out.
 */
export function registerServiceWorker(
  url = "/sw.js",
  opts: { reloadOnUpdate?: boolean } = {},
): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

  if (opts.reloadOnUpdate !== false) {
    const hadController = !!navigator.serviceWorker.controller;
    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloading || !hadController) return; // skip the first install (no prior controller)
      reloading = true;
      if (typeof window !== "undefined") window.location.reload();
    });
  }

  const reg = () => {
    navigator.serviceWorker.register(url).catch(() => {});
  };
  if (typeof document !== "undefined" && document.readyState === "complete") reg();
  else if (typeof window !== "undefined") window.addEventListener("load", reg, { once: true });
}

/**
 * Ask the service worker to drop its cached API data. Call this on every sign-in and sign-out so
 * one account's cached responses are never served to another on a shared device.
 */
export function clearApiCache(): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.ready
    .then((reg) => reg.active?.postMessage("clear-api-cache"))
    .catch(() => {});
}

/** True when the app is running as an installed PWA (standalone display). */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/**
 * When launched as an installed PWA, lock the viewport so pinch- and double-tap-zoom are disabled,
 * making the app feel native. In a regular browser tab this is a no-op, so accessibility zoom still
 * works there. Returns a cleanup function that removes the pinch listener (no-op when not standalone
 * or on the server). Safe to call on the server.
 */
export function lockViewportWhenStandalone(): () => void {
  if (typeof document === "undefined" || !isStandalone()) return () => {};

  let meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "viewport";
    document.head.appendChild(meta);
  }
  meta.content =
    "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover";

  // Belt-and-suspenders for iOS, which ignores user-scalable=no: block the pinch gesture.
  const preventPinch = (e: TouchEvent) => {
    if (e.touches.length > 1) e.preventDefault();
  };
  document.addEventListener("touchmove", preventPinch, { passive: false });
  return () => document.removeEventListener("touchmove", preventPinch);
}
