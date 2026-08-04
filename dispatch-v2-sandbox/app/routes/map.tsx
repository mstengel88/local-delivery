import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { data, Form, Link, useLoaderData, useRevalidator } from "react-router";
import {
  getMapsConfigStatus,
  loadDispatchOperationalSettings,
  loadDriverLocations,
  loadMonitorState,
  type DispatchDriverLocation,
  type DispatchMonitorState,
  type DispatchOrder,
} from "../lib/dispatch.server";
import { requireDispatchUser } from "../lib/auth.server";
import { PermissionNav } from "../components/PermissionNav";
import { useDispatchVersionRevalidator } from "../components/useDispatchVersionRevalidator";

declare global {
  interface Window {
    google?: any;
    __dispatchV2GoogleMapsReady?: () => void;
    gm_authFailure?: () => void;
  }
}

let googleMapsPromise: Promise<void> | null = null;

function todayDateKey() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value || "";
  const month = parts.find((part) => part.type === "month")?.value || "";
  const day = parts.find((part) => part.type === "day")?.value || "";
  return `${year}-${month}-${day}`;
}

function defaultIncludeUndatedForDate(dateKey: string | null, requestedValue: string | null, url: URL) {
  const explicitIncludeUndated = url.searchParams.get("includeUndated");
  if (explicitIncludeUndated !== null) return explicitIncludeUndated === "1";
  if (!dateKey || requestedValue === "all") return true;
  return dateKey === todayDateKey();
}

function orderNumber(order: DispatchOrder) {
  return order.orderNumber ? `#${order.orderNumber}` : order.id;
}

function stopAddress(order: DispatchOrder) {
  return [order.address, order.city].filter(Boolean).join(", ").trim();
}

function formatMinutes(minutes: number) {
  if (!minutes) return "0 min";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${remainder} min`;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function formatLocationAge(value: string) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "unknown";
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m ago` : `${hours}h ago`;
}

const MAP_VIEW_STORAGE_KEY = "dispatch-v2-map-view";

function getStoredMapView() {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(MAP_VIEW_STORAGE_KEY) || "null");
    if (
      parsed &&
      Number.isFinite(parsed.lat) &&
      Number.isFinite(parsed.lng) &&
      Number.isFinite(parsed.zoom)
    ) {
      return parsed as { lat: number; lng: number; zoom: number };
    }
  } catch {
    // Ignore bad local storage and fall back to the default map view.
  }
  return null;
}

function saveMapView(map: any) {
  if (typeof window === "undefined") return;
  const center = map?.getCenter?.();
  const zoom = map?.getZoom?.();
  if (!center || !Number.isFinite(zoom)) return;
  window.localStorage.setItem(
    MAP_VIEW_STORAGE_KEY,
    JSON.stringify({
      lat: center.lat(),
      lng: center.lng(),
      zoom,
    }),
  );
}

function loadGoogleMaps(apiKey: string) {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.google?.maps) return Promise.resolve();
  if (googleMapsPromise) return googleMapsPromise;

  googleMapsPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-dispatch-v2-map="true"]');
    if (existing) {
      if (window.google?.maps) {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Google Maps failed to load.")), { once: true });
      return;
    }

    const timeout = window.setTimeout(() => {
      reject(new Error("Google Maps JavaScript did not finish loading. Check the browser key, referrer restrictions, and that Maps JavaScript API is enabled."));
    }, 12000);

    window.gm_authFailure = () => {
      window.clearTimeout(timeout);
      googleMapsPromise = null;
      reject(
        new Error(
          "Google Maps rejected this browser key. Check that Maps JavaScript API is enabled, billing is active, and the key referrer includes this exact app URL.",
        ),
      );
    };

    window.__dispatchV2GoogleMapsReady = () => {
      window.clearTimeout(timeout);
      resolve();
    };

    const script = document.createElement("script");
    script.dataset.dispatchV2Map = "true";
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async&callback=__dispatchV2GoogleMapsReady`;
    script.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error("Google Maps JavaScript failed to load. Verify GOOGLE_MAPS_BROWSER_API_KEY and browser referrer restrictions."));
    };
    document.head.appendChild(script);
  });

  return googleMapsPromise;
}

export async function loader({ request }: { request: Request }) {
  await requireDispatchUser(request, "map");
  const started = performance.now();
  const url = new URL(request.url);
  const requestedDate = url.searchParams.get("date");
  const dateKey = requestedDate === "all" ? null : requestedDate || todayDateKey();
  const includeUndated = defaultIncludeUndatedForDate(dateKey, requestedDate, url);
  const [state, locations, operations] = await Promise.all([
    loadMonitorState({ dateKey, includeUndated }),
    loadDriverLocations(),
    loadDispatchOperationalSettings().catch(() => null),
  ]);

  return data({
    ...state,
    locations,
    mapsConfig: getMapsConfigStatus(),
    operations: {
      refreshSeconds: operations?.mapRefreshSeconds || 60,
    },
    dateKey,
    includeUndated,
    loadedAt: new Date().toISOString(),
    loadMs: Math.round(performance.now() - started),
  });
}

export default function DispatchMap() {
  const loaderData = useLoaderData<typeof loader>() as DispatchMonitorState & {
    locations: DispatchDriverLocation[];
    mapsConfig: {
      browserConfigured: boolean;
      browserApiKey: string;
      shopAddress: string;
    };
    operations: {
      refreshSeconds: number;
    };
    dateKey: string | null;
    includeUndated: boolean;
    loadedAt: string;
    loadMs: number;
  };
  const revalidator = useRevalidator();
  useDispatchVersionRevalidator(revalidator, { intervalMs: 7000 });
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const renderersRef = useRef<any[]>([]);
  const markersRef = useRef<any[]>([]);
  const initialFitDoneRef = useRef(false);
  const lastRouteKeyRef = useRef("");
  const [visibleRoutes, setVisibleRoutes] = useState(() => new Set(loaderData.routes.map((route) => route.id)));
  const [mapStatus, setMapStatus] = useState("");
  const isRefreshing = revalidator.state !== "idle";

  const activeRoutes = useMemo(
    () =>
      loaderData.routes
        .filter((route) => visibleRoutes.has(route.id))
        .map((route) => ({
          ...route,
          drawableStops: route.activeOrders.filter((order) => stopAddress(order)),
        }))
        .filter((route) => route.drawableStops.length),
    [loaderData.routes, visibleRoutes],
  );
  const activeRouteKey = useMemo(
    () => activeRoutes.map((route) => route.id).sort().join("|"),
    [activeRoutes],
  );
  const visibleRouteKey = useMemo(
    () => Array.from(visibleRoutes).sort().join("|"),
    [visibleRoutes],
  );

  useEffect(() => {
    setVisibleRoutes((previous) => {
      const next = new Set(previous);
      for (const route of loaderData.routes) {
        if (!next.has(route.id)) next.add(route.id);
      }
      return next;
    });
  }, [loaderData.routes]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") revalidator.revalidate();
    }, Math.max(60, Number(loaderData.operations?.refreshSeconds || 60)) * 1000);
    return () => window.clearInterval(interval);
  }, [loaderData.operations?.refreshSeconds, revalidator]);

  useEffect(() => {
    let cancelled = false;

    async function drawMap() {
      if (!mapRef.current) return;
      if (!loaderData.mapsConfig.browserConfigured) {
        setMapStatus("Add GOOGLE_MAPS_BROWSER_API_KEY with Maps JavaScript API enabled to load the route map.");
        return;
      }

      try {
        setMapStatus("Loading map...");
        await loadGoogleMaps(loaderData.mapsConfig.browserApiKey);
        if (cancelled || !mapRef.current || !window.google?.maps) return;

        const google = window.google;
        if (!mapInstanceRef.current) {
          const storedView = getStoredMapView();
          mapInstanceRef.current = new google.maps.Map(mapRef.current, {
            center: storedView ? { lat: storedView.lat, lng: storedView.lng } : { lat: 43.1789, lng: -88.1173 },
            zoom: storedView?.zoom || 10,
            mapTypeControl: true,
            streetViewControl: false,
            fullscreenControl: true,
          });
          mapInstanceRef.current.addListener("idle", () => saveMapView(mapInstanceRef.current));
        }

        for (const renderer of renderersRef.current) renderer.setMap(null);
        for (const marker of markersRef.current) marker.setMap(null);
        renderersRef.current = [];
        markersRef.current = [];

        const bounds = new google.maps.LatLngBounds();
        const directionsService = new google.maps.DirectionsService();
        let drawn = 0;

        const shopMarker = new google.maps.Marker({
          map: mapInstanceRef.current,
          position: undefined,
          title: "Green Hills Supply",
          label: "GH",
        });
        markersRef.current.push(shopMarker);

        for (const route of activeRoutes) {
          const stops = route.drawableStops.slice(0, 10);
          const waypoints = stops.flatMap((order) => [
            { location: stopAddress(order), stopover: true },
            { location: loaderData.mapsConfig.shopAddress, stopover: true },
          ]);
          const request = {
            origin: loaderData.mapsConfig.shopAddress,
            destination: loaderData.mapsConfig.shopAddress,
            waypoints,
            optimizeWaypoints: false,
            travelMode: google.maps.TravelMode.DRIVING,
          };

          const result = await directionsService.route(request);
          if (cancelled) return;

          const renderer = new google.maps.DirectionsRenderer({
            suppressMarkers: true,
            preserveViewport: true,
            polylineOptions: {
              strokeColor: route.color || "#38bdf8",
              strokeOpacity: 0.88,
              strokeWeight: 5,
            },
          });
          renderer.setMap(mapInstanceRef.current);
          renderer.setDirections(result);
          renderersRef.current.push(renderer);
          drawn += 1;

          const routeBounds = result.routes?.[0]?.bounds;
          if (routeBounds) bounds.union(routeBounds);

          stops.forEach((order, index) => {
            const leg = result.routes?.[0]?.legs?.[index * 2];
            const position = leg?.end_location;
            if (!position) return;
            bounds.extend(position);
            markersRef.current.push(
              new google.maps.Marker({
                map: mapInstanceRef.current,
                position,
                label: String(index + 1),
                title: `${route.code} ${orderNumber(order)} ${order.customer}`,
              }),
            );
          });
        }

        const routeIdsOnPage = new Set(loaderData.routes.map((route) => route.id));
        const visibleTrackingLocations = loaderData.locations.filter(
          (entry) => !routeIdsOnPage.has(entry.routeId) || visibleRoutes.has(entry.routeId),
        );
        for (const location of visibleTrackingLocations) {
          const route = loaderData.routes.find((entry) => entry.id === location.routeId);
          const position = { lat: location.latitude, lng: location.longitude };
          const isFresh = Date.now() - new Date(location.updatedAt || location.capturedAt).getTime() < 5 * 60 * 1000;
          bounds.extend(position);
          markersRef.current.push(
            new google.maps.Marker({
              map: mapInstanceRef.current,
              position,
              title: `${location.routeCode || route?.code || "Route"} · ${location.driverName || "Driver"} · ${formatLocationAge(location.updatedAt || location.capturedAt)}`,
              label: {
                text: location.truck || location.routeCode || "DRV",
                color: "#ffffff",
                fontSize: "11px",
                fontWeight: "800",
              },
              icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 13,
                fillColor: route?.color || "#22c55e",
                fillOpacity: isFresh ? 1 : 0.55,
                strokeColor: "#020617",
                strokeWeight: 3,
              },
              zIndex: 999,
            }),
          );
        }

        const shouldFitBounds =
          !initialFitDoneRef.current || lastRouteKeyRef.current !== activeRouteKey;
        if (!bounds.isEmpty() && shouldFitBounds) {
          mapInstanceRef.current.fitBounds(bounds, 36);
          initialFitDoneRef.current = true;
          lastRouteKeyRef.current = activeRouteKey;
        }
        const trackingCount = visibleTrackingLocations.length;
        setMapStatus(
          [
            drawn ? `Showing ${drawn} routes.` : "No active stops with addresses for this date.",
            trackingCount ? `${trackingCount} live driver marker${trackingCount === 1 ? "" : "s"}.` : "",
          ]
            .filter(Boolean)
            .join(" "),
        );
      } catch (error) {
        setMapStatus(error instanceof Error ? error.message : "Unable to draw route map.");
      }
    }

    void drawMap();
    return () => {
      cancelled = true;
    };
  }, [
    activeRouteKey,
    activeRoutes,
    loaderData.mapsConfig.browserApiKey,
    loaderData.mapsConfig.browserConfigured,
    loaderData.mapsConfig.shopAddress,
    loaderData.locations,
    loaderData.routes,
    visibleRouteKey,
    visibleRoutes,
  ]);

  function toggleRoute(routeId: string) {
    setVisibleRoutes((previous) => {
      const next = new Set(previous);
      if (next.has(routeId)) next.delete(routeId);
      else next.add(routeId);
      return next;
    });
  }

  return (
    <main className="page mapPage">
      <header className="topbar">
        <div>
          <p className="eyebrow">Map</p>
          <h1>Route Map</h1>
          <p className="muted">
            Showing {loaderData.dateKey || "all active days"}
            {loaderData.includeUndated && loaderData.dateKey ? " plus undated orders" : ""}.
          </p>
        </div>
        <div className="topbarActions">
          <PermissionNav />
          <div className="statusBox">
            <strong>{loaderData.loadMs}ms</strong>
            <span>{isRefreshing ? "refreshing" : "server load"}</span>
            <small>{new Date(loaderData.loadedAt).toLocaleTimeString()}</small>
          </div>
        </div>
      </header>

      <section className="toolbar monitorToolbar">
        <Form method="get" className="dayFilter">
          <label>
            Dispatch date
            <input name="date" type="date" defaultValue={loaderData.dateKey || todayDateKey()} />
          </label>
          <label className="checkLabel">
            <input
              name="includeUndated"
              type="checkbox"
              value="1"
              defaultChecked={loaderData.includeUndated}
            />
            Include undated
          </label>
          <input type="hidden" name="includeUndated" value="0" />
          <button type="submit" disabled={isRefreshing}>
            {isRefreshing ? "Loading..." : "Open Day"}
          </button>
        </Form>
        <Link className="toolbarLink" to="?date=all">
          All active
        </Link>
      </section>

      <section className="mapShell">
        <aside className="panel mapLegend">
          <div className="panelHeader">
            <div>
              <p className="eyebrow">Routes</p>
              <h2>Toggle Lines</h2>
            </div>
            <span className="count">{loaderData.routes.length}</span>
          </div>
          <div className="routeToggleList">
            {loaderData.routes.map((route) => (
              <button
                key={route.id}
                type="button"
                className={visibleRoutes.has(route.id) ? "routeToggle active" : "routeToggle"}
                style={{ "--route-color": route.color } as CSSProperties}
                onClick={() => toggleRoute(route.id)}
              >
                <span />
                <strong>{route.code}</strong>
                <small>
                  {route.truck || "No truck"} · {route.activeOrders.length} stops ·{" "}
                  {formatMinutes(route.totalTravelMinutes)}
                </small>
              </button>
            ))}
          </div>
          <div className="trackingLegend">
            <p className="eyebrow">Live Tracking</p>
            {loaderData.locations.length ? (
              loaderData.locations.map((location) => (
                <div key={location.routeId} className="trackingRow">
                  <span
                    style={
                      {
                        "--route-color":
                          loaderData.routes.find((route) => route.id === location.routeId)?.color || "#22c55e",
                      } as CSSProperties
                    }
                  />
                  <strong>{location.routeCode || "Route"}</strong>
                  <small>
                    {location.driverName || "Driver"} · {location.truck || "No truck"} ·{" "}
                    {formatLocationAge(location.updatedAt || location.capturedAt)}
                  </small>
                </div>
              ))
            ) : (
              <small className="muted">No driver locations yet. Open the driver page on a tablet and allow location.</small>
            )}
          </div>
          <p className="muted mapStatus">{mapStatus}</p>
        </aside>
        <div ref={mapRef} className="panel mapCanvas" />
      </section>
    </main>
  );
}
