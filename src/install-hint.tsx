import { useEffect, useState, type CSSProperties } from "react";
import { isStandalone } from "./register";

export interface InstallHintProps {
  /** App name shown in the prompt and used for the default dismiss key. */
  appName: string;
  /** Optional icon URL shown beside the text. */
  iconUrl?: string;
  /** One-line description (non-iOS). */
  description?: string;
  /** Accent color (CSS) for the install button. Default #2563eb. */
  accentColor?: string;
  /** localStorage key used to remember dismissal. Defaults to a per-app key. */
  dismissKey?: string;
}

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const ShareIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: "-2px" }} aria-hidden>
    <path d="M12 3v13M8 7l4-4 4 4M4 13v6a2 2 0 002 2h12a2 2 0 002-2v-6" />
  </svg>
);
const PlusIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: "-2px" }} aria-hidden>
    <rect x="3" y="3" width="18" height="18" rx="4" /><path d="M12 8v8M8 12h8" />
  </svg>
);

/**
 * A dismissible "install this app" prompt. On Android/Chrome it shows a real Install button
 * (backed by `beforeinstallprompt`). On iOS, where browsers offer no such prompt, it shows the
 * Share -> Add to Home Screen instructions. Renders nothing when already installed or dismissed.
 */
export function InstallHint({
  appName,
  iconUrl,
  description = "Add it to your home screen for a full-screen, app-like experience.",
  accentColor = "#2563eb",
  dismissKey,
}: InstallHintProps) {
  const key = dismissKey ?? `pwa-install-dismissed:${appName}`;
  const [show, setShow] = useState(false);
  const [ios, setIos] = useState(false);
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    try {
      if (localStorage.getItem(key)) return;
    } catch {
      /* ignore */
    }
    if (isStandalone()) return;

    const ua = navigator.userAgent;
    const isIos =
      /iphone|ipad|ipod/i.test(ua) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (isIos) {
      setIos(true);
      setShow(true);
      return;
    }

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as InstallPromptEvent);
      setShow(true);
    };
    const onInstalled = () => setShow(false);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [key]);

  function dismiss() {
    setShow(false);
    try {
      localStorage.setItem(key, "1");
    } catch {
      /* ignore */
    }
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    dismiss();
  }

  if (!show) return null;

  const wrap: CSSProperties = {
    position: "fixed",
    left: 12,
    right: 12,
    bottom: 12,
    zIndex: 2147483000,
    maxWidth: 440,
    margin: "0 auto",
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    background: "#fff",
    color: "#1f2937",
    border: "1px solid #e5e7eb",
    boxShadow: "0 10px 30px -10px rgba(0,0,0,0.25)",
    font: "14px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  };

  return (
    <div style={wrap} role="dialog" aria-label={`Install ${appName}`}>
      {iconUrl && <img src={iconUrl} alt="" width={40} height={40} style={{ borderRadius: 10, flexShrink: 0 }} />}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 600 }}>Install {appName}</div>
        {ios ? (
          <div style={{ marginTop: 2, fontSize: 12.5, color: "#6b7280" }}>
            Tap <ShareIcon /> Share, then{" "}
            <span style={{ color: "#1f2937", fontWeight: 500 }}>
              Add to Home Screen <PlusIcon />
            </span>
            .
          </div>
        ) : (
          <div style={{ marginTop: 2, fontSize: 12.5, color: "#6b7280" }}>{description}</div>
        )}
        {!ios && (
          <button
            onClick={install}
            style={{
              marginTop: 10,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              border: 0,
              borderRadius: 8,
              padding: "7px 14px",
              fontSize: 14,
              fontWeight: 600,
              color: "#fff",
              background: accentColor,
              cursor: "pointer",
            }}
          >
            Install app
          </button>
        )}
      </div>
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        style={{ flexShrink: 0, border: 0, background: "transparent", color: "#9ca3af", cursor: "pointer", padding: 4, lineHeight: 0 }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
