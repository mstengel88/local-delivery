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
import { useEffect } from "react";
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
