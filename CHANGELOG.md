# Changelog

All notable changes to `@baryodev/pwa-kit`.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html). While the major version is `0`, minor
bumps may carry breaking changes.

## How a release is cut

1. Bump `version` in `package.json` and add the section below.
2. Merge to `main`. CI runs `npm audit`, `tsc --noEmit`, the tests and `npm run build`.
3. Publish a **GitHub Release** tagged `vX.Y.Z`, using that section as the body.

Publishing the Release is what ships it: `.github/workflows/publish.yml` fires on
`release: published`, builds, publishes to npm via trusted publishing (OIDC, provenance, no
`NPM_TOKEN`), mirrors to GitHub Packages, then announces to the BaryoDev org discussions using the
Release body as the notes. A `workflow_dispatch` run publishes without any of that paperwork, which
is how 0.4.0 shipped with no tag, no Release and no announcement.

## [0.5.1] - 2026-10-24

### Fixed

- The generated worker deletes only its own old caches on activate (`${cachePrefix}-shell-*` and
  `${cachePrefix}-api-*`). It used to delete every other cache on the origin (#2).
- Navigations are cached only when the response is ok, same-origin and not redirected, so an error
  page is never saved as the offline copy (#3).
- Offline fallbacks read only this worker's own caches, never another app's or an old version's.
- Cache writes are kept alive with `event.waitUntil`, so the browser cannot stop the worker before
  a write lands.

### Changed

- Tests: vitest suite (51 tests) for the worker, `pwaStatus`, `reportPwaStatus` and
  `registerServiceWorker`. CI runs tsc and tests on Node 22 and 24; publishing runs them first (#6).
- CI fails on high severity npm advisories. Dependabot checks npm and GitHub Actions weekly, and
  the actions are pinned to commit shas.
- esbuild (dev only, through tsup) is overridden to 0.28.2 for GHSA-g7r4-m6w7-qqqr. The package
  still has no runtime dependencies.

### Upgrading

Caches left by another worker or an older prefix are no longer deleted by activate. Remove them
once by hand if you had any. See "Cache cleanup" in the README.

## [0.5.0] - 2026-08-27

### Added

- `@baryodev/pwa-kit/report` subpath export, carrying `reportPwaStatus`, `pwaStatus` and their
  types. No dependencies and no React.
- README section documenting the reporting helpers, including the no-bundler
  `<script type="module">` usage and the caveats worth designing around.
- This changelog, with 0.1.0 through 0.4.0 backfilled.

### Changed

- Builds are no longer code-split (`splitting: false`), so each entry is a single self-contained
  file. `dist/report.js` is ~2 KB and imports nothing, which is what lets it be copied into a site
  and served directly.

### Why

The package root re-exports the React components, so `import { reportPwaStatus } from
"@baryodev/pwa-kit"` pulls React in. Anything non-React could not use the reporting helpers at all,
and a plain `<script type="module">` failed outright on the bare `"react"` specifier. The helpers
never needed React; they were only trapped behind the barrel.

Nothing is removed or renamed. The root export is unchanged, so existing imports keep working.

## [0.4.0] - 2026-08-27

Published to npm, but never tagged or released on GitHub, and never announced.

### Added

- `reportPwaStatus(send, opts?)` and `pwaStatus(opts?)`: report whether a launch is the installed
  app or a browser tab, so a backend can track adoption and, for signed-in users, who installed it.
  Covers iOS via `navigator.standalone`, listens for `appinstalled`, and persists a per-browser
  `deviceId` in `localStorage` so repeat launches dedupe server-side.

## [0.3.0] - 2026-07-19

### Added

- Cache versioning with reload-on-update.
- Mirror publishing to GitHub Packages alongside npm.

### Changed

- Publishing moved to npm trusted publishing (OIDC), dropping `NPM_TOKEN`.
- Release announcements moved to the org's reusable workflow.

## [0.2.0]

### Added

- `StandaloneViewport` and `lockViewportWhenStandalone`: disable zoom when running as an installed
  PWA, while leaving accessibility zoom alone in a normal browser tab.

## [0.1.0]

Initial release.

### Added

- `InstallHint`: install prompt for Android (`beforeinstallprompt`) and iOS (Add to Home Screen
  instructions).
- `generateServiceWorker`: network-first service worker with cache hygiene.
- `registerServiceWorker`, `clearApiCache`, `isStandalone`.

Only tagged versions are linked. 0.2.0 and 0.4.0 were published to npm without a tag, so there is
nothing on GitHub to point at; they are on npm under those versions.

[0.5.0]: https://github.com/BaryoDev/pwa-kit/releases/tag/v0.5.0
[0.3.0]: https://github.com/BaryoDev/pwa-kit/releases/tag/v0.3.0
[0.1.0]: https://github.com/BaryoDev/pwa-kit/releases/tag/v0.1.0
