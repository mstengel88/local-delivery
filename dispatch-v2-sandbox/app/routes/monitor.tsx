import { useEffect, type CSSProperties } from "react";
import { data, Form, Link, useLoaderData, useRevalidator } from "react-router";
import {
  loadDispatchOperationalSettings,
  loadMonitorState,
  type DispatchMonitorRoute,
  type DispatchMonitorState,
  type DispatchOrder,
} from "../lib/dispatch.server";
import { requireDispatchUser } from "../lib/auth.server";
import { PermissionNav } from "../components/PermissionNav";
import { useDispatchVersionRevalidator } from "../components/useDispatchVersionRevalidator";

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

function formatMinutes(minutes: number) {
  if (!minutes) return "0 min";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${remainder} min`;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function stopLabel(order: DispatchOrder | null) {
  if (!order) return "No active stop";
  return `${orderNumber(order)} · ${order.customer || "No customer"}`;
}

function routeStatus(route: DispatchMonitorRoute) {
  if (!route.totalStops) return "Empty";
  if (!route.activeOrders.length) return "Complete";
  if (route.enrouteStops) return "Enroute";
  return "Waiting";
}

export async function loader({ request }: { request: Request }) {
  await requireDispatchUser(request, "monitor");
  const started = performance.now();
  const url = new URL(request.url);
  const requestedDate = url.searchParams.get("date");
  const dateKey = requestedDate === "all" ? null : requestedDate || todayDateKey();
  const includeUndated = defaultIncludeUndatedForDate(dateKey, requestedDate, url);
  const [state, operations] = await Promise.all([
    loadMonitorState({ dateKey, includeUndated }),
    loadDispatchOperationalSettings().catch(() => null),
  ]);
  return data({
    ...state,
    operations: {
      refreshSeconds: operations?.mapRefreshSeconds || 30,
    },
    dateKey,
    includeUndated,
    loadedAt: new Date().toISOString(),
    loadMs: Math.round(performance.now() - started),
  });
}

export default function Monitor() {
  const loaderData = useLoaderData<typeof loader>() as DispatchMonitorState & {
    dateKey: string | null;
    includeUndated: boolean;
    operations: {
      refreshSeconds: number;
    };
    loadedAt: string;
    loadMs: number;
  };
  const revalidator = useRevalidator();
  useDispatchVersionRevalidator(revalidator, { intervalMs: 7000 });
  const isRefreshing = revalidator.state !== "idle";

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") revalidator.revalidate();
    }, Math.max(60, Number(loaderData.operations?.refreshSeconds || 60)) * 1000);
    return () => window.clearInterval(interval);
  }, [loaderData.operations?.refreshSeconds, revalidator]);

  return (
    <main className="page monitorPage">
      <header className="topbar">
        <div>
          <p className="eyebrow">Monitor</p>
          <h1>Route Status</h1>
          <p className="muted">
            Watching {loaderData.dateKey || "all active days"}
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

      <section className="monitorStats">
        <article className="panel statTile">
          <span>Active Routes</span>
          <strong>{loaderData.totals.activeRoutes}</strong>
        </article>
        <article className="panel statTile">
          <span>Active Stops</span>
          <strong>{loaderData.totals.activeStops}</strong>
        </article>
        <article className="panel statTile">
          <span>Enroute</span>
          <strong>{loaderData.totals.enrouteStops}</strong>
        </article>
        <article className="panel statTile">
          <span>Unscheduled</span>
          <strong>{loaderData.totals.unscheduledStops}</strong>
        </article>
        <article className="panel statTile">
          <span>Route Time</span>
          <strong>{formatMinutes(loaderData.totals.totalTravelMinutes)}</strong>
        </article>
      </section>

      <section className="monitorGrid">
        {loaderData.routes.map((route) => (
          <article key={route.id} className="panel monitorRoute" style={{ "--route-color": route.color } as CSSProperties}>
            <div className="panelHeader">
              <div>
                <p className="eyebrow">{routeStatus(route)}</p>
                <h2>{route.code} · {route.truck || "No truck"}</h2>
                <p className="muted">{route.driver || "No driver"} · {route.shift || "No shift"}</p>
              </div>
              <span className="count">{route.progressPercent}%</span>
            </div>

            <div className="progressTrack" aria-label={`${route.progressPercent}% complete`}>
              <div style={{ width: `${route.progressPercent}%` }} />
            </div>

            <div className="monitorRouteBody">
              <div>
                <span>Stops</span>
                <strong>
                  {route.deliveredStops} delivered / {route.totalStops || 0} total
                </strong>
              </div>
              <div>
                <span>Current</span>
                <strong>{stopLabel(route.currentStop)}</strong>
                {route.currentStop ? (
                  <small>
                    {route.currentStop.address}, {route.currentStop.city}
                  </small>
                ) : null}
              </div>
              <div>
                <span>Next Load</span>
                <strong>{stopLabel(route.nextLoad)}</strong>
                {route.nextLoad ? (
                  <small>
                    {route.nextLoad.quantity} {route.nextLoad.unit} · {route.nextLoad.material}
                  </small>
                ) : null}
              </div>
              <div>
                <span>Timing</span>
                <strong>{formatMinutes(route.totalTravelMinutes)} route time</strong>
                <small>
                  {route.enrouteStops} enroute · {route.waitingStops} waiting
                </small>
              </div>
            </div>
          </article>
        ))}
      </section>

      {!loaderData.routes.length ? (
        <section className="panel bigEmpty">
          <h2>No active routes</h2>
          <p className="muted">Create or reactivate routes from the Routes page.</p>
        </section>
      ) : null}
    </main>
  );
}
