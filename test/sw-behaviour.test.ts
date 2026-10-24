import { describe, expect, it } from "vitest";
import { basic, FakeResponse, loadWorker, request } from "./sw-harness";

const opts = { cachePrefix: "app", version: "v1" };

describe("generated worker: install", () => {
  it("skips waiting", () => {
    const w = loadWorker(opts);
    w.install();
    expect(w.state.skipWaiting).toBe(1);
  });
});

describe("generated worker: requests it must not intercept", () => {
  it("leaves the default skip paths alone", async () => {
    const w = loadWorker(opts);
    expect(await w.fetch(request("/api/auth/login"))).toBe("passthrough");
    expect(await w.fetch(request("/api/files/a.png"))).toBe("passthrough");
    expect(w.fetched).toEqual([]);
  });

  it("honours custom skip paths", async () => {
    const w = loadWorker({ ...opts, skipPaths: ["/private/"] });
    expect(await w.fetch(request("/private/x"))).toBe("passthrough");
    expect(await w.fetch(request("/api/auth/login"))).not.toBe("passthrough");
  });

  it("leaves cross-origin requests alone", async () => {
    const w = loadWorker(opts);
    expect(await w.fetch(request("https://cdn.other.test/lib.js"))).toBe("passthrough");
  });

  it("leaves non-GET requests alone", async () => {
    const w = loadWorker(opts);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(await w.fetch(request("/api/items", { method }))).toBe("passthrough");
    }
  });
});

describe("generated worker: API GETs", () => {
  it("is network-first and keeps the response for offline", async () => {
    const w = loadWorker(opts);
    w.setNetwork(async () => basic("fresh"));
    const resp = (await w.fetch(request("/api/items"))) as FakeResponse;
    expect(resp.body).toBe("fresh");
    expect(await w.caches.keys()).toEqual(["app-api-v1"]);

    w.setNetwork(async () => basic("newer"));
    expect(((await w.fetch(request("/api/items"))) as FakeResponse).body).toBe("newer");
  });

  it("serves the cached copy when offline", async () => {
    const w = loadWorker(opts);
    await w.fetch(request("/api/items"));
    w.offline();
    const resp = (await w.fetch(request("/api/items"))) as FakeResponse;
    expect(resp.body).toBe("ok");
  });

  it("answers 503 JSON when offline with nothing cached", async () => {
    const w = loadWorker(opts);
    w.offline();
    const resp = (await w.fetch(request("/api/items"))) as FakeResponse;
    expect(resp.status).toBe(503);
    expect(resp.headers["Content-Type"]).toBe("application/json");
    expect(resp.json()).toEqual({ offline: true });
  });

  it("does not cache an error response", async () => {
    const w = loadWorker(opts);
    w.setNetwork(async () => basic("boom", { status: 500 }));
    const resp = (await w.fetch(request("/api/items"))) as FakeResponse;
    expect(resp.status).toBe(500);
    expect(await w.caches.keys()).toEqual([]);
  });

  it("uses a custom apiPrefix", async () => {
    const w = loadWorker({ ...opts, apiPrefix: "/v2/" });
    await w.fetch(request("/v2/items"));
    expect(await w.caches.keys()).toEqual(["app-api-v1"]);
  });
});

describe("generated worker: assets", () => {
  it("is cache-first: fetches once, then serves from cache", async () => {
    const w = loadWorker(opts);
    w.setNetwork(async () => basic("js-v1"));
    expect(((await w.fetch(request("/app.js"))) as FakeResponse).body).toBe("js-v1");
    w.setNetwork(async () => basic("js-v2"));
    expect(((await w.fetch(request("/app.js"))) as FakeResponse).body).toBe("js-v1");
    expect(w.fetched).toEqual(["https://app.test/app.js"]);
    expect(await w.caches.keys()).toEqual(["app-shell-v1"]);
  });

  it("does not cache a non-ok asset", async () => {
    const w = loadWorker(opts);
    w.setNetwork(async () => basic("", { status: 404 }));
    await w.fetch(request("/missing.js"));
    expect(await w.caches.keys()).toEqual([]);
  });
});

describe("generated worker: navigations", () => {
  const nav = (path = "/page") => request(path, { mode: "navigate" });

  it("is network-first and caches an ok page", async () => {
    const w = loadWorker(opts);
    w.setNetwork(async () => basic("page"));
    expect(((await w.fetch(nav())) as FakeResponse).body).toBe("page");
    w.offline();
    expect(((await w.fetch(nav())) as FakeResponse).body).toBe("page");
  });

  it("falls back to the navigation fallback page offline", async () => {
    const w = loadWorker({ ...opts, navigationFallback: "/offline.html" });
    w.setNetwork(async () => basic("offline page"));
    await w.fetch(request("/offline.html"));
    w.offline();
    expect(((await w.fetch(nav("/never-seen"))) as FakeResponse).body).toBe("offline page");
  });
});

describe("generated worker: navigations only cache good responses", () => {
  const nav = (path = "/page") => request(path, { mode: "navigate" });

  it("returns a 500 to the page but does not cache it, and offline falls back", async () => {
    const w = loadWorker(opts);
    w.setNetwork(async () => basic("home"));
    await w.fetch(request("/"));
    w.setNetwork(async () => basic("server error", { status: 500 }));
    const resp = (await w.fetch(nav())) as FakeResponse;
    expect(resp.status).toBe(500);
    expect(resp.body).toBe("server error");

    w.offline();
    expect(((await w.fetch(nav())) as FakeResponse).body).toBe("home");
  });

  it("does not cache a 404", async () => {
    const w = loadWorker(opts);
    w.setNetwork(async () => basic("nope", { status: 404 }));
    await w.fetch(nav());
    expect(await w.caches.keys()).toEqual([]);
  });

  it("does not cache a non-basic response", async () => {
    const w = loadWorker(opts);
    w.setNetwork(async () => new FakeResponse("portal", { type: "opaque" }));
    await w.fetch(nav());
    expect(await w.caches.keys()).toEqual([]);
  });

  it("does not cache a redirected response under the original request", async () => {
    const w = loadWorker(opts);
    w.setNetwork(async () => basic("landing", { redirected: true }));
    expect(((await w.fetch(nav("/old"))) as FakeResponse).body).toBe("landing");
    expect(await w.caches.keys()).toEqual([]);
  });
});

describe("generated worker: messages", () => {
  it("clear-api-cache drops the API cache and keeps the shell", async () => {
    const w = loadWorker(opts);
    await w.fetch(request("/api/items"));
    await w.fetch(request("/app.js"));
    expect((await w.caches.keys()).sort()).toEqual(["app-api-v1", "app-shell-v1"]);
    await w.message("clear-api-cache");
    expect(await w.caches.keys()).toEqual(["app-shell-v1"]);
  });

  it("ignores other messages", async () => {
    const w = loadWorker(opts);
    await w.fetch(request("/api/items"));
    await w.message("something-else");
    expect(await w.caches.keys()).toEqual(["app-api-v1"]);
  });
});

describe("generated worker: activate", () => {
  it("claims clients and keeps the current caches", async () => {
    const w = loadWorker(opts);
    await w.caches.open("app-shell-v1");
    await w.caches.open("app-api-v1");
    await w.activate();
    expect((await w.caches.keys()).sort()).toEqual(["app-api-v1", "app-shell-v1"]);
    expect(w.state.claimed).toBe(1);
  });
});

describe("generated worker: activate purge is scoped to the app prefix", () => {
  it("keeps caches it does not own and deletes its own old ones", async () => {
    const w = loadWorker({ cachePrefix: "app", version: "v1" });
    for (const name of ["unrelated", "my-fonts", "application-x", "app-admin-shell-v0", "app-admin-api-v0", "app-shell-v0", "app-api-v0", "app-shell-v1"]) {
      await w.caches.open(name);
    }
    await w.activate();
    expect((await w.caches.keys()).sort()).toEqual(["app-admin-api-v0", "app-admin-shell-v0", "application-x", "app-shell-v1", "my-fonts", "unrelated"].sort());
  });
});

describe("generated worker: fallbacks read only this worker's caches", () => {
  const foreign = async (w: ReturnType<typeof loadWorker>, name: string, path: string) =>
    (await w.caches.open(name)).put(request(path), basic("foreign"));

  it("does not serve an API entry from another app's cache", async () => {
    const w = loadWorker(opts);
    await foreign(w, "other-api-v1", "/api/items");
    w.offline();
    const resp = (await w.fetch(request("/api/items"))) as FakeResponse;
    expect(resp.status).toBe(503);
  });

  it("does not serve an API entry from an old version's cache", async () => {
    const w = loadWorker(opts);
    await foreign(w, "app-api-v0", "/api/items");
    w.offline();
    expect(((await w.fetch(request("/api/items"))) as FakeResponse).status).toBe(503);
  });

  it("does not serve a navigation or the fallback page from a foreign cache", async () => {
    const w = loadWorker(opts);
    await foreign(w, "other-shell-v1", "/page");
    await foreign(w, "other-shell-v1", "/");
    w.offline();
    const resp = await w.fetch(request("/page", { mode: "navigate" }));
    expect(resp).toBeUndefined();
  });

  it("does not serve an asset from a foreign cache", async () => {
    const w = loadWorker(opts);
    await foreign(w, "other-shell-v1", "/app.js");
    w.setNetwork(async () => basic("mine"));
    expect(((await w.fetch(request("/app.js"))) as FakeResponse).body).toBe("mine");
  });

  it("still serves the fallback page from its own shell cache", async () => {
    const w = loadWorker(opts);
    w.setNetwork(async () => basic("home"));
    await w.fetch(request("/"));
    w.offline();
    expect(((await w.fetch(request("/x", { mode: "navigate" }))) as FakeResponse).body).toBe("home");
  });
});
