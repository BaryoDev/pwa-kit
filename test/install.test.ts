import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPHONE_FB = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/450.0]";
const IPHONE_WEBVIEW = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const ANDROID_FB = "Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/450.0]";
const DESKTOP = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36";

type Handler = (e: unknown) => void;

function stubBrowser(opts: { ua?: string; standalone?: boolean; platform?: string; touch?: number } = {}) {
  const listeners: Record<string, Handler[]> = {};
  const win = {
    matchMedia: (q: string) => ({ matches: !!opts.standalone && q.includes("standalone") }),
    addEventListener: (t: string, fn: Handler) => void (listeners[t] ??= []).push(fn),
  };
  vi.stubGlobal("window", win);
  vi.stubGlobal("navigator", {
    userAgent: opts.ua ?? DESKTOP,
    platform: opts.platform ?? "Linux x86_64",
    maxTouchPoints: opts.touch ?? 0,
  });
  const fire = (type: string, e: unknown = {}) => (listeners[type] ?? []).forEach((fn) => fn(e));
  return { listeners, fire };
}

function promptEvent(outcome: "accepted" | "dismissed") {
  return {
    preventDefault: vi.fn(),
    prompt: vi.fn(async () => {}),
    userChoice: Promise.resolve({ outcome }),
  };
}

async function load() {
  vi.resetModules();
  return import("../src/install");
}

const KEY = Symbol.for("@baryodev/pwa-kit/install");
const clean = () => {
  vi.unstubAllGlobals();
  delete (globalThis as unknown as Record<symbol, unknown>)[KEY];
};
beforeEach(clean);
afterEach(clean);

describe("installState", () => {
  it("is unavailable on the server and does not throw", async () => {
    const m = await load();
    expect(m.installState()).toBe("unavailable");
    expect(await m.promptInstall()).toBe("unavailable");
    const off = m.onInstallStateChange(() => {});
    expect(() => off()).not.toThrow();
  });

  it("is unavailable on desktop until a prompt arrives", async () => {
    stubBrowser();
    const m = await load();
    expect(m.installState()).toBe("unavailable");
  });

  it("is prompt once beforeinstallprompt fires", async () => {
    const { fire } = stubBrowser({ ua: ANDROID });
    const m = await load();
    fire("beforeinstallprompt", promptEvent("accepted"));
    expect(m.installState()).toBe("prompt");
  });

  it("calls preventDefault on the event", async () => {
    const { fire } = stubBrowser({ ua: ANDROID });
    await load();
    const e = promptEvent("accepted");
    fire("beforeinstallprompt", e);
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("keeps an event that fired before anyone subscribed", async () => {
    const { fire } = stubBrowser({ ua: ANDROID });
    const m = await load();
    fire("beforeinstallprompt", promptEvent("accepted"));
    expect(m.installState()).toBe("prompt");
    expect(await m.promptInstall()).toBe("accepted");
  });

  it("is ios-steps in iOS Safari", async () => {
    stubBrowser({ ua: IPHONE });
    const m = await load();
    expect(m.installState()).toBe("ios-steps");
  });

  it("is ios-steps on an iPad that reports as a Mac", async () => {
    stubBrowser({ ua: DESKTOP, platform: "MacIntel", touch: 5 });
    const m = await load();
    expect(m.installState()).toBe("ios-steps");
  });

  it("is installed when running standalone", async () => {
    stubBrowser({ ua: IPHONE, standalone: true });
    const m = await load();
    expect(m.installState()).toBe("installed");
  });

  it("is installed after appinstalled", async () => {
    const { fire } = stubBrowser({ ua: ANDROID });
    const m = await load();
    fire("beforeinstallprompt", promptEvent("accepted"));
    fire("appinstalled");
    expect(m.installState()).toBe("installed");
  });

  it("is unavailable in the Facebook webview on iOS and Android", async () => {
    stubBrowser({ ua: IPHONE_FB });
    expect((await load()).installState()).toBe("unavailable");
    stubBrowser({ ua: ANDROID_FB });
    expect((await load()).installState()).toBe("unavailable");
  });

  it("does not read Headline/1.0 as the LINE webview", async () => {
    const { fire } = stubBrowser({ ua: ANDROID + " Headline/1.0" });
    const m = await load();
    fire("beforeinstallprompt", promptEvent("accepted"));
    expect(m.installState()).toBe("prompt");
  });

  it("is unavailable in an iOS web view with no Safari token", async () => {
    stubBrowser({ ua: IPHONE_WEBVIEW });
    expect((await load()).installState()).toBe("unavailable");
  });
});

describe("promptInstall", () => {
  it("resolves accepted", async () => {
    const { fire } = stubBrowser({ ua: ANDROID });
    const m = await load();
    const e = promptEvent("accepted");
    fire("beforeinstallprompt", e);
    expect(await m.promptInstall()).toBe("accepted");
    expect(e.prompt).toHaveBeenCalledTimes(1);
  });

  it("resolves dismissed", async () => {
    const { fire } = stubBrowser({ ua: ANDROID });
    const m = await load();
    fire("beforeinstallprompt", promptEvent("dismissed"));
    expect(await m.promptInstall()).toBe("dismissed");
  });

  it("resolves unavailable with no saved event", async () => {
    stubBrowser({ ua: ANDROID });
    const m = await load();
    expect(await m.promptInstall()).toBe("unavailable");
  });

  it("resolves unavailable and keeps the event when prompt() rejects", async () => {
    const { fire } = stubBrowser({ ua: ANDROID });
    const m = await load();
    const e = promptEvent("accepted");
    e.prompt.mockRejectedValueOnce(new Error("needs user activation"));
    fire("beforeinstallprompt", e);
    expect(await m.promptInstall()).toBe("unavailable");
    expect(m.installState()).toBe("prompt");
    expect(await m.promptInstall()).toBe("accepted");
  });

  it("notifies listeners after promptInstall resolves", async () => {
    const { fire } = stubBrowser({ ua: ANDROID });
    const m = await load();
    fire("beforeinstallprompt", promptEvent("dismissed"));
    const cb = vi.fn();
    m.onInstallStateChange(cb);
    await m.promptInstall();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith("unavailable");
  });

  it("uses the event once and clears it", async () => {
    const { fire } = stubBrowser({ ua: ANDROID });
    const m = await load();
    const e = promptEvent("dismissed");
    fire("beforeinstallprompt", e);
    await m.promptInstall();
    expect(m.installState()).toBe("unavailable");
    expect(await m.promptInstall()).toBe("unavailable");
    expect(e.prompt).toHaveBeenCalledTimes(1);
  });
});

describe("onInstallStateChange", () => {
  it("fires with the new state when the prompt arrives", async () => {
    const { fire } = stubBrowser({ ua: ANDROID });
    const m = await load();
    const cb = vi.fn();
    m.onInstallStateChange(cb);
    fire("beforeinstallprompt", promptEvent("accepted"));
    expect(cb).toHaveBeenCalledWith("prompt");
  });

  it("fires installed on appinstalled", async () => {
    const { fire } = stubBrowser({ ua: ANDROID });
    const m = await load();
    const cb = vi.fn();
    m.onInstallStateChange(cb);
    fire("appinstalled");
    expect(cb).toHaveBeenCalledWith("installed");
  });

  it("is shared by two bundled copies of the module", async () => {
    const { fire, listeners } = stubBrowser({ ua: ANDROID });
    const a = await load();
    const b = await load(); // resetModules without clearing the global: a second bundle copy
    expect(listeners["beforeinstallprompt"]).toHaveLength(1);
    const cbB = vi.fn();
    b.onInstallStateChange(cbB);
    const e = promptEvent("accepted");
    fire("beforeinstallprompt", e);
    expect(a.installState()).toBe("prompt");
    expect(b.installState()).toBe("prompt");
    expect(await a.promptInstall()).toBe("accepted");
    expect(b.installState()).not.toBe("prompt");
    expect(await b.promptInstall()).toBe("unavailable");
    expect(e.prompt).toHaveBeenCalledTimes(1);
    expect(cbB).toHaveBeenLastCalledWith("unavailable");
  });

  it("stops firing after unsubscribe", async () => {
    const { fire } = stubBrowser({ ua: ANDROID });
    const m = await load();
    const cb = vi.fn();
    const off = m.onInstallStateChange(cb);
    off();
    fire("beforeinstallprompt", promptEvent("accepted"));
    fire("appinstalled");
    expect(cb).not.toHaveBeenCalled();
  });
});
