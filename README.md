<div align="center">
  <img src="https://raw.githubusercontent.com/BaryoDev/pwa-kit/main/logo.svg" alt="pwa-kit" width="88" height="88" />
  <h1>@baryodev/pwa-kit</h1>
  <p><em>Drop-in PWA essentials: an install prompt for Android + iOS, a secure network-first service worker, and helpers.</em></p>
</div>

Turn any web app into an installable, offline-capable one. Framework-agnostic (the React component
uses inline styles, so no CSS setup needed).

## Why

Turning a site into an installable, offline-capable app means three fiddly pieces every time: an
install affordance (Android has a prompt event, iOS doesn't), a service worker with a sane caching
strategy, and cache hygiene so one user's data isn't served to another. This packages all three.

## Install

```sh
npm i @baryodev/pwa-kit
```

## 1. Service worker

Generate the worker source and write it to a file your site serves at the **root** (so its scope
covers the whole app):

```ts
// scripts/gen-sw.mjs
import { writeFileSync } from "node:fs";
import { generateServiceWorker } from "@baryodev/pwa-kit";

writeFileSync(
  "public/sw.js",
  generateServiceWorker({
    cachePrefix: "myapp",          // -> myapp-shell-v1 / myapp-api-v1
    apiPrefix: "/api/",            // requests treated as live data
    skipPaths: ["/api/auth/", "/api/files/"], // never cached
    navigationFallback: "/",       // shown when offline with nothing cached
  }),
);
```

```jsonc
// package.json
"scripts": { "prebuild": "node scripts/gen-sw.mjs" }
```

**Caching strategy**

- App shell / static assets: cache-first (fast, works offline).
- Navigations: network-first, cached page as an offline fallback.
- API `GET`s: **network-first** — online always gets fresh data; the last good response is kept
  only as an offline fallback, so lists still show like a native app with no signal.
- Writes (`POST`/`PUT`/…) always hit the network.

**Security**

- Auth and file paths are never cached.
- Only same-origin `2xx` responses are cached. A redirected navigation is not cached either.
- Call `clearApiCache()` on sign-in and sign-out so cached data from one account is never served
  to another on a shared device (see below).

**Cache cleanup**

On activate the worker deletes only caches named `${cachePrefix}-shell-*` or `${cachePrefix}-api-*`
that are not the current version. Caches from another worker, or from an older `cachePrefix`, are
left alone and stay until you remove them once by hand. Two apps on one origin must use prefixes
where neither starts with the other (`app` and `app-api` clash, since `app-api-shell-v1` looks like an `app` cache; `app` and `admin` do not).

## 2. Register + cache hygiene

```ts
import { registerServiceWorker, clearApiCache } from "@baryodev/pwa-kit";

registerServiceWorker(); // defaults to "/sw.js"

// in your auth code:
function onLogin(session) { clearApiCache(); /* store token... */ }
function onLogout() { clearApiCache(); /* drop token... */ }
```

### Updates

The page asks for a new version after load and whenever it becomes visible again (at most once a
minute, set `updateIntervalMs` to change it). The worker file is registered with
`updateViaCache: "none"`, so it is never served from the HTTP cache. An installed app resumed from
the background picks up a deploy without being closed.

By default the page reloads once when the new worker takes over. A reload loses unsaved work, so
pass `onUpdate` to pick the moment. It receives a `reload` function that reloads once:

```ts
// a game: wait until between runs
let pendingReload: (() => void) | null = null;
registerServiceWorker("/sw.js", { onUpdate: (reload) => (pendingReload = reload) });

function onRunEnd() {
  pendingReload?.(); // does nothing when no update is waiting
}
```

Deferring the reload means the old page runs on the new worker. Chunks it has not loaded yet may 404 after a deploy, so reload soon (between runs, not after an hour). `onUpdate` also works with `reloadOnUpdate: false`.

The browser installs a new worker only when the bytes of `sw.js` change, and the generated worker
changes only when its `version` option does. **Set `version` to something that changes on every
deploy** (git sha or build id), or users keep the old build:

```ts
// scripts/gen-sw.mjs
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { generateServiceWorker } from "@baryodev/pwa-kit";

const version = process.env.BUILD_ID ?? execSync("git rev-parse --short HEAD").toString().trim();
writeFileSync("public/sw.js", generateServiceWorker({ cachePrefix: "myapp", version }));
```

In a Vite project, run this script as the `prebuild` step so the id is set on every build.

`registerServiceWorker` returns a function that removes its listeners.

## 3. Install prompt (React)

```tsx
import { InstallHint } from "@baryodev/pwa-kit";

export default function App() {
  return (
    <>
      {/* ...your app... */}
      <InstallHint appName="MyApp" iconUrl="/icon-192.png" accentColor="#2563eb" />
    </>
  );
}
```

- **Android/Chrome:** shows an **Install app** button wired to `beforeinstallprompt`.
- **iOS Safari:** shows **Share → Add to Home Screen** instructions (iOS has no install event).
- Hidden when already installed; dismissible (remembered in `localStorage`).

## 4. Native feel when installed (React)

Browsers let users pinch- and double-tap-zoom any page — great for the web, but it makes an
installed app feel like a website. Mount `StandaloneViewport` once near your root: when the app is
launched as an installed PWA it locks the viewport so zoom is disabled; in a normal browser tab it
does nothing, so accessibility zoom still works there.

```tsx
import { StandaloneViewport } from "@baryodev/pwa-kit";

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <StandaloneViewport />
      </body>
    </html>
  );
}
```

Not using React? Call the helper directly (e.g. in a client entry). It's a no-op on the server and
in a browser tab, and returns a cleanup function:

```ts
import { lockViewportWhenStandalone } from "@baryodev/pwa-kit";

const cleanup = lockViewportWhenStandalone();
```

Your base viewport should still allow zoom (so the browser tab stays accessible) — Next.js:

```ts
export const viewport = { width: "device-width", initialScale: 1 };
```

## 5. Who installed it (adoption tracking)

There is no cross-browser API that answers "is this PWA installed?" from a normal browser tab.
`navigator.getInstalledRelatedApps()` is Chromium-only and needs `related_applications` in your
manifest; iOS has no install API at all. What every platform *can* tell you is whether the current
launch is the installed app, so record that and keep it.

`reportPwaStatus` fires once on launch, and again if the user installs during the session
(`appinstalled`). You supply `send`, so the report goes through your own authenticated API:

```ts
import { reportPwaStatus } from "@baryodev/pwa-kit/report";

reportPwaStatus((report) => api.post("/api/pwa/report", report));
// report: { deviceId, displayMode, platform, installed }
```

Want a one-off read instead of a subscription? Use `pwaStatus()`, which returns the same shape (or
`null` on the server).

**Import from `@baryodev/pwa-kit/report`, not the package root.** The root re-exports the React
components, so it pulls React in. This subpath carries only the reporting helpers: no dependencies,
no React, and it builds to a single self-contained file. That means a non-React app, or a site with
no bundler at all, can use it directly:

```html
<script type="module">
  import { reportPwaStatus } from "/js/pwa-kit-report.js"; // copied from dist/report.js
  reportPwaStatus((r) => fetch("/api/pwa/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(r),
  }));
</script>
```

Things to design around:

- `installed` means *currently running as installed*. Someone who installed but is in a browser tab
  reports `false` on that launch, which is why the server should store the first `true` it sees.
- `appinstalled` is Chromium-only. On iOS you find out at the next home-screen launch, not at the
  moment of install.
- `deviceId` is a random id in `localStorage`, so it is per browser, not per account. Private mode
  or cleared storage yields a new one and the same person can be counted twice.

## 6. Web manifest (you provide)

pwa-kit doesn't generate your manifest (icons/colors are yours), but it needs one. Minimum:

```json
{
  "name": "MyApp",
  "short_name": "MyApp",
  "start_url": "/",
  "display": "standalone",
  "theme_color": "#2563eb",
  "background_color": "#ffffff",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

Link it and the Apple bits in your `<head>` (Next.js: use the metadata API):

```html
<link rel="manifest" href="/manifest.webmanifest" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-title" content="MyApp" />
```

## 7. Web push (opt-in)

Push is off by default. With it off, the generated worker has no push code.

```ts
generateServiceWorker({ cachePrefix: "myapp", push: true });
// or, to also accept pushes that carry no payload:
generateServiceWorker({ cachePrefix: "myapp", push: { fetchUrl: "/api/push/latest" } });
```

The worker then handles `push` and `notificationclick`. A push payload is JSON:
`{ "title": "...", "body": "...", "url": "/inbox", "tag": "..." }`. Only `title` is required.
Clicking a notification closes it, then focuses an open window in the worker's scope (navigating
it to `url` if given) or opens `url`. A `url` on another origin is ignored and the app root is
used.

Always send a `title`, or set `fetchUrl`. A push with missing or bad data shows no notification,
and Chrome and Edge then show their own generic "this site has been updated in the background"
notification instead. Repeated misses can cost you the subscription.

**Subscribe from the client**

```ts
import { pushSupport, subscribePush, unsubscribePush } from "@baryodev/pwa-kit/push";

const support = pushSupport();
if (!support.ok) {
  // support.reason: "unsupported" | "ios-not-installed" | "denied"
}

// In a click handler, never on load:
const subscription = await subscribePush(VAPID_PUBLIC_KEY);
await fetch("/api/push/subscribe", { method: "POST", body: JSON.stringify(subscription) });
```

`subscribePush` asks for permission, subscribes with `userVisibleOnly: true`, returns the
subscription JSON for your server, and reuses an existing subscription. `unsubscribePush()` removes
it. On iOS 16.4+ push only works for apps installed to the home screen, so `pushSupport()` reports
`ios-not-installed` in a Safari tab.

**When to ask.** Ask after a moment the user cares about (they placed an order, followed a thread),
from a button they pressed. Never on first load. A permission prompt that is denied is hard to
undo, and most browsers stop showing it.

**Sending stays with your app.** pwa-kit has no push server. You store the subscriptions and send
with your own VAPID keys (generate a pair with `npx web-push generate-vapid-keys`). A Cloudflare
Worker sketch using the `@block65/webcrypto-web-push` package:

```ts
import { buildPushPayload } from "@block65/webcrypto-web-push";

export default {
  async fetch(req: Request, env: Env) {
    const { subscription, message } = await req.json(); // subscription from subscribePush()
    const vapid = {
      subject: "mailto:you@example.com",
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
    };
    const payload = await buildPushPayload(
      { data: JSON.stringify(message) }, // { title, body, url, tag }
      subscription,
      vapid,
    );
    const res = await fetch(subscription.endpoint, payload);
    return new Response(null, { status: res.ok ? 204 : 502 });
  },
};
```

Treat a 404 or 410 from the push service as "subscription gone" and delete it.

**Payload-free push.** Encrypting a payload needs a library like the one above. If you would rather
send an empty push, set `push: { fetchUrl }`. The worker fetches that same-origin URL (same-origin
credentials, no cache) and shows the JSON it returns, so your server decides the message when the
device wakes up. The empty push still needs a VAPID `Authorization` header; the payload is the only
part you skip.

## API

| Export | Description |
|--------|-------------|
| `generateServiceWorker(options)` | Returns the service-worker source as a string. |
| `registerServiceWorker(url?, opts?)` | Registers the worker after `load` and checks for updates on load and resume. Options: `reloadOnUpdate`, `onUpdate`, `updateIntervalMs`. Returns a stop function. No-op on the server. |
| `clearApiCache()` | Tells the worker to drop cached API data. Call on sign-in/out. |
| `isStandalone()` | `true` when running as an installed PWA. |
| `lockViewportWhenStandalone()` | Disables zoom when installed (no-op in a browser tab). Returns a cleanup fn. |
| `<InstallHint />` | Dismissible install prompt (Android button / iOS instructions). |
| `pushSupport()`, `subscribePush(key)`, `unsubscribePush()` | Opt-in web push helpers. Also at `@baryodev/pwa-kit/push`. |
| `<StandaloneViewport />` | Mounts `lockViewportWhenStandalone` for you. Renders nothing. |

## License

[MIT](LICENSE)
