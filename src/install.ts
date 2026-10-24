import { isStandalone } from "./register";

export type InstallState = "installed" | "prompt" | "ios-steps" | "unavailable";
export type InstallOutcome = "accepted" | "dismissed" | "unavailable";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const cb of [...listeners]) cb();
}

// Attached at import: the browser can fire `beforeinstallprompt` before any component mounts.
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("beforeinstallprompt", (e: Event) => {
    e.preventDefault(); // keep the browser's own banner from showing
    deferred = e as InstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    installed = true;
    deferred = null;
    emit();
  });
}

const WEBVIEW_UA =
  /FBAN|FBAV|FB_IAB|FBIOS|Instagram|Messenger|Line\/|Snapchat|TikTok|musical_ly|Bytedance|LinkedInApp|Twitter|MicroMessenger|; wv\)/i;

function isIos(): boolean {
  const ua = navigator.userAgent;
  return (
    /iphone|ipad|ipod/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function isInAppWebview(): boolean {
  const ua = navigator.userAgent;
  if (WEBVIEW_UA.test(ua)) return true;
  // An iOS web view has no "Safari" token; real iOS browsers (Safari, Chrome, Firefox) do.
  return /iphone|ipad|ipod/i.test(ua) && !/safari/i.test(ua);
}

/**
 * Where the install flow stands right now:
 * - `installed`: running as an installed app, or `appinstalled` fired.
 * - `prompt`: the browser has a saved install prompt, so `promptInstall()` will show it.
 * - `ios-steps`: iOS browser with no prompt API; show the Share, then Add to Home Screen steps.
 * - `unavailable`: in-app web views, browsers with no install path, and the server.
 * A browser that will fire `beforeinstallprompt` later reports `unavailable` until it does;
 * use `onInstallStateChange` to hear about it.
 */
export function installState(): InstallState {
  if (typeof window === "undefined" || typeof navigator === "undefined") return "unavailable";
  if (installed || isStandalone()) return "installed";
  if (isInAppWebview()) return "unavailable";
  if (isIos()) return "ios-steps";
  if (deferred) return "prompt";
  return "unavailable";
}

/**
 * Show the saved install prompt and resolve with the user's choice. The saved event is used
 * once, so afterwards the state is no longer `prompt`. Resolves `unavailable` when none is saved.
 */
export async function promptInstall(): Promise<InstallOutcome> {
  const event = deferred;
  if (!event) return "unavailable";
  deferred = null;
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    return outcome;
  } finally {
    emit();
  }
}

/**
 * Call `cb` when the install prompt arrives, after it is used, and on `appinstalled`.
 * Returns a function that stops listening.
 */
export function onInstallStateChange(cb: (state: InstallState) => void): () => void {
  const fn = () => cb(installState());
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
