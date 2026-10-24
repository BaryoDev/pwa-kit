import { afterEach, describe, expect, it, vi } from "vitest";
import { registerServiceWorker } from "../src/register";

function stubBrowser(hasController: boolean) {
  const update = vi.fn(async () => {});
  const sw = {
    controller: hasController ? {} : null,
    listeners: {} as Record<string, () => void>,
    addEventListener(t: string, fn: () => void) {
      this.listeners[t] = fn;
    },
    removeEventListener(t: string, fn: () => void) {
      if (this.listeners[t] === fn) delete this.listeners[t];
    },
    register: vi.fn(async () => ({ update })),
  };
  const reload = vi.fn();
  const doc = {
    readyState: "complete",
    visibilityState: "visible",
    listeners: {} as Record<string, () => void>,
    addEventListener(t: string, fn: () => void) {
      this.listeners[t] = fn;
    },
    removeEventListener(t: string, fn: () => void) {
      if (this.listeners[t] === fn) delete this.listeners[t];
    },
  };
  vi.stubGlobal("navigator", { serviceWorker: sw });
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", {
    location: { reload },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  return { sw, doc, reload, update };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("registerServiceWorker", () => {
  it("is a no-op without service worker support", () => {
    vi.stubGlobal("navigator", {});
    expect(() => registerServiceWorker()).not.toThrow();
  });

  it("registers the given url", () => {
    const { sw } = stubBrowser(false);
    registerServiceWorker("/custom-sw.js");
    expect(sw.register).toHaveBeenCalledWith("/custom-sw.js", expect.anything());
  });

  it("registers with updateViaCache none", () => {
    const { sw } = stubBrowser(false);
    registerServiceWorker();
    expect(sw.register).toHaveBeenCalledWith("/sw.js", { updateViaCache: "none" });
  });

  it("reloads once when a new worker takes over an existing controller", () => {
    const { sw, reload } = stubBrowser(true);
    registerServiceWorker();
    sw.listeners.controllerchange();
    sw.listeners.controllerchange();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload on the first install", () => {
    const { sw, reload } = stubBrowser(false);
    registerServiceWorker();
    sw.listeners.controllerchange();
    expect(reload).not.toHaveBeenCalled();
  });

  it("does not listen when reloadOnUpdate is false", () => {
    const { sw } = stubBrowser(true);
    registerServiceWorker("/sw.js", { reloadOnUpdate: false });
    expect(sw.listeners.controllerchange).toBeUndefined();
  });

  it("checks for an update after load", async () => {
    const { update } = stubBrowser(true);
    registerServiceWorker();
    await flush();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("checks for an update when the page becomes visible", async () => {
    const { doc, update } = stubBrowser(true);
    registerServiceWorker("/sw.js", { updateIntervalMs: 0 });
    await flush();
    update.mockClear();
    doc.visibilityState = "visible";
    doc.listeners.visibilitychange();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("does not check when the page is hidden", async () => {
    const { doc, update } = stubBrowser(true);
    registerServiceWorker("/sw.js", { updateIntervalMs: 0 });
    await flush();
    update.mockClear();
    doc.visibilityState = "hidden";
    doc.listeners.visibilitychange();
    expect(update).not.toHaveBeenCalled();
  });

  it("checks at most once per interval", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000_000);
    const { doc, update } = stubBrowser(true);
    registerServiceWorker("/sw.js", { updateIntervalMs: 60_000 });
    await flush();
    expect(update).toHaveBeenCalledTimes(1); // the load check
    vi.setSystemTime(1_030_000);
    doc.listeners.visibilitychange();
    expect(update).toHaveBeenCalledTimes(1); // inside the window
    vi.setSystemTime(1_060_000);
    doc.listeners.visibilitychange();
    expect(update).toHaveBeenCalledTimes(2);
    doc.listeners.visibilitychange();
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("calls onUpdate instead of reloading", () => {
    const { sw, reload } = stubBrowser(true);
    const onUpdate = vi.fn();
    registerServiceWorker("/sw.js", { onUpdate });
    sw.listeners.controllerchange();
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });

  it("does not call onUpdate on the first install", () => {
    const { sw } = stubBrowser(false);
    const onUpdate = vi.fn();
    registerServiceWorker("/sw.js", { onUpdate });
    sw.listeners.controllerchange();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("reloads only once however often the reload function is called", () => {
    const { sw, reload } = stubBrowser(true);
    let doReload!: () => void;
    registerServiceWorker("/sw.js", { onUpdate: (r) => (doReload = r) });
    sw.listeners.controllerchange();
    doReload();
    doReload();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("counts a later update after the first install's controllerchange", () => {
    const { sw } = stubBrowser(false);
    const onUpdate = vi.fn();
    registerServiceWorker("/sw.js", { onUpdate });
    sw.listeners.controllerchange(); // the claim on first install
    sw.listeners.controllerchange(); // a deploy picked up later
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it("calls onUpdate even when reloadOnUpdate is false", () => {
    const { sw, reload } = stubBrowser(true);
    const onUpdate = vi.fn();
    registerServiceWorker("/sw.js", { reloadOnUpdate: false, onUpdate });
    sw.listeners.controllerchange();
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });

  it("does not update after stop when register was still pending", async () => {
    const { sw, update } = stubBrowser(true);
    let resolve!: (r: { update: typeof update }) => void;
    sw.register.mockImplementationOnce(() => new Promise((res) => (resolve = res)) as never);
    const stop = registerServiceWorker();
    stop();
    resolve({ update });
    await flush();
    expect(update).not.toHaveBeenCalled();
  });

  it("allows a check when the clock moves backwards", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(2_000_000);
    const { doc, update } = stubBrowser(true);
    registerServiceWorker("/sw.js", { updateIntervalMs: 60_000 });
    await flush();
    expect(update).toHaveBeenCalledTimes(1);
    vi.setSystemTime(1_000_000);
    doc.listeners.visibilitychange();
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("retries on the next resume when update rejects", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000_000);
    const { doc, update } = stubBrowser(true);
    update.mockRejectedValueOnce(new Error("offline"));
    registerServiceWorker("/sw.js", { updateIntervalMs: 60_000 });
    await flush();
    expect(update).toHaveBeenCalledTimes(1);
    vi.setSystemTime(1_001_000); // inside the window, but the last check failed
    doc.listeners.visibilitychange();
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("removes its listeners when the returned function is called", () => {
    const { sw, doc } = stubBrowser(true);
    const stop = registerServiceWorker();
    stop();
    expect(sw.listeners.controllerchange).toBeUndefined();
    expect(doc.listeners.visibilitychange).toBeUndefined();
  });
});
