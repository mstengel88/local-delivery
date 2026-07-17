import { useMemo, useState } from "react";
import {
  data,
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import {
  deactivateDispatchRoute,
  loadDispatchEmployeeOptions,
  loadRouteTimingSummaries,
  loadRoutesForMaintenance,
  reactivateDispatchRoute,
  updateDispatchRoute,
  type DispatchEmployeeOption,
  type DispatchRoute,
  type DispatchRouteTimingSummary,
} from "../lib/dispatch.server";
import { requireDispatchEditor, requireDispatchUser } from "../lib/auth.server";
import { PermissionNav } from "../components/PermissionNav";

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

function selectedEmployeeId(
  route: DispatchRoute,
  employees: DispatchEmployeeOption[],
  field: "driver" | "helper",
) {
  const id = field === "driver" ? route.driverId : route.helperId;
  if (id && employees.some((employee) => employee.id === id)) return id;

  const name = (field === "driver" ? route.driver : route.helper).trim().toLowerCase();
  if (!name) return "";

  return (
    employees.find((employee) => {
      const displayName = employee.name.trim().toLowerCase();
      return employee.email.toLowerCase() === name || displayName === name;
    })?.id || ""
  );
}

export async function loader({ request }: { request: Request }) {
  await requireDispatchUser(request, "routes");
  const started = performance.now();
  const url = new URL(request.url);
  const selectedRouteId = url.searchParams.get("route");
  const requestedDate = url.searchParams.get("date");
  const dateKey = requestedDate === "all" ? null : requestedDate || todayDateKey();
  const includeUndated = dateKey === todayDateKey();
  const [routes, employees, routeTiming] = await Promise.all([
    loadRoutesForMaintenance(250),
    loadDispatchEmployeeOptions(),
    loadRouteTimingSummaries({ dateKey, includeUndated }),
  ]);
  const selectedRoute =
    routes.find((route) => route.id === selectedRouteId) ||
    routes.find((route) => route.isActive) ||
    routes[0] ||
    null;

  return data({
    routes,
    employees,
    routeTiming,
    selectedRoute,
    dateKey,
    includeUndated,
    loadedAt: new Date().toISOString(),
    loadMs: Math.round(performance.now() - started),
  });
}

export async function action({ request }: { request: Request }) {
  await requireDispatchUser(request, "routes");
  await requireDispatchEditor(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  const routeId = String(form.get("routeId") || "").trim();

  if (!routeId) {
    return data({ ok: false, message: "Missing route." }, { status: 400 });
  }

  if (intent === "update-route") {
    const code = String(form.get("code") || "").trim();
    if (!code) return data({ ok: false, message: "Route code is required." }, { status: 400 });
    const employees = await loadDispatchEmployeeOptions();
    const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
    const driverId = String(form.get("driverId") || "").trim();
    const helperId = String(form.get("helperId") || "").trim();
    const driver = driverId ? employeeById.get(driverId)?.name || "" : "";
    const helper = helperId ? employeeById.get(helperId)?.name || "" : "";

    try {
      const updatedRoute = await updateDispatchRoute(routeId, {
        code,
        truck: String(form.get("truck") || ""),
        driverId: employeeById.has(driverId) ? driverId : "",
        driver,
        helperId: employeeById.has(helperId) ? helperId : "",
        helper,
        shift: String(form.get("shift") || ""),
        region: String(form.get("region") || ""),
        color: String(form.get("color") || "#38bdf8"),
        isActive: String(form.get("isActive") || "") === "true",
      });

      return data({ ok: true, message: `Saved ${updatedRoute.code}.`, updatedRoute });
    } catch (error) {
      return data(
        { ok: false, message: error instanceof Error ? error.message : "Unable to save route." },
        { status: 500 },
      );
    }
  }

  if (intent === "deactivate-route") {
    try {
      const route = await deactivateDispatchRoute(routeId);
      return data({ ok: true, message: `Deactivated ${route.code}.`, route });
    } catch (error) {
      return data(
        { ok: false, message: error instanceof Error ? error.message : "Unable to deactivate route." },
        { status: 500 },
      );
    }
  }

  if (intent === "reactivate-route") {
    try {
      const route = await reactivateDispatchRoute(routeId);
      return data({ ok: true, message: `Reactivated ${route.code}.`, route });
    } catch (error) {
      return data(
        { ok: false, message: error instanceof Error ? error.message : "Unable to reactivate route." },
        { status: 500 },
      );
    }
  }

  return data({ ok: false, message: "Unknown route action." }, { status: 400 });
}

function routeSearchText(route: DispatchRoute) {
  return [
    route.id,
    route.code,
    route.truck,
    route.driver,
    route.helper,
    route.shift,
    route.region,
    route.isActive ? "active" : "inactive",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function formatRt(minutes: number) {
  if (!minutes) return "0 min RT";
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (!hours) return `${remainingMinutes} min RT`;
  if (!remainingMinutes) return `${hours}h RT`;
  return `${hours}h ${remainingMinutes}m RT`;
}

function routeTimingFor(
  route: DispatchRoute,
  routeTiming: Record<string, DispatchRouteTimingSummary>,
) {
  return routeTiming[route.id] || {
    routeId: route.id,
    orderCount: 0,
    roundTripMinutes: 0,
    missingCount: 0,
  };
}

function routeHref(routeId: string, dateKey: string | null) {
  const params = new URLSearchParams({ route: routeId });
  params.set("date", dateKey || "all");
  return `/routes?${params.toString()}`;
}

export default function RoutesPage() {
  const { routes, employees, routeTiming, selectedRoute, dateKey, includeUndated, loadedAt, loadMs } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as { ok?: boolean; message?: string } | undefined;
  const navigation = useNavigation();
  const [search, setSearch] = useState("");
  const [minRt, setMinRt] = useState("");
  const [maxRt, setMaxRt] = useState("");
  const normalizedSearch = search.trim().toLowerCase();
  const minRtMinutes = Number(minRt);
  const maxRtMinutes = Number(maxRt);
  const visibleRoutes = useMemo(
    () => {
      const hasMinRt = minRt.trim() !== "" && Number.isFinite(minRtMinutes);
      const hasMaxRt = maxRt.trim() !== "" && Number.isFinite(maxRtMinutes);
      return routes.filter((route) => {
        const timing = routeTimingFor(route, routeTiming);
        const haystack = `${routeSearchText(route)} ${formatRt(timing.roundTripMinutes)} ${timing.roundTripMinutes} ${timing.orderCount} stops`.toLowerCase();
        if (normalizedSearch && !haystack.includes(normalizedSearch)) return false;
        if (hasMinRt && timing.roundTripMinutes < minRtMinutes) return false;
        if (hasMaxRt && timing.roundTripMinutes > maxRtMinutes) return false;
        return true;
      });
    },
    [routes, routeTiming, normalizedSearch, minRt, minRtMinutes, maxRt, maxRtMinutes],
  );

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Maintenance</p>
          <h1>Routes</h1>
          <p className="muted">
            Edit route setup and deactivate routes safely. Timing totals are for {dateKey || "all active days"}
            {includeUndated && dateKey ? " plus undated orders" : ""}.
          </p>
        </div>
        <div className="topbarActions">
          <PermissionNav />
          <div className="statusBox">
            <strong>{loadMs}ms</strong>
            <span>server load</span>
            <small>{new Date(loadedAt).toLocaleTimeString()}</small>
          </div>
        </div>
      </header>

      {(actionData?.message || navigation.state !== "idle") ? (
        <div className={actionData?.ok === false ? "notice error" : "notice"}>
          {navigation.state !== "idle" ? "Saving route..." : actionData?.message}
        </div>
      ) : null}

      <section className="toolbar">
        <input
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
          placeholder="Search route, truck, driver, helper, shift, region, RT time..."
        />
        <div className="rtFilterGroup">
          <label>
            Min RT
            <input
              inputMode="numeric"
              min="0"
              type="number"
              value={minRt}
              onChange={(event) => setMinRt(event.currentTarget.value)}
              placeholder="minutes"
            />
          </label>
          <label>
            Max RT
            <input
              inputMode="numeric"
              min="0"
              type="number"
              value={maxRt}
              onChange={(event) => setMaxRt(event.currentTarget.value)}
              placeholder="minutes"
            />
          </label>
        </div>
        <Form method="get">
          {selectedRoute?.id ? <input type="hidden" name="route" value={selectedRoute.id} /> : null}
          <input name="date" type="date" defaultValue={dateKey || todayDateKey()} />
          <button type="submit">Refresh</button>
        </Form>
      </section>

      <section className="ordersLayout">
        <aside className="panel orderBrowser">
          <div className="panelHeader">
            <div>
              <p className="eyebrow">Routes</p>
              <h2>{visibleRoutes.length} routes</h2>
            </div>
          </div>
          <div className="orderList">
            {visibleRoutes.map((route) => {
              const timing = routeTimingFor(route, routeTiming);
              return (
                <Link
                  key={route.id}
                  className={`orderCard orderLink ${selectedRoute?.id === route.id ? "selectedOrder" : ""}`}
                  to={routeHref(route.id, dateKey)}
                >
                  <strong>{route.code || "No code"} · {route.truck || "No truck"}</strong>
                  <span>{route.driver || "No driver"} {route.helper ? `· ${route.helper}` : ""}</span>
                  <small>{route.shift || "No shift"} · {route.region || "No region"}</small>
                  <div className="routeTimingLine">
                    <strong>{formatRt(timing.roundTripMinutes)}</strong>
                    <span>{timing.orderCount} stop{timing.orderCount === 1 ? "" : "s"}</span>
                    {timing.missingCount ? <span>{timing.missingCount} missing RT</span> : null}
                  </div>
                  <small>{route.isActive ? "Active" : "Inactive"}</small>
                </Link>
              );
            })}
            {!visibleRoutes.length ? <div className="empty">No matching routes.</div> : null}
          </div>
        </aside>

        <section className="panel orderEditorPanel">
          {selectedRoute ? (
            <Form key={selectedRoute.id} method="post" className="orderEditor">
              <input type="hidden" name="routeId" value={selectedRoute.id} />
              <div className="panelHeader">
                <div>
                  <p className="eyebrow">Edit Selected Route</p>
                  <h2>{selectedRoute.code || "No code"} · {selectedRoute.truck || "No truck"}</h2>
                </div>
                <span className="statusBadge">{selectedRoute.isActive ? "Active" : "Inactive"}</span>
              </div>
              <div className="createFields orderEditFields">
                <label>
                  Code
                  <input name="code" defaultValue={selectedRoute.code} required />
                </label>
                <label>
                  Truck
                  <input name="truck" defaultValue={selectedRoute.truck} />
                </label>
                <label>
                  Driver
                  <select name="driverId" defaultValue={selectedEmployeeId(selectedRoute, employees, "driver")}>
                    <option value="">No driver</option>
                    {employees.map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.name}{employee.role ? ` (${employee.role})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Helper
                  <select name="helperId" defaultValue={selectedEmployeeId(selectedRoute, employees, "helper")}>
                    <option value="">No helper</option>
                    {employees.map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.name}{employee.role ? ` (${employee.role})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Shift
                  <input name="shift" defaultValue={selectedRoute.shift} />
                </label>
                <label>
                  Region
                  <input name="region" defaultValue={selectedRoute.region} />
                </label>
                <label>
                  Color
                  <input name="color" type="color" defaultValue={selectedRoute.color || "#38bdf8"} />
                </label>
                <label>
                  Active
                  <select name="isActive" defaultValue={selectedRoute.isActive ? "true" : "false"}>
                    <option value="true">Active</option>
                    <option value="false">Inactive</option>
                  </select>
                </label>
              </div>
              <div className="editorActions">
                <button className="successButton" type="submit" name="intent" value="update-route">Save Route</button>
                <button
                  className="dangerButton"
                  type="submit"
                  name="intent"
                  value="deactivate-route"
                  disabled={!selectedRoute.isActive}
                >
                  Deactivate
                </button>
                <button
                  className="primaryButton"
                  type="submit"
                  name="intent"
                  value="reactivate-route"
                  disabled={selectedRoute.isActive}
                >
                  Reactivate
                </button>
              </div>
            </Form>
          ) : (
            <div className="bigEmpty">
              <h2>No route selected</h2>
              <p className="muted">Choose a route from the list to edit it.</p>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
