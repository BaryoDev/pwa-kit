import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pwaStatus, reportPwaStatus } from "../src/report";

function stubBrowser(opts: { modes?: string[]; ua?: string; iosStandalone?: boolean; storage?: object } = {}) {
  const data = new Map<string, string>();
  const listeners: Record<string, () => void> = {};
  const win = {
    localStorage: opts.storage ?? {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    },
    matchMedia: (q: string) => ({ matches: (opts.modes ?? []).some((m) => q.includes(m)) }),
    navigator: { standalone: opts.iosStandalone },
    addEventListener: (t: string, fn: () => void) => void (listeners[t] = fn),
    removeEventListener: (t: string) => void delete listeners[t],
  };
  vi.stubGlobal("window", win);
  vi.stubGlobal("navigator", { userAgent: opts.ua ?? "Mozilla/5.0 (X11; Linux x86_64)" });
  return { data, listeners };
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe("pwaStatus", () => {
  it("is null on the server", () => {
    expect(pwaStatus()).toBeNull();
  });

  it("has the documented shape", () => {
    stubBrowser();
    const s = pwaStatus()!;
    expect(Object.keys(s).sort()).toEqual(["deviceId", "displayMode", "installed", "platform"]);
    expect(typeof s.deviceId).toBe("string");
    expect(s.displayMode).toBe("browser");
    expect(s.installed).toBe(false);
    expect(s.platform).toBe("linux");
  });

  it("reports standalone as installed", () => {
    stubBrowser({ modes: ["standalone"] });
    expect(pwaStatus()).toMatchObject({ displayMode: "standalone", installed: true });
  });

  it("treats iOS home-screen apps as standalone", () => {
    stubBrowser({ iosStandalone: true, ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" });
    expect(pwaStatus()).toMatchObject({ displayMode: "standalone", installed: true, platform: "ios" });
  });

  it.each([
    ["Mozilla/5.0 (Linux; Android 14)", "android"],
    ["Mozilla/5.0 (Windows NT 10.0)", "windows"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)", "macos"],
    ["curl/8", "other"],
  ])("detects the platform from %s", (ua, platform) => {
    stubBrowser({ ua });
    expect(pwaStatus()!.platform).toBe(platform);
  });

  it("keeps the device id across calls and honours storageKey", () => {
    const { data } = stubBrowser();
    const a = pwaStatus({ storageKey: "k" })!.deviceId;
    expect(pwaStatus({ storageKey: "k" })!.deviceId).toBe(a);
    expect(data.get("k")).toBe(a);
  });

  it("falls back to an ephemeral id when storage throws", () => {
    stubBrowser({
      storage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {},
      },
    });
    expect(pwaStatus()!.deviceId).toMatch(/^ephemeral-/);
  });
});

describe("reportPwaStatus", () => {
  it("sends once on launch and again on appinstalled", () => {
    const { listeners } = stubBrowser();
    const send = vi.fn();
    const stop = reportPwaStatus(send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ installed: false, displayMode: "browser" });

    listeners.appinstalled();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0]).toMatchObject({ installed: true, displayMode: "standalone" });

    stop();
    expect(listeners.appinstalled).toBeUndefined();
  });
});
