import { isStandalone } from "./register";

export type InstallState = "installed" | "prompt" | "ios-steps" | "unavailable";
export type InstallOutcome = "accepted" | "dismissed" | "unavailable";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface Shared {
  deferred: InstallPromptEvent | null;
  installed: boolean;
  attached: boolean;
  listeners: Set<() => void>;
}

// The root and /install entries are built separately (no shared chunk), so each bundles its own
// copy of this file. Keeping the state on globalThis makes every copy see the same prompt.
const KEY = Symbol.for("@baryodev/pwa-kit/install");
const g = globalThis as unknown as Record<symbol, Shared | undefined>;
const shared: Shared = (g[KEY] ??= {
  deferred: null,
  installed: false,
  attached: false,
  listeners: new Set(),
});

function emit(): void {
  for (const cb of [...shared.listeners]) cb();
}

// Attached at import, once per page: the browser can fire `beforeinstallprompt` before any
// component mounts.
if (!shared.attached && typeof window !== "undefined" && typeof window.addEventListener === "function") {
  shared.attached = true;
  window.addEventListener("beforeinstallprompt", (e: Event) => {
    e.preventDefault(); // keep the browser's own banner from showing
    shared.deferred = e as InstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    shared.installed = true;
    shared.deferred = null;
    emit();
  });
}

// Tokens are case-sensitive and bounded so "Headline/1.0" is not read as LINE.
const WEBVIEW_UA =
  /\bFB(?:AN|AV|_IAB|IOS)\b|\bInstagram\b|\bMessenger(?:Lite)?\b|\bLine\/\d|\bSnapchat\b|\bTikTok\b|\bmusical_ly\b|\bBytedanceWebview\b|\bLinkedInApp\b|\bTwitter(?:Android)?\b|\bMicroMessenger\/|; wv\)/;

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
  if (shared.installed || isStandalone()) return "installed";
  if (isInAppWebview()) return "unavailable";
  if (isIos()) return "ios-steps";
  if (shared.deferred) return "prompt";
  return "unavailable";
}

/**
 * Show the saved install prompt and resolve with the user's choice. The saved event is used
 * once, so afterwards the state is no longer `prompt`. Resolves `unavailable` when none is saved
 * or the browser refuses to show it (the event is kept for a retry). A `userChoice` that never
 * settles leaves the promise pending, which is browser behaviour.
 */
export async function promptInstall(): Promise<InstallOutcome> {
  const event = shared.deferred;
  if (!event) return "unavailable";
  shared.deferred = null;
  try {
    try {
      await event.prompt();
    } catch {
      // No user activation, or the browser refused. Keep the event so a later click can retry.
      if (!shared.deferred && !shared.installed) shared.deferred = event;
      return "unavailable";
    }
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
  shared.listeners.add(fn);
  return () => {
    shared.listeners.delete(fn);
  };
}
