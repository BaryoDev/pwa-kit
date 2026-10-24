export interface RegisterOptions {
  /** Set to false to neither reload nor listen for a new worker. Default true. */
  reloadOnUpdate?: boolean;
  /**
   * Called instead of reloading when a new worker takes over. Call `reload()` when it is safe
   * (a game between runs, a form with no unsaved input). `reload` only reloads once.
   */
  onUpdate?: (reload: () => void) => void;
  /** Minimum milliseconds between update checks on load and resume. Default 60000. */
  updateIntervalMs?: number;
}

/**
 * Register the service worker once the page has loaded. Safe to call on the server (no-op).
 *
 * The worker file is never served from the HTTP cache (`updateViaCache: "none"`), and the page asks
 * for a new version after load and whenever it becomes visible again (at most once per
 * `updateIntervalMs`, default 60 s), so an installed app resumed from the background picks up a deploy.
 *
 * When a new worker takes control after a deploy, the page reloads once so it runs against the
 * fresh assets instead of stale cached chunks (a common cause of a blank page or stuck spinner
 * after shipping). This only happens on an update, never the first install. Pass `onUpdate` to
 * choose the moment yourself, or `{ reloadOnUpdate: false }` to opt out.
 *
 * Returns a function that removes the listeners this call added.
 */
export function registerServiceWorker(url = "/sw.js", opts: RegisterOptions = {}): () => void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return () => {};

  const cleanups: Array<() => void> = [];

  if (opts.reloadOnUpdate !== false) {
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    const reload = () => {
      if (reloaded) return;
      reloaded = true;
      if (typeof window !== "undefined") window.location.reload();
    };
    const onChange = () => {
      if (!hadController) return; // skip the first install (no prior controller)
      if (opts.onUpdate) opts.onUpdate(reload);
      else reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onChange);
    cleanups.push(() => navigator.serviceWorker.removeEventListener?.("controllerchange", onChange));
  }

  const interval = opts.updateIntervalMs ?? 60_000;
  let registration: ServiceWorkerRegistration | undefined;
  let lastCheck = -Infinity;
  const check = () => {
    if (!registration) return;
    const now = Date.now();
    if (now - lastCheck < interval) return;
    lastCheck = now;
    Promise.resolve(registration.update()).catch(() => {});
  };

  const onVisible = () => {
    if (document.visibilityState === "visible") check();
  };
  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("visibilitychange", onVisible);
    cleanups.push(() => document.removeEventListener("visibilitychange", onVisible));
  }

  const reg = () => {
    navigator.serviceWorker
      .register(url, { updateViaCache: "none" })
      .then((r) => {
        registration = r;
        check();
      })
      .catch(() => {});
  };
  if (typeof document !== "undefined" && document.readyState === "complete") reg();
  else if (typeof window !== "undefined") {
    window.addEventListener("load", reg, { once: true });
    cleanups.push(() => window.removeEventListener?.("load", reg));
  }

  return () => cleanups.forEach((fn) => fn());
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
