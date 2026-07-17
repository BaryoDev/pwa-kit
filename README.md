# @baryodev/pwa-kit

Drop-in PWA essentials for any web app: an install prompt that works on **both Android and iOS**,
a **secure, network-first service worker**, and small helpers. Framework-agnostic (the React
component uses inline styles, so no CSS setup needed).

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
- Only same-origin `200` responses are cached.
- Call `clearApiCache()` on sign-in and sign-out so cached data from one account is never served
  to another on a shared device (see below).

## 2. Register + cache hygiene

```ts
import { registerServiceWorker, clearApiCache } from "@baryodev/pwa-kit";

registerServiceWorker(); // defaults to "/sw.js"

// in your auth code:
function onLogin(session) { clearApiCache(); /* store token... */ }
function onLogout() { clearApiCache(); /* drop token... */ }
```

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

## 4. Web manifest (you provide)

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

## API

| Export | Description |
|--------|-------------|
| `generateServiceWorker(options)` | Returns the service-worker source as a string. |
| `registerServiceWorker(url?)` | Registers the worker after `load`. No-op on the server. |
| `clearApiCache()` | Tells the worker to drop cached API data. Call on sign-in/out. |
| `isStandalone()` | `true` when running as an installed PWA. |
| `<InstallHint />` | Dismissible install prompt (Android button / iOS instructions). |

## License

[MIT](LICENSE)
