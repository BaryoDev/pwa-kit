import { describe, expect, it } from "vitest";
import { generateServiceWorker } from "../src/sw-template";
import { basic, fakeWindow, loadWorker, ORIGIN } from "./sw-harness";

const base = { cachePrefix: "app", version: "v1" };
const on = { ...base, push: true };

describe("push option off", () => {
  it("leaves the worker identical and free of push code", () => {
    const plain = generateServiceWorker(base);
    expect(generateServiceWorker({ ...base, push: false })).toBe(plain);
    expect(generateServiceWorker({ ...base, push: undefined })).toBe(plain);
    expect(plain).not.toMatch(/push|notification/i);
  });

  it("registers no push or click handlers", () => {
    const w = loadWorker(base);
    expect(w.handlers.push).toBeUndefined();
    expect(w.handlers.notificationclick).toBeUndefined();
  });
});

describe("push handler", () => {
  it("shows a notification from the payload", async () => {
    const w = loadWorker(on);
    await w.push({ title: "Hi", body: "There", url: "/inbox", tag: "t1" });
    expect(w.shown).toEqual([
      { title: "Hi", options: { body: "There", tag: "t1", data: { url: "/inbox" } } },
    ]);
  });

  it("shows a title-only payload", async () => {
    const w = loadWorker(on);
    await w.push({ title: "Hi" });
    expect(w.shown).toEqual([{ title: "Hi", options: { data: { url: null } } }]);
  });

  it("shows nothing for a payload that is not valid JSON", async () => {
    const w = loadWorker(on);
    await w.push("{not json");
    expect(w.shown).toEqual([]);
  });

  it("shows nothing when the payload has no title or is not an object", async () => {
    const w = loadWorker(on);
    await w.push({ body: "no title" });
    await w.push({ title: 5 });
    await w.push("null");
    await w.push("42");
    expect(w.shown).toEqual([]);
  });

  it("shows nothing and does not throw with no payload and no fetchUrl", async () => {
    const w = loadWorker(on);
    await w.push();
    expect(w.fetched).toEqual([]);
    expect(w.shown).toEqual([]);
  });

  it("does not reject when showNotification fails", async () => {
    const w = loadWorker(on);
    w.state.showFails = true;
    await expect(w.push({ title: "Hi" })).resolves.toBeUndefined();
  });
});

describe("payload-free push", () => {
  const fetching = { ...base, push: { fetchUrl: "/api/push/latest" } };

  it("fetches the message from the same-origin URL without cache or cross-site credentials", async () => {
    const w = loadWorker(fetching);
    w.setNetwork(async () => basic(JSON.stringify({ title: "Fresh", body: "From server" })));
    await w.push();
    expect(w.fetched).toEqual([ORIGIN + "/api/push/latest"]);
    expect(w.fetchInits).toEqual([{ credentials: "same-origin", cache: "no-store" }]);
    expect(w.shown).toEqual([
      { title: "Fresh", options: { body: "From server", data: { url: null } } },
    ]);
  });

  it("shows nothing when the fetch fails, errors or returns junk", async () => {
    const w = loadWorker(fetching);
    w.offline();
    await w.push();
    w.setNetwork(async () => basic("", { status: 500 }));
    await w.push();
    w.setNetwork(async () => basic("<html>"));
    await w.push();
    expect(w.shown).toEqual([]);
  });

  it("does not fetch a cross-origin fetchUrl", async () => {
    const w = loadWorker({ ...base, push: { fetchUrl: "https://evil.test/m" } });
    await w.push();
    expect(w.fetched).toEqual([]);
    expect(w.shown).toEqual([]);
  });

  it("does not fetch when a payload is present", async () => {
    const w = loadWorker(fetching);
    await w.push({ title: "Inline" });
    expect(w.fetched).toEqual([]);
    expect(w.shown).toHaveLength(1);
  });

  it("passes the option through JSON.stringify", () => {
    const hostile = '/x";alert(1);//';
    const src = generateServiceWorker({ ...base, push: { fetchUrl: hostile } });
    expect(() => new Function("self", "fetch", "URL", src)).not.toThrow();
    expect(src).toContain(JSON.stringify(hostile));
  });
});

describe("notificationclick handler", () => {
  it("closes the notification and focuses an open window in scope", async () => {
    const w = loadWorker(on);
    const win = fakeWindow(ORIGIN + "/page");
    w.state.windows = [fakeWindow("https://other.test/"), win];
    expect(await w.click({ url: null })).toBe(true);
    expect(win.focused).toBe(true);
    expect(win.navigatedTo).toBeUndefined();
    expect(w.opened).toEqual([]);
  });

  it("navigates the focused window to the url", async () => {
    const w = loadWorker(on);
    const win = fakeWindow(ORIGIN + "/page");
    w.state.windows = [win];
    await w.click({ url: "/inbox?x=1" });
    expect(win.focused).toBe(true);
    expect(win.navigatedTo).toBe(ORIGIN + "/inbox?x=1");
    expect(w.opened).toEqual([]);
  });

  it("opens a new window at the url when none is open", async () => {
    const w = loadWorker(on);
    expect(await w.click({ url: "/inbox" })).toBe(true);
    expect(w.opened).toEqual([ORIGIN + "/inbox"]);
  });

  it("opens the scope root when there is no url and no window", async () => {
    const w = loadWorker(on);
    await w.click(undefined);
    expect(w.opened).toEqual([ORIGIN + "/"]);
  });

  it("falls back to the scope root for a cross-origin url", async () => {
    const w = loadWorker(on);
    await w.click({ url: "https://evil.test/phish" });
    expect(w.opened).toEqual([ORIGIN + "/"]);

    const win = fakeWindow(ORIGIN + "/page");
    w.state.windows = [win];
    await w.click({ url: "https://evil.test/phish" });
    expect(win.navigatedTo).toBe(ORIGIN + "/");
  });

  it("treats a protocol-relative or script url as cross-origin or unusable", async () => {
    const w = loadWorker(on);
    await w.click({ url: "//evil.test/x" });
    await w.click({ url: "javascript:alert(1)" });
    expect(w.opened).toEqual([ORIGIN + "/", ORIGIN + "/"]);
  });
});
