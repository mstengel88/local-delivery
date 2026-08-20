import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useFetchers,
  useNavigation,
  useRouteError,
} from "react-router";
import { useEffect, useState } from "react";
import { getCurrentDispatchUser } from "./lib/auth.server";
import "./styles.css";

export async function loader({ request }: { request: Request }) {
  try {
    const currentUser = await getCurrentDispatchUser(request);
    return { currentUser };
  } catch {
    return { currentUser: null };
  }
}

function GlobalLoadingBar() {
  const navigation = useNavigation();
  const fetchers = useFetchers();
  const active =
    navigation.state !== "idle" ||
    fetchers.some((fetcher) => fetcher.state !== "idle");

  return <div className={active ? "globalLoadingBar active" : "globalLoadingBar"} />;
}

function PwaRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return;

    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.warn("Dispatch PWA service worker registration failed.", error);
    });
  }, []);

  return null;
}

function GhosEmbeddedBridge() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (window.parent === window) return;

    let parentOrigin: string | null = null;
    try {
      const referrerOrigin = new URL(document.referrer).origin;
      if (referrerOrigin !== window.location.origin) {
        parentOrigin = referrerOrigin;
      }
    } catch {
      // GHOS identifies itself with the first direct parent message below.
    }

    document.documentElement.classList.add("ghosEmbeddedFrame");
    let processing = false;
    let animationFrame = 0;
    let lastHeight = 0;

    const reportHeight = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        const height = Math.ceil(Math.max(
          document.body.scrollHeight,
          document.documentElement.scrollHeight,
        ));
        if (height <= 0 || Math.abs(height - lastHeight) < 2) return;
        lastHeight = height;
        if (parentOrigin) {
          window.parent.postMessage(
            { type: "ghos:ticketing-content-height", height },
            parentOrigin,
          );
        }
      });
    };

    const handleMessage = async (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      const isGhosMessage = typeof event.data?.type === "string" &&
        event.data.type.startsWith("ghos:ticketing-");
      if (!parentOrigin && isGhosMessage) {
        parentOrigin = event.origin;
      }
      if (!parentOrigin || event.origin !== parentOrigin) return;

      if (event.data?.type === "ghos:ticketing-host-viewport") {
        const height = Number(event.data.height);
        if (Number.isFinite(height) && height >= 320 && height <= 10000) {
          document.documentElement.style.setProperty(
            "--ghos-host-viewport-height",
            `${Math.round(height)}px`,
          );
          reportHeight();
        }
        return;
      }

      if (event.data?.type !== "ghos:ticketing-sso" || processing) return;
      const tokenHash = typeof event.data.tokenHash === "string"
        ? event.data.tokenHash.trim()
        : "";
      if (tokenHash.length < 20 || tokenHash.length > 1024) {
        setError("GHOS supplied an invalid Dispatch V2 session.");
        return;
      }

      processing = true;
      setError(null);
      try {
        const response = await fetch("/ghos-sso", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tokenHash }),
        });
        const result = await response.json().catch(() => null);
        if (!response.ok || result?.ok !== true) {
          throw new Error(result?.message || "Dispatch V2 rejected the GHOS session.");
        }

        window.parent.postMessage(
          { type: "ghos:ticketing-sso-complete" },
          parentOrigin,
        );
        window.location.reload();
      } catch (requestError) {
        processing = false;
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Your Dispatch V2 session could not be started. Refresh GHOS to try again.",
        );
      }
    };

    const resizeObserver = new ResizeObserver(reportHeight);
    resizeObserver.observe(document.documentElement);
    if (document.body) resizeObserver.observe(document.body);
    const mutationObserver = new MutationObserver(reportHeight);
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
    });

    window.addEventListener("message", handleMessage);
    window.addEventListener("load", reportHeight);
    window.addEventListener("resize", reportHeight);
    window.parent.postMessage(
      { type: "ghos:ticketing-sso-ready" },
      parentOrigin ?? "*",
    );
    reportHeight();

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("message", handleMessage);
      window.removeEventListener("load", reportHeight);
      window.removeEventListener("resize", reportHeight);
      document.documentElement.classList.remove("ghosEmbeddedFrame");
      document.documentElement.style.removeProperty("--ghos-host-viewport-height");
    };
  }, []);

  if (!error) return null;
  return (
    <div className="ghosSsoErrorOverlay" role="alert">
      <section className="panel loginPanel">
        <p className="eyebrow">Dispatch V2</p>
        <h1>Single sign-on could not finish</h1>
        <p className="muted">{error}</p>
      </section>
    </div>
  );
}

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#070b18" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="GH Dispatch" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <title>Dispatch v2 Sandbox</title>
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="icon" href="/pwa-icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/email-green-hills-logo.png" />
        <Meta />
        <Links />
      </head>
      <body>
        <GlobalLoadingBar />
        <GhosEmbeddedBridge />
        <Outlet />
        <PwaRegistration />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const isPermissionError = isRouteErrorResponse(error) && error.status === 403;
  const message = isRouteErrorResponse(error)
    ? error.data?.message || `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : "Something went wrong.";

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#070b18" />
        <title>Dispatch v2 Error</title>
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="icon" href="/pwa-icon.svg" type="image/svg+xml" />
        <Meta />
        <Links />
      </head>
      <body>
        <main className="page narrowPage">
          <section className={isPermissionError ? "panel errorPanel noPermissionPanel" : "panel errorPanel"}>
            <p className="eyebrow">{isPermissionError ? "No Permission" : "Dispatch v2"}</p>
            <h1>{isPermissionError ? "No Permission" : "Something blocked this page"}</h1>
            <p className="muted">
              {isPermissionError
                ? "Your account can open dispatch, but it is not allowed to do that action. Ask an admin to add the dispatcher role if you need edit access."
                : "The app stayed alive and caught the error so we can fix the actual problem instead of chasing a blank screen."}
            </p>
            <pre>{message}</pre>
            <a className="errorLink" href="/">Back to board</a>
          </section>
        </main>
        <Scripts />
      </body>
    </html>
  );
}
