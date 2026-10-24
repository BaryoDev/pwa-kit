import { afterEach, describe, expect, it, vi } from "vitest";
import { pushSupport, subscribePush, unsubscribePush } from "../src/push";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)";
const ANDROID = "Mozilla/5.0 (Linux; Android 14)";

interface Env {
  ua?: string;
  standalone?: boolean;
  permission?: NotificationPermission;
  requested?: NotificationPermission;
  existing?: unknown;
  noPushManager?: boolean;
  noServiceWorker?: boolean;
}

function stub(env: Env = {}) {
  const sub = {
    toJSON: () => ({ endpoint: "https://push.test/e", keys: { p256dh: "a", auth: "b" } }),
    unsubscribe: vi.fn(async () => true),
  };
  const pushManager = {
    getSubscription: vi.fn(async () => (env.existing === undefined ? null : env.existing)),
    subscribe: vi.fn(async (_o: unknown) => sub),
  };
  const nav: Record<string, unknown> = { userAgent: env.ua ?? ANDROID };
  if (!env.noServiceWorker) nav.serviceWorker = { ready: Promise.resolve({ pushManager }) };
  if (env.standalone) nav.standalone = true;
  const win: Record<string, unknown> = { matchMedia: () => ({ matches: false }) };
  if (!env.noPushManager) win.PushManager = class {};
  vi.stubGlobal("navigator", nav);
  vi.stubGlobal("window", win);
  const requestPermission = vi.fn(async () => env.requested ?? "granted");
  vi.stubGlobal("Notification", { permission: env.permission ?? "default", requestPermission });
  return { pushManager, sub, requestPermission };
}

afterEach(() => vi.unstubAllGlobals());

describe("pushSupport", () => {
  it("is ok where push exists", () => {
    stub();
    expect(pushSupport()).toEqual({ ok: true });
  });

  it("is unsupported without a service worker, PushManager or Notification", () => {
    stub({ noServiceWorker: true });
    expect(pushSupport()).toEqual({ ok: false, reason: "unsupported" });
    stub({ noPushManager: true });
    expect(pushSupport()).toEqual({ ok: false, reason: "unsupported" });
    stub();
    vi.stubGlobal("Notification", undefined);
    expect(pushSupport()).toEqual({ ok: false, reason: "unsupported" });
  });

  it("is unsupported with no window at all", () => {
    vi.stubGlobal("window", undefined);
    expect(pushSupport()).toEqual({ ok: false, reason: "unsupported" });
  });

  it("says ios-not-installed for an iPhone tab, even without PushManager", () => {
    stub({ ua: IPHONE, noPushManager: true });
    expect(pushSupport()).toEqual({ ok: false, reason: "ios-not-installed" });
  });

  it("is ok on iOS once installed", () => {
    stub({ ua: IPHONE, standalone: true });
    expect(pushSupport()).toEqual({ ok: true });
  });

  it("says denied when permission is denied", () => {
    stub({ permission: "denied" });
    expect(pushSupport()).toEqual({ ok: false, reason: "denied" });
  });
});

describe("subscribePush", () => {
  // 65 bytes (a P-256 public key is this long) as base64url without padding.
  const bytes = Uint8Array.from({ length: 65 }, (_, i) => (i * 7 + 251) % 256);
  const key = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  it("asks permission, subscribes user-visible with the decoded key, returns the JSON", async () => {
    const { pushManager, requestPermission } = stub();
    const json = await subscribePush(key);
    expect(requestPermission).toHaveBeenCalledOnce();
    const opts = pushManager.subscribe.mock.calls[0][0] as {
      userVisibleOnly: boolean;
      applicationServerKey: Uint8Array;
    };
    expect(opts.userVisibleOnly).toBe(true);
    expect(Array.from(opts.applicationServerKey)).toEqual(Array.from(bytes));
    expect(json).toEqual({ endpoint: "https://push.test/e", keys: { p256dh: "a", auth: "b" } });
  });

  it("reuses an existing subscription", async () => {
    const existing = { toJSON: () => ({ endpoint: "https://push.test/old" }) };
    const { pushManager } = stub({ existing });
    expect(await subscribePush(key)).toEqual({ endpoint: "https://push.test/old" });
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it("throws when permission is not granted, without subscribing", async () => {
    const { pushManager } = stub({ requested: "denied" });
    await expect(subscribePush(key)).rejects.toThrow(/denied/);
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it("throws, without prompting, when push is unavailable", async () => {
    const { requestPermission } = stub({ ua: IPHONE });
    await expect(subscribePush(key)).rejects.toThrow(/ios-not-installed/);
    expect(requestPermission).not.toHaveBeenCalled();
  });
});

describe("unsubscribePush", () => {
  it("unsubscribes the current subscription", async () => {
    const existing = { unsubscribe: vi.fn(async () => true) };
    stub({ existing });
    expect(await unsubscribePush()).toBe(true);
    expect(existing.unsubscribe).toHaveBeenCalledOnce();
  });

  it("returns false when there is no subscription", async () => {
    stub();
    expect(await unsubscribePush()).toBe(false);
  });

  it("returns false without service worker support", async () => {
    stub({ noServiceWorker: true });
    expect(await unsubscribePush()).toBe(false);
  });
});
