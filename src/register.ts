/** Register the service worker once the page has loaded. Safe to call on the server (no-op). */
export function registerServiceWorker(url = "/sw.js"): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
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
