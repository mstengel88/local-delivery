import { data, Form, Link, useLoaderData, useNavigation } from "react-router";
import { PermissionNav } from "../components/PermissionNav";
import { requireDispatchUser } from "../lib/auth.server";
import {
  loadDispatchPlanningOrders,
} from "../lib/dispatch.server";
import type { DispatchOrder } from "../lib/dispatch.server";

type AllotmentView = "day" | "week" | "month" | "list";

type MaterialTotal = {
  key: string;
  material: string;
  unit: string;
  quantity: number;
  ticketCount: number;
  deliveredQuantity: number;
  deliveredTicketCount: number;
};

function parseDateKey(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? new Date(`${todayDateKey()}T12:00:00`) : date;
}

function dateKeyFromDate(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

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

function dateKeyFromValue(value?: string | null) {
  const rawValue = String(value || "").trim();
  if (!rawValue) return "";

  const isoMatch = rawValue.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const slashMatch = rawValue.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (slashMatch) {
    return `${slashMatch[3]}-${slashMatch[1].padStart(2, "0")}-${slashMatch[2].padStart(2, "0")}`;
  }

  const parsedDate = new Date(rawValue);
  if (Number.isNaN(parsedDate.getTime())) return "";
  return dateKeyFromDate(parsedDate);
}

function shiftDateKey(value: string, amount: number, unit: AllotmentView) {
  const date = parseDateKey(value);
  if (unit === "month") date.setMonth(date.getMonth() + amount);
  else date.setDate(date.getDate() + amount * (unit === "week" ? 7 : 1));
  return dateKeyFromDate(date);
}

function weekStart(value: string) {
  const date = parseDateKey(value);
  date.setDate(date.getDate() - date.getDay());
  return date;
}

function visibleDays(view: AllotmentView, dateKey: string) {
  if (view === "day") return [dateKey];
  if (view === "week" || view === "list") {
    const start = weekStart(dateKey);
    return Array.from({ length: 7 }, (_, index) => {
      const day = new Date(start);
      day.setDate(start.getDate() + index);
      return dateKeyFromDate(day);
    });
  }

  const selected = parseDateKey(dateKey);
  const days: string[] = [];
  const cursor = new Date(selected.getFullYear(), selected.getMonth(), 1, 12);
  while (cursor.getMonth() === selected.getMonth()) {
    days.push(dateKeyFromDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function formatDay(value: string) {
  return parseDateKey(value).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatHeading(view: AllotmentView, dateKey: string) {
  const date = parseDateKey(dateKey);
  if (view === "month") return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  if (view === "day") return date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const start = weekStart(dateKey);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

function orderDateKey(order: DispatchOrder) {
  return dateKeyFromValue(order.requestedWindow);
}

function quantity(order: DispatchOrder) {
  const value = Number(String(order.quantity || "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(value) ? value : 0;
}

function totalKey(order: DispatchOrder) {
  return `${order.material.trim().toLowerCase()}|${order.unit.trim().toLowerCase()}`;
}

function formatQuantity(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}

function isDelivered(order: DispatchOrder) {
  return order.status === "delivered" || order.deliveryStatus === "delivered";
}

function quantityLabel(quantityValue: number, unit: string) {
  return `${formatQuantity(quantityValue)} ${unit}${quantityValue === 1 ? "" : "s"}`;
}

function buildTotals(orders: DispatchOrder[]) {
  const totals = new Map<string, MaterialTotal>();
  for (const order of orders) {
    const key = totalKey(order);
    const orderQuantity = quantity(order);
    const existing = totals.get(key);
    if (existing) {
      existing.quantity += orderQuantity;
      existing.ticketCount += 1;
      if (isDelivered(order)) {
        existing.deliveredQuantity += orderQuantity;
        existing.deliveredTicketCount += 1;
      }
    } else {
      totals.set(key, {
        key,
        material: order.material || "Unknown material",
        unit: order.unit || "Unit",
        quantity: orderQuantity,
        ticketCount: 1,
        deliveredQuantity: isDelivered(order) ? orderQuantity : 0,
        deliveredTicketCount: isDelivered(order) ? 1 : 0,
      });
    }
  }
  return Array.from(totals.values()).sort((left, right) => left.material.localeCompare(right.material));
}

function searchText(order: DispatchOrder) {
  return [
    order.material,
    order.unit,
    order.quantity,
    order.requestedWindow,
    order.timePreference,
    order.status,
    order.deliveryStatus,
  ].filter(Boolean).join(" ").toLowerCase();
}

export async function loader({ request }: { request: Request }) {
  await requireDispatchUser(request, "allotment");
  const started = performance.now();
  const url = new URL(request.url);
  const view = (url.searchParams.get("view") || "week") as AllotmentView;
  const safeView: AllotmentView = ["day", "week", "month", "list"].includes(view) ? view : "week";
  const dateKey = url.searchParams.get("date") || todayDateKey();
  const q = (url.searchParams.get("q") || "").trim();
  const orders = (await loadDispatchPlanningOrders(1500)).filter((order) => {
    if (order.status === "cancelled") return false;
    return q ? searchText(order).includes(q.toLowerCase()) : true;
  });

  return data({
    orders,
    view: safeView,
    dateKey,
    q,
    loadedAt: new Date().toISOString(),
    loadMs: Math.round(performance.now() - started),
  });
}

export default function AllotmentPage() {
  const { orders, view, dateKey, q, loadedAt, loadMs } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const days = visibleDays(view, dateKey);
  const daySet = new Set(days);
  const ordersByDay = new Map<string, DispatchOrder[]>();
  const undatedOrders: DispatchOrder[] = [];

  for (const order of orders) {
    const key = orderDateKey(order);
    if (!key) {
      undatedOrders.push(order);
      continue;
    }
    if (daySet.has(key)) {
      ordersByDay.set(key, [...(ordersByDay.get(key) || []), order]);
    }
  }

  const rangeOrders = days.flatMap((day) => ordersByDay.get(day) || []);
  const rangeTotals = buildTotals(rangeOrders);
  const previousDate = shiftDateKey(dateKey, -1, view);
  const nextDate = shiftDateKey(dateKey, 1, view);

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Material Allotment</p>
          <h1>Daily Material Totals</h1>
          <p className="muted">Material and quantity planning by requested delivery date. Customer details are intentionally hidden.</p>
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

      <section className="toolbar calendarToolbar">
        <Form method="get" className="calendarControls">
          <input name="q" defaultValue={q} placeholder="Filter by material, unit, status, date..." />
          <input name="date" type="date" defaultValue={dateKey} />
          <select name="view" defaultValue={view}>
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
            <option value="list">List</option>
          </select>
          <button type="submit" disabled={navigation.state !== "idle"}>Apply</button>
        </Form>
        <div className="calendarNav">
          <Link to={`/allotment?view=${view}&date=${previousDate}${q ? `&q=${encodeURIComponent(q)}` : ""}`}>Previous</Link>
          <strong>{formatHeading(view, dateKey)}</strong>
          <Link to={`/allotment?view=${view}&date=${nextDate}${q ? `&q=${encodeURIComponent(q)}` : ""}`}>Next</Link>
        </div>
      </section>

      <section className="allotmentSummary">
        {rangeTotals.map((total) => (
          <article key={total.key} className="panel allotmentTotalCard">
            <p className="eyebrow">{total.unit}</p>
            <h2>{total.material}</h2>
            <strong>{quantityLabel(total.quantity, total.unit)}</strong>
            {total.deliveredQuantity ? (
              <span className="allotmentDeliveredDebit">
                -{quantityLabel(total.deliveredQuantity, total.unit)} delivered
              </span>
            ) : null}
            <span>{total.ticketCount} ticket{total.ticketCount === 1 ? "" : "s"}</span>
          </article>
        ))}
        {!rangeTotals.length ? <div className="panel empty">No material totals for this view.</div> : null}
      </section>

      <section className={view === "list" ? "allotmentList" : "allotmentDays"}>
        {days.map((day) => {
          const dayOrders = ordersByDay.get(day) || [];
          const totals = buildTotals(dayOrders);
          return (
            <article key={day} className="panel allotmentDay">
              <div className="calendarDayHeader">
                <strong>{formatDay(day)}</strong>
                <span>{dayOrders.length}</span>
              </div>
              <div className="allotmentRows">
                {totals.map((total) => (
                  <div key={total.key} className="allotmentRow">
                    <strong>{total.material}</strong>
                    <span>{quantityLabel(total.quantity, total.unit)}</span>
                    {total.deliveredQuantity ? (
                      <em className="allotmentDeliveredDebit">
                        -{quantityLabel(total.deliveredQuantity, total.unit)}
                      </em>
                    ) : null}
                    <small>{total.ticketCount} ticket{total.ticketCount === 1 ? "" : "s"}</small>
                  </div>
                ))}
                {!totals.length ? <p className="muted">No material scheduled.</p> : null}
              </div>
            </article>
          );
        })}
      </section>

      {undatedOrders.length ? (
        <section className="panel undatedPanel">
          <div className="panelHeader">
            <div>
              <p className="eyebrow">No Requested Date</p>
              <h2>Undated material</h2>
            </div>
          </div>
          <div className="allotmentRows">
            {buildTotals(undatedOrders).map((total) => (
              <div key={total.key} className="allotmentRow">
                <strong>{total.material}</strong>
                <span>{quantityLabel(total.quantity, total.unit)}</span>
                {total.deliveredQuantity ? (
                  <em className="allotmentDeliveredDebit">
                    -{quantityLabel(total.deliveredQuantity, total.unit)}
                  </em>
                ) : null}
                <small>{total.ticketCount} ticket{total.ticketCount === 1 ? "" : "s"}</small>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
