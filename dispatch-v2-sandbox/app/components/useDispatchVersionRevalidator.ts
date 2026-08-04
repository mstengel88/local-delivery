import { useEffect, useRef } from "react";

type Revalidator = {
  revalidate: () => void;
};

type DispatchVersionPayload = {
  ok?: boolean;
  version?: string;
};

export function useDispatchVersionRevalidator(
  revalidator: Revalidator,
  options: { enabled?: boolean; intervalMs?: number } = {},
) {
  const latestVersionRef = useRef<string>("");
  const revalidatorRef = useRef(revalidator);
  revalidatorRef.current = revalidator;

  useEffect(() => {
    if (options.enabled === false) return;

    let cancelled = false;
    let inFlight = false;
    const intervalMs = Math.max(5000, options.intervalMs || 7000);

    async function checkVersion() {
      if (cancelled || inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      try {
        const response = await fetch(`/api/dispatch-version?ts=${Date.now()}`, {
          credentials: "same-origin",
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as DispatchVersionPayload | null;
        const nextVersion = payload?.ok && payload.version ? payload.version : "";
        if (!nextVersion) return;
        if (!latestVersionRef.current) {
          latestVersionRef.current = nextVersion;
          return;
        }
        if (latestVersionRef.current !== nextVersion) {
          latestVersionRef.current = nextVersion;
          revalidatorRef.current.revalidate();
        }
      } finally {
        inFlight = false;
      }
    }

    void checkVersion();
    const interval = window.setInterval(checkVersion, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [options.enabled, options.intervalMs]);
}
