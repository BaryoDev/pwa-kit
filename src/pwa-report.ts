// Reports whether the app is running as an installed PWA (added to the home screen) vs a browser tab,
// so a backend can track adoption and — when the user is signed in — who installed it. Frontend only;
// you supply the `send` callback that posts the report through your own (authenticated) API client.

export type DisplayMode = "standalone" | "minimal-ui" | "fullscreen" | "browser";

export interface PwaReport {
  /** Stable per-browser id, persisted in localStorage so repeat launches dedupe server-side. */
  deviceId: string;
  displayMode: DisplayMode;
  /** ios | android | windows | macos | linux | other */
  platform: string;
  /** True when running as an installed app (standalone/fullscreen, or iOS home-screen). */
  installed: boolean;
}

export interface ReportPwaOptions {
  /** localStorage key for the device id. Default "bd_pwa_device". */
  storageKey?: string;
}

const DEFAULT_KEY = "bd_pwa_device";

function deviceId(key: string): string {
  try {
    let id = window.localStorage.getItem(key);
    if (!id) {
      id =
        (typeof crypto !== "undefined" && crypto.randomUUID?.()) ||
        `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      window.localStorage.setItem(key, id);
    }
    return id;
  } catch {
    // Storage blocked (private mode): use an ephemeral id so a report still lands.
    return `ephemeral-${Math.random().toString(36).slice(2)}`;
  }
}

function currentDisplayMode(): DisplayMode {
  if (typeof window === "undefined") return "browser";
  for (const mode of ["fullscreen", "standalone", "minimal-ui"] as const) {
    if (window.matchMedia?.(`(display-mode: ${mode})`).matches) return mode;
  }
  // iOS Safari reports installed home-screen apps here, not via display-mode.
  if ((window.navigator as unknown as { standalone?: boolean }).standalone) return "standalone";
  return "browser";
}

function platform(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  if (/Windows/.test(ua)) return "windows";
  if (/Mac OS X|Macintosh/.test(ua)) return "macos";
  if (/Linux/.test(ua)) return "linux";
  return "other";
}

/** A snapshot of the current PWA status, or null on the server. */
export function pwaStatus(opts: ReportPwaOptions = {}): PwaReport | null {
  if (typeof window === "undefined") return null;
  const mode = currentDisplayMode();
  return {
    deviceId: deviceId(opts.storageKey ?? DEFAULT_KEY),
    displayMode: mode,
    platform: platform(),
    installed: mode !== "browser",
  };
}

/**
 * Report the current PWA status once on launch, and again if the app is installed during this
 * session (the `appinstalled` event). `send` receives the report — wire it to your API, e.g.
 * `reportPwaStatus((r) => api.post("/api/pwa/report", r))`. Returns a cleanup function.
 * No-op on the server.
 */
export function reportPwaStatus(
  send: (report: PwaReport) => void | Promise<void>,
  opts: ReportPwaOptions = {},
): () => void {
  if (typeof window === "undefined") return () => {};

  const fire = (installedOverride?: boolean) => {
    const status = pwaStatus(opts);
    if (!status) return;
    if (installedOverride) {
      status.installed = true;
      if (status.displayMode === "browser") status.displayMode = "standalone";
    }
    try {
      void send(status);
    } catch {
      /* best-effort telemetry — never break the app */
    }
  };

  fire();
  const onInstalled = () => fire(true);
  window.addEventListener("appinstalled", onInstalled);
  return () => window.removeEventListener("appinstalled", onInstalled);
}
