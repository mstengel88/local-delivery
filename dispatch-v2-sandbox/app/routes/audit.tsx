import { useMemo, useState } from "react";
import { data, Form, Link, useLoaderData } from "react-router";
import { requireDispatchUser } from "../lib/auth.server";
import { PermissionNav } from "../components/PermissionNav";
import { loadAuditEvents, type DispatchAuditEvent } from "../lib/dispatch.server";

export async function loader({ request }: { request: Request }) {
  await requireDispatchUser(request, "audit");
  const started = performance.now();
  const events = await loadAuditEvents(150);
  return data({
    events,
    loadedAt: new Date().toISOString(),
    loadMs: Math.round(performance.now() - started),
  });
}

function formatTime(value: string) {
  if (!value) return "Unknown time";
  return new Date(value).toLocaleString("en-US", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Chicago",
  });
}

function eventSearchText(event: DispatchAuditEvent) {
  return [
    event.action,
    event.actor,
    event.orderId,
    event.routeId,
    event.message,
    event.createdAt,
    JSON.stringify(event.beforeJson || {}),
    JSON.stringify(event.afterJson || {}),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function jsonPreview(value: Record<string, unknown> | null) {
  if (!value) return "None";
  return JSON.stringify(value, null, 2);
}

export default function AuditPage() {
  const { events, loadedAt, loadMs } = useLoaderData<typeof loader>();
  const [search, setSearch] = useState("");
  const normalizedSearch = search.trim().toLowerCase();
  const visibleEvents = useMemo(
    () =>
      normalizedSearch
        ? events.filter((event) => eventSearchText(event).includes(normalizedSearch))
        : events,
    [events, normalizedSearch],
  );

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Reliability</p>
          <h1>Audit Trail</h1>
          <p className="muted">Recent dispatch actions with before/after snapshots.</p>
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

      <section className="toolbar">
        <input
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
          placeholder="Search actor, action, order, route, changed values..."
        />
        <Form method="get">
          <button type="submit">Refresh</button>
        </Form>
      </section>

      <section className="auditList">
        {visibleEvents.map((event) => (
          <article key={event.id} className="panel auditCard">
            <div className="auditHeader">
              <div>
                <p className="eyebrow">{event.action.replaceAll("_", " ")}</p>
                <h2>{event.message || "No message recorded"}</h2>
                <p className="muted">
                  {formatTime(event.createdAt)} · {event.actor || "Unknown actor"}
                </p>
              </div>
              <span className="statusBadge">
                {event.orderId ? `Order ${event.orderId}` : "System"}
              </span>
            </div>
            <details>
              <summary>Show before / after</summary>
              <div className="jsonGrid">
                <div>
                  <strong>Before</strong>
                  <pre>{jsonPreview(event.beforeJson)}</pre>
                </div>
                <div>
                  <strong>After</strong>
                  <pre>{jsonPreview(event.afterJson)}</pre>
                </div>
              </div>
            </details>
          </article>
        ))}

        {!visibleEvents.length ? (
          <section className="panel bigEmpty">
            <h2>No audit events found</h2>
            <p className="muted">Try clearing search, or run the Phase 3 SQL if this is a fresh database.</p>
          </section>
        ) : null}
      </section>
    </main>
  );
}
