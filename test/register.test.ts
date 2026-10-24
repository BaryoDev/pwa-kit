import { afterEach, describe, expect, it, vi } from "vitest";
import { registerServiceWorker } from "../src/register";

function stubBrowser(hasController: boolean) {
  const sw = {
    controller: hasController ? {} : null,
    listeners: {} as Record<string, () => void>,
    addEventListener(t: string, fn: () => void) {
      this.listeners[t] = fn;
    },
    register: vi.fn(async () => ({})),
  };
  const reload = vi.fn();
  vi.stubGlobal("navigator", { serviceWorker: sw });
  vi.stubGlobal("document", { readyState: "complete" });
  vi.stubGlobal("window", { location: { reload }, addEventListener: vi.fn() });
  return { sw, reload };
}

afterEach(() => vi.unstubAllGlobals());

describe("registerServiceWorker", () => {
  it("is a no-op without service worker support", () => {
    vi.stubGlobal("navigator", {});
    expect(() => registerServiceWorker()).not.toThrow();
  });

  it("registers the given url", () => {
    const { sw } = stubBrowser(false);
    registerServiceWorker("/custom-sw.js");
    expect(sw.register).toHaveBeenCalledWith("/custom-sw.js");
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
});
