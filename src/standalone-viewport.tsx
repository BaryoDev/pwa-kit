import { useEffect } from "react";
import { lockViewportWhenStandalone } from "./register";

/**
 * Drop-in React component: when the app runs as an installed PWA it locks the viewport so
 * pinch-/double-tap-zoom are disabled (native feel), while leaving the browser tab zoomable for
 * accessibility. Renders nothing. Mount it once, near the root.
 */
export function StandaloneViewport(): null {
  useEffect(() => lockViewportWhenStandalone(), []);
  return null;
}
