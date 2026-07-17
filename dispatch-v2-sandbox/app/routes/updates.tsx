import { useMemo, useState } from "react";
import { data, Form, Link, useLoaderData } from "react-router";
import { requireDispatchUser } from "../lib/auth.server";
import { PermissionNav } from "../components/PermissionNav";
import { loadAuditEvents, type DispatchAuditEvent } from "../lib/dispatch.server";

type ChangeItem = {
  field: string;
  before: string;
  after: string;
};

const SHOPIFY_ACTIONS = new Set([
  "shopify_import_order",
  "shopify_update_order",
  "shopify_import_complete",
]);

const DISPLAY_FIELDS = [
  "orderNumber",
  "customer",
  "contact",
  "address",
  "city",
  "material",
  "quantity",
  "unit",
  "requestedWindow",
  "timePreference",
  "status",
  "deliveryStatus",
  "proofNotes",
  "checklistJson",
];

export async function loader({ request }: { request: Request }) {
  await requireDispatchUser(request, "updates");
  const started = performance.now();
  const events = (await loadAuditEvents(300)).filter((event) => SHOPIFY_ACTIONS.has(event.action));
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

function safeObject(value: unknown) {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "blank";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function labelField(field: string) {
  return field
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function diffEvent(event: DispatchAuditEvent): ChangeItem[] {
  const before = safeObject(event.beforeJson);
  const after = safeObject(event.afterJson);

  if (event.action === "shopify_import_order") {
    return [{ field: "Imported", before: "not in dispatch", after: displayValue(after.orderNumber || event.orderId) }];
  }

  if (event.action === "shopify_import_complete") {
    return [{ field: "Summary", before: "previous run", after: event.message || "Import complete" }];
  }

  return DISPLAY_FIELDS.flatMap((field) => {
    const beforeValue = displayValue(before[field]);
    const afterValue = displayValue(after[field]);
    if (beforeValue === afterValue) return [];
    return [{ field: labelField(field), before: beforeValue, after: afterValue }];
  });
}

function eventSearchText(event: DispatchAuditEvent, changes: ChangeItem[]) {
  return [
    event.action,
    event.actor,
    event.orderId,
    event.routeId,
    event.message,
    event.createdAt,
    ...changes.flatMap((change) => [change.field, change.before, change.after]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export default function UpdatesPage() {
  const { events, loadedAt, loadMs } = useLoaderData<typeof loader>();
  const [search, setSearch] = useState("");
  const normalizedSearch = search.trim().toLowerCase();
  const eventRows = useMemo(
    () => events.map((event) => ({ event, changes: diffEvent(event) })),
    [events],
  );
  const visibleRows = useMemo(
    () =>
      normalizedSearch
        ? eventRows.filter(({ event, changes }) => eventSearchText(event, changes).includes(normalizedSearch))
        : eventRows,
    [eventRows, normalizedSearch],
  );

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Shopify Reconciliation</p>
          <h1>Updates</h1>
          <p className="muted">Every Shopify import and changed ticket, with the exact fields that moved.</p>
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
          placeholder="Search order number, customer, changed field, old value, new value..."
        />
        <Form method="get">
          <button type="submit">Refresh</button>
        </Form>
      </section>

      <section className="updatesList">
        {visibleRows.map(({ event, changes }) => (
          <article key={event.id} className="panel updateCard">
            <div className="auditHeader">
              <div>
                <p className="eyebrow">{event.action.replaceAll("_", " ")}</p>
                <h2>{event.message || "Shopify update"}</h2>
                <p className="muted">
                  {formatTime(event.createdAt)} · {event.actor || "shopify-import"}
                </p>
              </div>
              <span className="statusBadge">
                {event.orderId ? `Order ${event.orderId}` : "Import Run"}
              </span>
            </div>

            <div className="changeGrid">
              {changes.map((change) => (
                <div key={`${event.id}-${change.field}-${change.after}`} className="changePill">
                  <span>{change.field}</span>
                  <strong>{change.before}</strong>
                  <b>{change.after}</b>
                </div>
              ))}
              {!changes.length ? <p className="muted">No field-level changes were recorded.</p> : null}
            </div>
          </article>
        ))}

        {!visibleRows.length ? (
          <section className="panel bigEmpty">
            <h2>No Shopify updates found</h2>
            <p className="muted">Run an import from the Import page, or clear the search box.</p>
          </section>
        ) : null}
      </section>
    </main>
  );
}
