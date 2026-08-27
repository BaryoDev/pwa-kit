# Changelog

All notable changes to `@baryodev/pwa-kit`.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html). While the major version is `0`, minor
bumps may carry breaking changes.

## How a release is cut

1. Bump `version` in `package.json` and add the section below.
2. Merge to `main`. CI runs `tsc --noEmit` and `npm run build`.
3. Publish a **GitHub Release** tagged `vX.Y.Z`, using that section as the body.

Publishing the Release is what ships it: `.github/workflows/publish.yml` fires on
`release: published`, builds, publishes to npm via trusted publishing (OIDC, provenance, no
`NPM_TOKEN`), mirrors to GitHub Packages, then announces to the BaryoDev org discussions using the
Release body as the notes. A `workflow_dispatch` run publishes without any of that paperwork, which
is how 0.4.0 shipped with no tag, no Release and no announcement.

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
