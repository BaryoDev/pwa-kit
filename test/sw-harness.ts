import { generateServiceWorker, type ServiceWorkerOptions } from "../src/sw-template";

export const ORIGIN = "https://app.test";

interface ResponseInit2 {
  status?: number;
  type?: string;
  redirected?: boolean;
  headers?: Record<string, string>;
}

/** Minimal Response: the worker only reads ok, type, redirected, status, headers and clone(). */
export class FakeResponse {
  status: number;
  type: string;
  redirected: boolean;
  headers: Record<string, string>;
  constructor(public body: string = "", init: ResponseInit2 = {}) {
    this.status = init.status ?? 200;
    this.type = init.type ?? "default";
    this.redirected = init.redirected ?? false;
    this.headers = init.headers ?? {};
  }
  get ok() {
    return this.status >= 200 && this.status < 300;
  }
  bodyUsed = false;
  clone() {
    if (this.bodyUsed) throw new TypeError("Response body is already used");
    return new FakeResponse(this.body, this);
  }
  /** Reading the body twice fails, as it does on a real Response. */
  text() {
    if (this.bodyUsed) throw new TypeError("Response body is already used");
    this.bodyUsed = true;
    return this.body;
  }
  json() {
    return JSON.parse(this.text());
  }
}

/** A same-origin response as the browser reports it for a normal fetch. */
export const basic = (body = "", init: ResponseInit2 = {}) =>
  new FakeResponse(body, { type: "basic", ...init });

export interface FakeRequest {
  url: string;
  method: string;
  mode: string;
}

export const request = (path: string, init: Partial<FakeRequest> = {}): FakeRequest => ({
  url: path.startsWith("http") ? path : ORIGIN + path,
  method: "GET",
  mode: "cors",
  ...init,
});

// Like the real Cache API, a string is resolved against the worker location.
const keyOf = (req: FakeRequest | string) => (typeof req === "string" ? new URL(req, ORIGIN).href : req.url);

class FakeCache {
  entries = new Map<string, FakeResponse>();
  async put(req: FakeRequest | string, resp: FakeResponse) {
    // Like the real Cache API, put consumes the body it is given.
    if (resp.bodyUsed) throw new TypeError("Response body is already used");
    resp.bodyUsed = true;
    this.entries.set(keyOf(req), new FakeResponse(resp.body, resp));
  }
  async match(req: FakeRequest | string) {
    const hit = this.entries.get(keyOf(req));
    return hit && new FakeResponse(hit.body, hit);
  }
}

class FakeCacheStorage {
  stores = new Map<string, FakeCache>();
  async keys() {
    return [...this.stores.keys()];
  }
  async open(name: string) {
    if (!this.stores.has(name)) this.stores.set(name, new FakeCache());
    return this.stores.get(name)!;
  }
  async delete(name: string) {
    return this.stores.delete(name);
  }
  async match(req: FakeRequest | string) {
    for (const c of this.stores.values()) {
      const hit = await c.match(req);
      if (hit) return hit;
    }
    return undefined;
  }
}

export interface FakeWindow {
  url: string;
  focused: boolean;
  navigatedTo?: string;
  focus(): Promise<FakeWindow>;
  navigate(url: string): Promise<FakeWindow>;
}

/** A fake client window. Set `focusFails` or `navigateFails` to make that call reject. */
export const fakeWindow = (
  url: string,
  fails: { focusFails?: boolean; navigateFails?: boolean } = {},
): FakeWindow => ({
  url,
  focused: false,
  async focus() {
    if (fails.focusFails) throw new Error("focus refused");
    this.focused = true;
    return this;
  },
  async navigate(to: string) {
    if (fails.navigateFails) throw new Error("navigate refused: client is not controlled");
    this.navigatedTo = to;
    return this;
  },
});

type Handler = (event: any) => void;
type Network = (req: FakeRequest) => Promise<FakeResponse>;

/**
 * Evaluates the generated worker source against a fake service worker global and lets a test
 * dispatch install, activate, message and fetch events at it.
 */
export function loadWorker(opts: ServiceWorkerOptions) {
  const handlers: Record<string, Handler> = {};
  const caches = new FakeCacheStorage();
  const fetched: string[] = [];
  const fetchInits: unknown[] = [];
  const shown: { title: string; options: any }[] = [];
  const opened: string[] = [];
  const state = {
    /** Open windows the fake clients API reports. */
    windows: [] as FakeWindow[],
    showFails: false,
    /** registration.scope as the worker sees it. */
    scope: ORIGIN + "/",
    network: (async () => basic("ok")) as Network,
    skipWaiting: 0,
    claimed: 0,
  };

  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: Handler) => {
      handlers[type] = fn;
    },
    skipWaiting: () => {
      state.skipWaiting++;
    },
    registration: {
      get scope() {
        return state.scope;
      },
      showNotification: async (title: string, options: any) => {
        if (state.showFails) throw new Error("showNotification failed");
        shown.push({ title, options });
      },
    },
    clients: {
      claim: async () => {
        state.claimed++;
      },
      matchAll: async () => state.windows,
      openWindow: async (url: string) => {
        opened.push(url);
        return undefined;
      },
    },
  };
  // The worker passes a Request to fetch, or a URL string and an init (the push fetch).
  const fakeFetch = (input: FakeRequest | string, init?: unknown) => {
    const req = typeof input === "string" ? request(input) : input;
    fetched.push(req.url);
    if (init) fetchInits.push(init);
    return state.network(req);
  };

  new Function("self", "caches", "fetch", "Response", "URL", generateServiceWorker(opts))(
    self,
    caches,
    fakeFetch,
    FakeResponse,
    URL,
  );

  let lastWaits = 0;

  /** Dispatch an event that uses waitUntil, and wait for what it was given. */
  const lifecycle = async (type: string, extra: object = {}) => {
    const waits: Promise<unknown>[] = [];
    handlers[type]({ ...extra, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  };

  return {
    caches,
    fetched,
    /** The init objects passed to fetch by the worker (only calls that gave one). */
    fetchInits,
    /** Notifications the worker showed. */
    shown,
    /** URLs the worker opened in a new window. */
    opened,
    /** How many waitUntil promises the last fetch event registered. */
    get lastWaits() {
      return lastWaits;
    },
    state,
    handlers,
    /** Set what the network returns, or make it fail with offline(). */
    setNetwork(fn: Network) {
      state.network = fn;
    },
    offline() {
      state.network = async () => {
        throw new TypeError("Failed to fetch");
      };
    },
    install: () => {
      handlers.install({});
    },
    activate: () => lifecycle("activate"),
    message: (data: unknown) => lifecycle("message", { data }),
    /** Dispatch a push event. Pass a payload object, a raw string (e.g. bad JSON), or nothing. */
    push: (payload?: unknown) =>
      lifecycle("push", {
        data:
          payload === undefined
            ? null
            : { json: () => (typeof payload === "string" ? JSON.parse(payload) : payload) },
      }),
    /** Dispatch a notificationclick for a notification carrying this data. Returns whether it closed. */
    async click(data: unknown) {
      let closed = false;
      await lifecycle("notificationclick", {
        notification: { data, close: () => (closed = true) },
      });
      return closed;
    },
    /**
     * Dispatch a fetch event. Returns the response the worker produced, or "passthrough" when it
     * did not call respondWith (the browser would handle the request itself).
     */
    async fetch(req: FakeRequest): Promise<FakeResponse | undefined | "passthrough"> {
      let answer: Promise<FakeResponse | undefined> | undefined;
      const waits: Promise<unknown>[] = [];
      handlers.fetch({
        request: req,
        respondWith: (p: Promise<FakeResponse | undefined>) => (answer = p),
        waitUntil: (p: Promise<unknown>) => waits.push(p),
      });
      if (!answer) return "passthrough";
      const resp = await answer;
      // The worker may only finish its cache puts through waitUntil, so wait on exactly that.
      await Promise.all(waits);
      lastWaits = waits.length;
      return resp;
    },
  };
}
