import { useEffect, useState, type ChangeEvent } from "react";
import {
  data,
  Form,
  isRouteErrorResponse,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  useRouteError,
} from "react-router";
import {
  cancelDispatchOrder,
  clearDriverOrderAttachment,
  deleteDispatchOrder,
  loadOrderForMaintenance,
  loadOrdersForMaintenance,
  reopenDispatchOrder,
  saveDriverOrderAttachment,
  updateDispatchOrder,
  type DispatchOrder,
} from "../lib/dispatch.server";
import { requireDispatchEditor, requireDispatchUser } from "../lib/auth.server";
import { PermissionNav } from "../components/PermissionNav";

export async function loader({ request }: { request: Request }) {
  await requireDispatchUser(request, "orders");
  const started = performance.now();
  const url = new URL(request.url);
  const selectedOrderId = url.searchParams.get("order");
  const search = url.searchParams.get("q") || "";
  let orders: DispatchOrder[] = [];
  let storageError = "";
  try {
    orders = await loadOrdersForMaintenance(search ? 100 : 75, { search });
  } catch (error) {
    storageError = error instanceof Error ? error.message : "Unable to load orders.";
  }
  const selectedOrderFromList =
    orders.find((order) => order.id === selectedOrderId) ||
    orders.find((order) => order.status !== "cancelled") ||
    orders[0] ||
    null;
  let selectedOrder = selectedOrderFromList;
  const selectedOrderDetailId = selectedOrderId || selectedOrderFromList?.id;
  if (selectedOrderDetailId) {
    try {
      selectedOrder = await loadOrderForMaintenance(selectedOrderDetailId) || selectedOrderFromList;
    } catch (error) {
      storageError = error instanceof Error ? error.message : storageError || "Unable to load selected order.";
    }
  }

  return data({
    orders,
    selectedOrder,
    search,
    storageError,
    loadedAt: new Date().toISOString(),
    loadMs: Math.round(performance.now() - started),
  });
}

export async function action({ request }: { request: Request }) {
  await requireDispatchUser(request, "orders");
  await requireDispatchEditor(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  const orderId = String(form.get("orderId") || "").trim();

  if (!orderId) {
    return data({ ok: false, message: "Missing order." }, { status: 400 });
  }

  if (intent === "update-order") {
    const customer = String(form.get("customer") || "").trim();
    const address = String(form.get("address") || "").trim();
    const city = String(form.get("city") || "").trim();
    const material = String(form.get("material") || "").trim();
    const quantity = String(form.get("quantity") || "").trim();
    const unit = String(form.get("unit") || "").trim();

    if (!customer || !address || !city || !material || !quantity || !unit) {
      return data({ ok: false, message: "Customer, address, city, material, quantity, and unit are required." }, { status: 400 });
    }

    const updatedOrder = await updateDispatchOrder(orderId, {
      orderNumber: String(form.get("orderNumber") || ""),
      customer,
      contact: String(form.get("contact") || ""),
      address,
      city,
      material,
      quantity,
      unit,
      requestedWindow: String(form.get("requestedWindow") || ""),
      timePreference: String(form.get("timePreference") || "Anytime"),
      status: String(form.get("status") || "new") as DispatchOrder["status"],
      notes: String(form.get("notes") || ""),
    });

    return data({ ok: true, message: `Saved ${updatedOrder.orderNumber}.`, updatedOrder });
  }

  if (intent === "cancel-order") {
    const cancelledOrder = await cancelDispatchOrder(orderId);
    return data({ ok: true, message: `Cancelled ${cancelledOrder.orderNumber}.`, cancelledOrder });
  }

  if (intent === "reopen-order") {
    const reopenedOrder = await reopenDispatchOrder(orderId);
    return data({ ok: true, message: `Reopened ${reopenedOrder.orderNumber}.`, reopenedOrder });
  }

  if (intent === "delete-order") {
    const deletedOrder = await deleteDispatchOrder(orderId);
    return data({ ok: true, message: `Deleted ${deletedOrder.orderNumber}.`, deletedOrder });
  }

  if (intent === "save-driver-attachment") {
    const attachmentDataUrl = String(form.get("attachmentDataUrl") || "").trim();
    if (!attachmentDataUrl) {
      return data({ ok: false, message: "Choose a photo before saving the driver attachment." }, { status: 400 });
    }
    try {
      const updatedOrder = await saveDriverOrderAttachment(orderId, {
        dataUrl: attachmentDataUrl,
        name: String(form.get("attachmentName") || ""),
        note: String(form.get("attachmentNote") || ""),
      });
      return data({ ok: true, message: `Driver photo saved for ${updatedOrder.orderNumber}.`, updatedOrder });
    } catch (error) {
      return data(
        { ok: false, message: error instanceof Error ? error.message : "Unable to save driver photo." },
        { status: 500 },
      );
    }
  }

  if (intent === "clear-driver-attachment") {
    try {
      const updatedOrder = await clearDriverOrderAttachment(orderId);
      return data({ ok: true, message: `Driver photo removed for ${updatedOrder.orderNumber}.`, updatedOrder });
    } catch (error) {
      return data(
        { ok: false, message: error instanceof Error ? error.message : "Unable to remove driver photo." },
        { status: 500 },
      );
    }
  }

  return data({ ok: false, message: "Unknown order action." }, { status: 400 });
}

type DriverAttachment = {
  dataUrl: string;
  name?: string;
  note?: string;
  attachedAt?: string;
};

function driverAttachmentFromChecklist(value?: string | null): DriverAttachment | null {
  try {
    const parsed = JSON.parse(value || "{}") as { driverAttachment?: DriverAttachment };
    return typeof parsed.driverAttachment?.dataUrl === "string" ? parsed.driverAttachment : null;
  } catch {
    return null;
  }
}

function orderNumber(order: DispatchOrder) {
  return order.orderNumber ? `#${order.orderNumber}` : order.id;
}

function statusLabel(order: DispatchOrder) {
  if (order.status === "cancelled") return "Cancelled";
  if (order.status === "delivered" || order.deliveryStatus === "delivered") return "Delivered";
  if (order.assignedRouteId) return "Scheduled";
  return order.status === "hold" ? "Hold" : "New";
}

function dateInputValue(value: string) {
  const isoMatch = value.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const slashMatch = value.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (slashMatch) {
    return `${slashMatch[3]}-${slashMatch[1].padStart(2, "0")}-${slashMatch[2].padStart(2, "0")}`;
  }

  return "";
}

function DriverAttachmentEditor({ selectedOrder }: { selectedOrder: DispatchOrder }) {
  const existingAttachment = driverAttachmentFromChecklist(selectedOrder.checklistJson);
  const [attachmentDataUrl, setAttachmentDataUrl] = useState(existingAttachment?.dataUrl || "");
  const [attachmentName, setAttachmentName] = useState(existingAttachment?.name || "");
  const [attachmentNote, setAttachmentNote] = useState(existingAttachment?.note || "");

  useEffect(() => {
    const nextAttachment = driverAttachmentFromChecklist(selectedOrder.checklistJson);
    setAttachmentDataUrl(nextAttachment?.dataUrl || "");
    setAttachmentName(nextAttachment?.name || "");
    setAttachmentNote(nextAttachment?.note || "");
  }, [selectedOrder.id, selectedOrder.checklistJson]);

  function handleAttachmentChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) {
      setAttachmentDataUrl(existingAttachment?.dataUrl || "");
      setAttachmentName(existingAttachment?.name || "");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setAttachmentDataUrl(typeof reader.result === "string" ? reader.result : "");
      setAttachmentName(file.name);
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="driverAttachmentEditor">
      <div className="panelHeader">
        <div>
          <p className="eyebrow">Driver Route Photo</p>
          <h3>Photo visible to the driver</h3>
          <p className="muted">Attach a product, placement, or jobsite photo for this specific order.</p>
        </div>
      </div>
      <Form method="post" className="attachmentForm">
        <input type="hidden" name="intent" value="save-driver-attachment" />
        <input type="hidden" name="orderId" value={selectedOrder.id} />
        <input type="hidden" name="attachmentDataUrl" value={attachmentDataUrl} />
        <input type="hidden" name="attachmentName" value={attachmentName} />
        <label>
          Add or replace photo
          <input type="file" accept="image/*" onChange={handleAttachmentChange} />
        </label>
        <label>
          Driver note
          <input
            name="attachmentNote"
            value={attachmentNote}
            onChange={(event) => setAttachmentNote(event.currentTarget.value)}
            placeholder="Example: Mix ratio, drop location, matching stone, etc."
          />
        </label>
        {attachmentDataUrl ? (
          <figure className="attachmentPreview">
            <img src={attachmentDataUrl} alt="Driver attachment preview" />
            <figcaption>{attachmentName || "Driver photo ready"}</figcaption>
          </figure>
        ) : (
          <div className="empty">No driver photo attached yet.</div>
        )}
        <button className="primaryButton" type="submit" disabled={!attachmentDataUrl}>
          Save Driver Photo
        </button>
      </Form>
      {existingAttachment ? (
        <Form method="post" className="attachmentRemoveForm">
          <input type="hidden" name="intent" value="clear-driver-attachment" />
          <input type="hidden" name="orderId" value={selectedOrder.id} />
          <button className="dangerButton" type="submit">
            Remove Driver Photo
          </button>
        </Form>
      ) : null}
    </div>
  );
}

export default function OrdersPage() {
  const { orders, selectedOrder, search, storageError, loadedAt, loadMs } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as { ok?: boolean; message?: string } | undefined;
  const navigation = useNavigation();
  const visibleOrders = orders;
  const orderUrl = (order: DispatchOrder) => {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    params.set("order", order.id);
    return `/orders?${params.toString()}`;
  };

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Maintenance</p>
          <h1>Orders</h1>
          <p className="muted">Search, edit, cancel, and reopen dispatch tickets.</p>
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
          {navigation.state !== "idle" ? "Saving order..." : actionData?.message}
        </div>
      ) : null}

      {storageError ? (
        <div className="notice error">
          Orders storage error: {storageError}
        </div>
      ) : null}

      <section className="toolbar">
        <Form method="get">
          <input
            name="q"
            defaultValue={search}
            placeholder="Search order, customer, address, material, status..."
          />
          <button type="submit">Refresh</button>
        </Form>
        {search ? (
          <Link className="toolbarLink" to="/orders">
            Clear search
          </Link>
        ) : null}
      </section>

      <section className="ordersLayout">
        <aside className="panel orderBrowser">
          <div className="panelHeader">
            <div>
              <p className="eyebrow">Tickets</p>
              <h2>{visibleOrders.length} orders</h2>
            </div>
          </div>
          <div className="orderList">
            {visibleOrders.map((order) => (
              <Link
                key={order.id}
                className={`orderCard orderLink ${selectedOrder?.id === order.id ? "selectedOrder" : ""}`}
                to={orderUrl(order)}
              >
                <strong>{orderNumber(order)} · {order.customer || "No customer"}</strong>
                <span>{order.address}, {order.city}</span>
                <small>{order.quantity} {order.unit} · {order.material}</small>
                <small>{order.requestedWindow || "No date"} · {statusLabel(order)}</small>
              </Link>
            ))}
            {!visibleOrders.length ? <div className="empty">No matching orders.</div> : null}
          </div>
        </aside>

        <section className="panel orderEditorPanel">
          {selectedOrder ? (
            <>
              <Form key={selectedOrder.id} method="post" className="orderEditor">
                <input type="hidden" name="orderId" value={selectedOrder.id} />
                <div className="panelHeader">
                  <div>
                    <p className="eyebrow">Edit Selected Order</p>
                    <h2>{orderNumber(selectedOrder)} · {selectedOrder.customer || "No customer"}</h2>
                  </div>
                  <span className="statusBadge">{statusLabel(selectedOrder)}</span>
                </div>
                <div className="createFields orderEditFields">
                  <label>
                    Order number
                    <input name="orderNumber" defaultValue={selectedOrder.orderNumber} />
                  </label>
                  <label>
                    Customer
                    <input name="customer" defaultValue={selectedOrder.customer} required />
                  </label>
                  <label>
                    Contact
                    <input name="contact" defaultValue={selectedOrder.contact} />
                  </label>
                  <label>
                    Address
                    <input name="address" defaultValue={selectedOrder.address} required />
                  </label>
                  <label>
                    City
                    <input name="city" defaultValue={selectedOrder.city} required />
                  </label>
                  <label>
                    Requested
                    <input name="requestedWindow" type="date" defaultValue={dateInputValue(selectedOrder.requestedWindow)} />
                  </label>
                  <label className="wideField">
                    Material
                    <input name="material" defaultValue={selectedOrder.material} required />
                  </label>
                  <label>
                    Quantity
                    <input name="quantity" defaultValue={selectedOrder.quantity} required />
                  </label>
                  <label>
                    Unit
                    <select name="unit" defaultValue={selectedOrder.unit || "Unit"} required>
                      <option>Yard</option>
                      <option>Ton</option>
                      <option>Bag</option>
                      <option>Gallon</option>
                      <option>Unit</option>
                    </select>
                  </label>
                  <label>
                    Time
                    <select name="timePreference" defaultValue={selectedOrder.timePreference || "Anytime"}>
                      <option>Anytime</option>
                      <option>Morning</option>
                      <option>Afternoon</option>
                      <option>Evening</option>
                    </select>
                  </label>
                  <label>
                    Status
                    <select name="status" defaultValue={selectedOrder.status}>
                      <option value="new">New</option>
                      <option value="scheduled">Scheduled</option>
                      <option value="hold">Hold</option>
                      <option value="delivered">Delivered</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </label>
                  <label className="wideField">
                    Notes
                    <textarea
                      name="notes"
                      defaultValue={selectedOrder.proofNotes || ""}
                      placeholder="Order notes, delivery instructions, or Shopify-style order note"
                      rows={4}
                    />
                  </label>
                </div>
                <div className="editorActions">
                  <button className="successButton" type="submit" name="intent" value="update-order">Save Order</button>
                  <button
                    className="dangerButton"
                    type="submit"
                    name="intent"
                    value="cancel-order"
                    disabled={selectedOrder.status === "cancelled"}
                  >
                    Cancel Order
                  </button>
                  <button
                    className="primaryButton"
                    type="submit"
                    name="intent"
                    value="reopen-order"
                    disabled={selectedOrder.status !== "cancelled" && selectedOrder.status !== "delivered"}
                  >
                    Reopen
                  </button>
                  <button
                    className="dangerButton"
                    type="submit"
                    name="intent"
                    value="delete-order"
                    onClick={(event) => {
                      if (!window.confirm(`Delete order ${orderNumber(selectedOrder)}? This cannot be undone.`)) {
                        event.preventDefault();
                      }
                    }}
                  >
                    Delete Order
                  </button>
                </div>
              </Form>
              <DriverAttachmentEditor selectedOrder={selectedOrder} />
            </>
          ) : (
            <div className="bigEmpty">
              <h2>No order selected</h2>
              <p className="muted">Choose an order from the list to edit it.</p>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const isPermissionError = isRouteErrorResponse(error) && error.status === 403;
  const message = isRouteErrorResponse(error)
    ? error.data?.message || `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : "Unable to open the Orders page.";

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Maintenance</p>
          <h1>{isPermissionError ? "No Permission" : "Orders"}</h1>
          <p className="muted">
            {isPermissionError
              ? "Your account does not have permission to do that. Ask an admin for dispatcher access if you need to edit orders."
              : "The Orders page could not finish loading."}
          </p>
        </div>
        <PermissionNav />
      </header>
      <div className="notice error">{message}</div>
      <Link className="toolbarLink" to="/">
        Back to board
      </Link>
    </main>
  );
}
