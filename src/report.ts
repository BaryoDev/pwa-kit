// Subpath entry: @baryodev/pwa-kit/report
//
// The main entry re-exports the React components, so importing it pulls React in. This entry
// carries only the reporting helpers, which have no dependencies, so a non-React app (or a plain
// <script type="module"> with no bundler) can use them without resolving a bare "react" specifier.

export { reportPwaStatus, pwaStatus } from "./pwa-report";
export type { PwaReport, DisplayMode, ReportPwaOptions } from "./pwa-report";
