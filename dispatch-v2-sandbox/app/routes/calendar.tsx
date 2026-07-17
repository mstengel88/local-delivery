import { data, Form, Link, useLoaderData, useNavigation } from "react-router";
import { PermissionNav } from "../components/PermissionNav";
import { requireDispatchUser } from "../lib/auth.server";
import {
  loadDispatchPlanningOrders,
} from "../lib/dispatch.server";
import type { DispatchOrder } from "../lib/dispatch.server";

type CalendarView = "day" | "week" | "month" | "list";

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

function shiftDateKey(value: string, amount: number, unit: CalendarView) {
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

function monthGrid(value: string) {
  const selected = parseDateKey(value);
  const start = new Date(selected.getFullYear(), selected.getMonth(), 1, 12);
  start.setDate(start.getDate() - start.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return dateKeyFromDate(day);
  });
}

function viewDays(view: CalendarView, dateKey: string) {
  if (view === "day") return [dateKey];
  if (view === "week") {
    const start = weekStart(dateKey);
    return Array.from({ length: 7 }, (_, index) => {
      const day = new Date(start);
      day.setDate(start.getDate() + index);
      return dateKeyFromDate(day);
    });
  }
  if (view === "month") return monthGrid(dateKey);
  return [];
}

function formatDay(value: string) {
  return parseDateKey(value).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatHeading(view: CalendarView, dateKey: string) {
  const date = parseDateKey(dateKey);
  if (view === "month") {
    return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }
  if (view === "week") {
    const start = weekStart(dateKey);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
  }
  if (view === "list") return "List View";
  return date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function orderDateKey(order: DispatchOrder) {
  return dateKeyFromValue(order.requestedWindow);
}

function isDelivered(order: DispatchOrder) {
  return order.status === "delivered" || order.deliveryStatus === "delivered";
}

function searchText(order: DispatchOrder) {
  return [
    order.orderNumber,
    order.customer,
    order.contact,
    order.address,
    order.city,
    order.material,
    order.quantity,
    order.unit,
    order.requestedWindow,
    order.timePreference,
    order.status,
    order.deliveryStatus,
    order.proofNotes,
  ].filter(Boolean).join(" ").toLowerCase();
}

export async function loader({ request }: { request: Request }) {
  await requireDispatchUser(request, "calendar");
  const started = performance.now();
  const url = new URL(request.url);
  const view = (url.searchParams.get("view") || "month") as CalendarView;
  const safeView: CalendarView = ["day", "week", "month", "list"].includes(view) ? view : "month";
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

export default function CalendarPage() {
  const { orders, view, dateKey, q, loadedAt, loadMs } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const days = viewDays(view, dateKey);
  const selectedMonth = parseDateKey(dateKey).getMonth();
  const ordersByDay = new Map<string, DispatchOrder[]>();
  const undatedOrders: DispatchOrder[] = [];

  for (const order of orders) {
    const key = orderDateKey(order);
    if (!key) {
      undatedOrders.push(order);
      continue;
    }
    ordersByDay.set(key, [...(ordersByDay.get(key) || []), order]);
  }

  const visibleListOrders = view === "list"
    ? [...orders].sort((left, right) => (orderDateKey(left) || "9999").localeCompare(orderDateKey(right) || "9999"))
    : [];
  const previousDate = shiftDateKey(dateKey, -1, view === "list" ? "week" : view);
  const nextDate = shiftDateKey(dateKey, 1, view === "list" ? "week" : view);

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Delivery Calendar</p>
          <h1>Requested Delivery Dates</h1>
          <p className="muted">Orders are placed by requested date. Cancelled orders are hidden.</p>
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
          <input name="q" defaultValue={q} placeholder="Search orders, customers, material, address, notes..." />
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
          <Link to={`/calendar?view=${view}&date=${previousDate}${q ? `&q=${encodeURIComponent(q)}` : ""}`}>Previous</Link>
          <strong>{formatHeading(view, dateKey)}</strong>
          <Link to={`/calendar?view=${view}&date=${nextDate}${q ? `&q=${encodeURIComponent(q)}` : ""}`}>Next</Link>
        </div>
      </section>

      {view === "list" ? (
        <section className="panel calendarListPanel">
          {visibleListOrders.map((order) => (
            <Link
              key={order.id}
              className={`calendarListRow ${isDelivered(order) ? "calendarDeliveredOrder" : ""}`}
              to={`/orders?order=${encodeURIComponent(order.id)}`}
            >
              <strong>#{order.orderNumber}</strong>
              <span>{orderDateKey(order) || "No date"}</span>
              <span>{order.customer}</span>
              <span>{order.quantity} {order.unit} {order.material}</span>
              <small>{order.timePreference || "Anytime"} · {order.status}</small>
            </Link>
          ))}
          {!visibleListOrders.length ? <div className="empty">No matching orders.</div> : null}
        </section>
      ) : (
        <section className={`calendarGrid calendarGrid-${view}`}>
          {days.map((day) => {
            const dayOrders = ordersByDay.get(day) || [];
            const isMuted = view === "month" && parseDateKey(day).getMonth() !== selectedMonth;
            return (
              <article key={day} className={`panel calendarDay ${isMuted ? "mutedDay" : ""}`}>
                <div className="calendarDayHeader">
                  <strong>{formatDay(day)}</strong>
                  <span>{dayOrders.length}</span>
                </div>
                <div className="calendarOrders">
                  {dayOrders.slice(0, view === "month" ? 5 : 30).map((order) => (
                    <Link
                      key={order.id}
                      to={`/orders?order=${encodeURIComponent(order.id)}`}
                      className={`calendarOrderCard ${isDelivered(order) ? "calendarDeliveredOrder" : ""}`}
                    >
                      <strong>#{order.orderNumber}</strong>
                      <span>{order.customer}</span>
                      <small>{order.quantity} {order.unit} {order.material}</small>
                      <em>{order.timePreference || "Anytime"} · {order.status}</em>
                    </Link>
                  ))}
                  {dayOrders.length > (view === "month" ? 5 : 30) ? (
                    <Link className="calendarMore" to={`/calendar?view=day&date=${day}${q ? `&q=${encodeURIComponent(q)}` : ""}`}>
                      +{dayOrders.length - (view === "month" ? 5 : 30)} more
                    </Link>
                  ) : null}
                </div>
              </article>
            );
          })}
        </section>
      )}

      {undatedOrders.length ? (
        <section className="panel undatedPanel">
          <div className="panelHeader">
            <div>
              <p className="eyebrow">No Requested Date</p>
              <h2>{undatedOrders.length} undated orders</h2>
            </div>
          </div>
          <div className="calendarUndatedList">
            {undatedOrders.slice(0, 20).map((order) => (
              <Link key={order.id} to={`/orders?order=${encodeURIComponent(order.id)}`}>
                #{order.orderNumber} · {order.customer} · {order.quantity} {order.unit} {order.material}
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
