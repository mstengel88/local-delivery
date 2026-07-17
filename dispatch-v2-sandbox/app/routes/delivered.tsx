import { useEffect, useMemo, useState } from "react";
import {
  data,
  Form,
  isRouteErrorResponse,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  useRouteError,
} from "react-router";
import { PermissionNav } from "../components/PermissionNav";
import { requireDispatchEditor, requireDispatchUser } from "../lib/auth.server";
import {
  addDeliveredOrderPhoto,
  createDispatchOrder,
  deleteDispatchOrder,
  loadDeliveredOrderDetail,
  loadDeliveredOrders,
  markDeliveredOrderUndelivered,
  markStopDelivered,
  resendDeliveryConfirmation,
  type DispatchOrder,
} from "../lib/dispatch.server";

export async function loader({ request }: { request: Request }) {
  await requireDispatchUser(request, "orders");
  const started = performance.now();
  const url = new URL(request.url);
  const selectedOrderId = url.searchParams.get("order");
  const orders = await loadDeliveredOrders(300);
  let selectedOrder =
    orders.find((order) => order.id === selectedOrderId) ||
    orders[0] ||
    null;

  if (selectedOrder?.id) {
    selectedOrder = await loadDeliveredOrderDetail(selectedOrder.id) || selectedOrder;
  }

  return data({
    orders,
    selectedOrder,
    manualNotice: url.searchParams.get("created") === "manual"
      ? "Manual delivered ticket created. Delivery email is being sent in the background."
      : "",
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

  if (intent === "create-manual-delivered") {
    const contact = String(form.get("contact") || "").trim();
    const customer = String(form.get("customer") || "").trim();
    const address = String(form.get("address") || "").trim();
    const city = String(form.get("city") || "").trim();
    const material = String(form.get("material") || "").trim();
    const quantity = String(form.get("quantity") || "").trim();
    const unit = String(form.get("unit") || "").trim();
    const gpsLocation = String(form.get("gpsLocation") || "").trim();
    const photoUrls = String(form.get("photoUrls") || "").trim();
    const proofName = String(form.get("proofName") || "").trim() || "Dispatcher";

    if (!customer || !contact || !address || !city || !material || !quantity || !unit) {
      return data({ ok: false, message: "Customer, contact/email, address, city, material, quantity, and unit are required." }, { status: 400 });
    }
    if (!/\S+@\S+\.\S+/.test(contact)) {
      return data({ ok: false, message: "Add the customer's email address in Contact so the delivery confirmation can be sent." }, { status: 400 });
    }
    if (!gpsLocation || !photoUrls) {
      return data({ ok: false, message: "GPS/location and a delivery photo are required for a manual delivered ticket." }, { status: 400 });
    }

    try {
      const createdOrder = await createDispatchOrder({
        orderNumber: String(form.get("orderNumber") || "").trim(),
        customer,
        contact,
        address,
        city,
        material,
        quantity,
        unit,
        requestedWindow: String(form.get("requestedWindow") || "").trim(),
        timePreference: String(form.get("timePreference") || "").trim() || "Anytime",
        notes: String(form.get("proofNotes") || "").trim(),
      });
      const deliveredOrder = await markStopDelivered(createdOrder.id, {
        proofName,
        proofNotes: String(form.get("proofNotes") || "").trim(),
        gpsLocation,
        photoUrls,
      });
      return redirect(`/delivered?order=${encodeURIComponent(deliveredOrder.id)}&created=manual`);
    } catch (error) {
      return data(
        { ok: false, message: error instanceof Error ? error.message : "Unable to create manual delivered ticket." },
        { status: 500 },
      );
    }
  }

  if (!orderId) {
    return data({ ok: false, message: "Missing delivered order." }, { status: 400 });
  }

  if (intent === "resend-email") {
    try {
      const result = await resendDeliveryConfirmation(orderId);
      return data({ ok: result.sent, message: result.sent ? "Delivery confirmation email resent." : result.message });
    } catch (error) {
      return data(
        {
          ok: false,
          message: error instanceof Error ? error.message : "Unable to resend delivery email.",
        },
        { status: 500 },
      );
    }
  }

  if (intent === "add-delivered-photo") {
    const photoData = String(form.get("photoData") || "").trim();
    const photoName = String(form.get("photoName") || "").trim();

    try {
      const order = await addDeliveredOrderPhoto(orderId, { dataUrl: photoData, name: photoName });
      return data({
        ok: true,
        intent,
        orderId: order.id,
        message: `Manual delivery photo added to ${order.orderNumber}.`,
      });
    } catch (error) {
      return data(
        { ok: false, intent, message: error instanceof Error ? error.message : "Unable to add delivery photo." },
        { status: 500 },
      );
    }
  }

  if (intent === "mark-undelivered") {
    const order = await markDeliveredOrderUndelivered(orderId);
    return data({
      ok: true,
      message: order.assignedRouteId
        ? `${order.orderNumber} marked undelivered and returned to its route.`
        : `${order.orderNumber} marked undelivered and returned to the queue.`,
    });
  }

  if (intent === "delete-order") {
    const order = await deleteDispatchOrder(orderId);
    return data({ ok: true, message: `${order.orderNumber} deleted.` });
  }

  return data({ ok: false, message: "Unknown delivered order action." }, { status: 400 });
}

function orderNumber(order: DispatchOrder) {
  return order.orderNumber ? `#${order.orderNumber}` : order.id;
}

function fullAddress(order: DispatchOrder) {
  return [order.address, order.city].filter(Boolean).join(", ").trim();
}

function searchText(order: DispatchOrder) {
  return [
    order.id,
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
    order.proofName,
    order.deliveredAt,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function gpsFromProof(value?: string | null) {
  const match = String(value || "").match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  return {
    latitude: match[1],
    longitude: match[2],
    label: `${match[1]}, ${match[2]}`,
    mapUrl: `https://www.google.com/maps/search/?api=1&query=${match[1]},${match[2]}`,
    embedUrl: `https://www.google.com/maps?q=${match[1]},${match[2]}&z=18&output=embed`,
  };
}

function photoProofs(value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return [];
  if (raw.startsWith("data:image/")) return [raw];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((entry) => String(entry || "").trim()).filter(Boolean);
    }
  } catch {
    // Non-JSON proof strings are handled below.
  }

  if (/^https?:\/\//i.test(raw)) return [raw];
  return raw
    .split(/\n+/)
    .map((entry) => entry.trim())
    .filter((entry) => /^https?:\/\//i.test(entry) || entry.startsWith("data:image/"));
}

function deliveredAtLabel(order: DispatchOrder) {
  if (!order.deliveredAt) return "No delivered time";
  return new Date(order.deliveredAt).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function travelLabel(order: DispatchOrder) {
  if (!order.travelMinutes && !order.travelMiles) return "Not calculated";
  return [
    order.travelMinutes ? `${order.travelMinutes} min RT` : "",
    order.travelMiles ? `${order.travelMiles} mi` : "",
  ].filter(Boolean).join(" · ");
}

export default function DeliveredPage() {
  const { orders, selectedOrder, manualNotice, loadedAt, loadMs } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as { ok?: boolean; message?: string; orderId?: string } | undefined;
  const navigation = useNavigation();
  const [search, setSearch] = useState("");
  const [manualPhoto, setManualPhoto] = useState("");
  const [manualGps, setManualGps] = useState("");
  const [manualCaptureStatus, setManualCaptureStatus] = useState("");
  const [deliveredPhoto, setDeliveredPhoto] = useState("");
  const [deliveredPhotoName, setDeliveredPhotoName] = useState("");
  const [deliveredPhotoStatus, setDeliveredPhotoStatus] = useState("");
  const normalizedSearch = search.trim().toLowerCase();
  const visibleOrders = useMemo(
    () =>
      normalizedSearch
        ? orders.filter((order) => searchText(order).includes(normalizedSearch))
        : orders,
    [orders, normalizedSearch],
  );
  const gps = gpsFromProof(selectedOrder?.signatureData);
  const photos = photoProofs(selectedOrder?.photoUrls);

  useEffect(() => {
    setDeliveredPhoto("");
    setDeliveredPhotoName("");
    setDeliveredPhotoStatus("");
  }, [selectedOrder?.id]);

  useEffect(() => {
    if (actionData?.ok && actionData.intent === "add-delivered-photo") {
      setDeliveredPhoto("");
      setDeliveredPhotoName("");
      setDeliveredPhotoStatus("Photo saved to this delivered order.");
    }
  }, [actionData]);

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Proof Archive</p>
          <h1>Delivered</h1>
          <p className="muted">Completed loads with delivery proof, GPS, photos, and resend controls.</p>
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

      {(actionData?.message || manualNotice || navigation.state !== "idle") ? (
        <div className={actionData?.ok === false ? "notice error" : "notice"}>
          {navigation.state !== "idle" ? "Updating delivered order..." : actionData?.message || manualNotice}
        </div>
      ) : null}

      <section className="toolbar">
        <input
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
          placeholder="Search delivered loads by customer, address, material, date, proof..."
        />
        <Form method="get">
          <button type="submit">Refresh</button>
        </Form>
      </section>

      <section className="panel manualDeliveredPanel">
        <div className="panelHeader">
          <div>
            <p className="eyebrow">Manual Proof</p>
            <h2>Create Manual Delivered Ticket</h2>
            <p className="muted">Use this for a completed delivery that was not submitted from the driver page.</p>
          </div>
        </div>
        <Form method="post" className="manualDeliveredForm">
          <input type="hidden" name="intent" value="create-manual-delivered" />
          <input type="hidden" name="photoUrls" value={manualPhoto} />
          <div className="formGrid three">
            <label>
              Order Number
              <input name="orderNumber" placeholder="Optional" />
            </label>
            <label>
              Customer
              <input name="customer" required placeholder="Customer name" />
            </label>
            <label>
              Contact / Email
              <input name="contact" required placeholder="phone / email@example.com" />
            </label>
          </div>
          <div className="formGrid two">
            <label>
              Address
              <input name="address" required placeholder="Street address" />
            </label>
            <label>
              City
              <input name="city" required placeholder="City, ST ZIP" />
            </label>
          </div>
          <div className="formGrid three">
            <label>
              Material
              <input name="material" required placeholder="Material delivered" />
            </label>
            <label>
              Quantity
              <input name="quantity" required inputMode="decimal" placeholder="Qty" />
            </label>
            <label>
              Unit
              <select name="unit" required defaultValue="Yard">
                <option>Yard</option>
                <option>Ton</option>
                <option>Bag</option>
                <option>Gallon</option>
                <option>Unit</option>
              </select>
            </label>
          </div>
          <div className="formGrid three">
            <label>
              Requested Date
              <input name="requestedWindow" type="date" />
            </label>
            <label>
              Time Preference
              <select name="timePreference" defaultValue="Anytime">
                <option>Anytime</option>
                <option>Morning</option>
                <option>Afternoon</option>
                <option>Evening</option>
              </select>
            </label>
            <label>
              Proof Name
              <input name="proofName" placeholder="Dispatcher or driver name" />
            </label>
          </div>
          <div className="formGrid two">
            <label>
              GPS / Location
              <input
                name="gpsLocation"
                required
                value={manualGps}
                onChange={(event) => setManualGps(event.currentTarget.value)}
                placeholder="43.12345, -88.12345"
              />
            </label>
            <label>
              Delivery Photo
              <input
                type="file"
                accept="image/*"
                required={!manualPhoto}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (!file) {
                    setManualPhoto("");
                    return;
                  }
                  const reader = new FileReader();
                  reader.onload = () => setManualPhoto(String(reader.result || ""));
                  reader.onerror = () => setManualCaptureStatus("Unable to read that photo. Try another image.");
                  reader.readAsDataURL(file);
                }}
              />
            </label>
          </div>
          <label>
            Delivery Notes
            <textarea name="proofNotes" rows={3} placeholder="Where it was dropped, condition notes, or customer instructions." />
          </label>
          <div className="manualProofPreview">
            <button
              type="button"
              className="toolbarLink"
              onClick={() => {
                if (!navigator.geolocation) {
                  setManualCaptureStatus("This device/browser does not support GPS capture.");
                  return;
                }
                setManualCaptureStatus("Capturing GPS location...");
                navigator.geolocation.getCurrentPosition(
                  (position) => {
                    const value = `${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)}`;
                    setManualGps(value);
                    setManualCaptureStatus(`GPS ready: ${value}`);
                  },
                  (error) => setManualCaptureStatus(error.message || "Unable to capture GPS location."),
                  { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
                );
              }}
            >
              Use Current GPS
            </button>
            {manualPhoto ? <img src={manualPhoto} alt="Manual delivery proof preview" /> : <span>No photo selected yet.</span>}
            {manualCaptureStatus ? <small>{manualCaptureStatus}</small> : null}
          </div>
          <button type="submit" className="successButton" disabled={navigation.state !== "idle"}>
            {navigation.state !== "idle" ? "Creating Ticket..." : "Create Delivered Ticket & Send Email"}
          </button>
        </Form>
      </section>

      <section className="deliveredSplit">
        <aside className="panel deliveredListPanel">
          <div className="panelHeader">
            <div>
              <p className="eyebrow">Completed Loads</p>
              <h2>{visibleOrders.length} of {orders.length} delivered</h2>
            </div>
          </div>

          <div className="deliveredList">
            {visibleOrders.map((order) => (
              <Link
                key={order.id}
                className={`deliveredListCard ${selectedOrder?.id === order.id ? "selectedOrder" : ""}`}
                to={`/delivered?order=${encodeURIComponent(order.id)}`}
              >
                <div>
                  <strong>{order.customer || "No customer"}</strong>
                  <span>{fullAddress(order) || "No address"}</span>
                </div>
                <small>{orderNumber(order)} · {order.quantity} {order.unit} · {order.material}</small>
                <small>{deliveredAtLabel(order)}</small>
              </Link>
            ))}
            {!visibleOrders.length ? (
              <div className="empty">
                {orders.length ? "No delivered orders matched that search." : "No delivered orders yet."}
              </div>
            ) : null}
          </div>
        </aside>

        <section className="panel deliveredDetailPanel">
          {selectedOrder ? (
            <>
              <div className="panelHeader">
                <div>
                  <p className="eyebrow">{orderNumber(selectedOrder)}</p>
                  <h2>{selectedOrder.customer || "No customer"}</h2>
                  <p className="muted">{selectedOrder.contact || "No contact"}</p>
                </div>
                <span className="statusBadge">Delivered</span>
              </div>

              <div className="deliveredActionRow">
                <Form
                  method="post"
                  onSubmit={(event) => {
                    if (!window.confirm("Resend the delivery confirmation email for this order?")) {
                      event.preventDefault();
                    }
                  }}
                >
                  <input type="hidden" name="orderId" value={selectedOrder.id} />
                  <button type="submit" name="intent" value="resend-email" className="primaryButton">
                    Resend Delivery Email
                  </button>
                </Form>
                <Form
                  method="post"
                  onSubmit={(event) => {
                    if (!deliveredPhoto) {
                      event.preventDefault();
                      setDeliveredPhotoStatus("Choose a photo before saving it to this delivered order.");
                    }
                  }}
                >
                  <input type="hidden" name="orderId" value={selectedOrder.id} />
                  <input type="hidden" name="photoData" value={deliveredPhoto} />
                  <input type="hidden" name="photoName" value={deliveredPhotoName} />
                  <button type="submit" name="intent" value="add-delivered-photo" className="secondaryButton">
                    Save Manual Photo
                  </button>
                </Form>
                <Form
                  method="post"
                  onSubmit={(event) => {
                    if (!window.confirm("Mark this delivered load as undelivered? It will move back to its route or queue.")) {
                      event.preventDefault();
                    }
                  }}
                >
                  <input type="hidden" name="orderId" value={selectedOrder.id} />
                  <button type="submit" name="intent" value="mark-undelivered" className="warningButton">
                    Mark Undelivered
                  </button>
                </Form>
                <Form
                  method="post"
                  onSubmit={(event) => {
                    if (!window.confirm("Delete this delivered order? This cannot be undone.")) {
                      event.preventDefault();
                    }
                  }}
                >
                  <input type="hidden" name="orderId" value={selectedOrder.id} />
                  <button type="submit" name="intent" value="delete-order" className="dangerButton">
                    Delete
                  </button>
                </Form>
              </div>

              <div className="detailGrid">
                <div className="driverAddressTile">
                  <span>Address</span>
                  <strong>{fullAddress(selectedOrder) || "No address"}</strong>
                </div>
                <div>
                  <span>Load</span>
                  <strong>{selectedOrder.quantity} {selectedOrder.unit} {selectedOrder.material}</strong>
                </div>
                <div>
                  <span>Requested</span>
                  <strong>{selectedOrder.requestedWindow || "No date"}</strong>
                </div>
                <div>
                  <span>Time Preference</span>
                  <strong>{selectedOrder.timePreference || "Anytime"}</strong>
                </div>
                <div>
                  <span>Travel Time</span>
                  <strong>{travelLabel(selectedOrder)}</strong>
                </div>
                <div>
                  <span>Delivered</span>
                  <strong>{deliveredAtLabel(selectedOrder)}</strong>
                </div>
                <div>
                  <span>Proof Name</span>
                  <strong>{selectedOrder.proofName || "Not captured"}</strong>
                </div>
                <div>
                  <span>Route Stop</span>
                  <strong>{selectedOrder.stopSequence ? `Stop ${selectedOrder.stopSequence}` : "Not set"}</strong>
                </div>
              </div>

              {selectedOrder.proofNotes ? (
                <div className="proofNoteBlock">
                  <span>Proof Notes</span>
                  <p>{selectedOrder.proofNotes}</p>
                </div>
              ) : null}

              <div className="proofMediaGrid">
                <div className="proofMediaPanel">
                  <div className="proofMediaHeader">
                    <span>Photo Proof</span>
                    <strong>{photos.length ? `${photos.length} photo${photos.length === 1 ? "" : "s"}` : "Missing"}</strong>
                  </div>
                  <div className="deliveredPhotoAdd">
                    <label>
                      Add Manual Photo
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(event) => {
                          const file = event.currentTarget.files?.[0];
                          if (!file) {
                            setDeliveredPhoto("");
                            setDeliveredPhotoName("");
                            setDeliveredPhotoStatus("");
                            return;
                          }
                          setDeliveredPhotoName(file.name);
                          setDeliveredPhotoStatus("Preparing photo...");
                          const reader = new FileReader();
                          reader.onload = () => {
                            setDeliveredPhoto(String(reader.result || ""));
                            setDeliveredPhotoStatus(`${file.name} ready to save.`);
                          };
                          reader.onerror = () => {
                            setDeliveredPhoto("");
                            setDeliveredPhotoStatus("Unable to read that photo. Try another image.");
                          };
                          reader.readAsDataURL(file);
                        }}
                      />
                    </label>
                    {deliveredPhoto ? (
                      <figure>
                        <img src={deliveredPhoto} alt="Manual delivered proof preview" />
                        <figcaption>{deliveredPhotoName || "Manual photo ready"}</figcaption>
                      </figure>
                    ) : null}
                    {deliveredPhotoStatus ? <small>{deliveredPhotoStatus}</small> : null}
                  </div>
                  {photos.length ? (
                    <div className="deliveredPhotos">
                      {photos.map((photo, index) => (
                        <a href={photo} target="_blank" rel="noreferrer" key={`${selectedOrder.id}-photo-${index}`}>
                          <img src={photo} alt={`Delivery proof for ${selectedOrder.orderNumber}`} />
                        </a>
                      ))}
                    </div>
                  ) : (
                    <div className="empty">No photo proof captured.</div>
                  )}
                </div>

                <div className="proofMediaPanel">
                  <div className="proofMediaHeader">
                    <span>GPS Proof</span>
                    <strong>{gps ? gps.label : "Missing"}</strong>
                  </div>
                  {gps ? (
                    <>
                      <iframe
                        title={`GPS proof for ${selectedOrder.orderNumber}`}
                        src={gps.embedUrl}
                        loading="lazy"
                        referrerPolicy="no-referrer-when-downgrade"
                      />
                      <a href={gps.mapUrl} target="_blank" rel="noreferrer">
                        Open GPS Pin
                      </a>
                    </>
                  ) : (
                    <div className="empty">No GPS proof captured.</div>
                  )}
                </div>
              </div>

              <div className="deliveredFooterLinks">
                <Link className="toolbarLink" to={`/orders?order=${encodeURIComponent(selectedOrder.id)}`}>
                  Open in Orders
                </Link>
                <Link className="toolbarLink" to="/">
                  Back to Board
                </Link>
              </div>
            </>
          ) : (
            <div className="bigEmpty">
              <h2>No delivered order selected</h2>
              <p className="muted">Delivered stops will show here after drivers complete them.</p>
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
      : "Unable to open delivered orders.";

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Proof Archive</p>
          <h1>{isPermissionError ? "No Permission" : "Delivered"}</h1>
          <p className="muted">
            {isPermissionError
              ? "Your account does not have permission to do that. Ask an admin for dispatcher access if you need to edit delivered loads."
              : "The delivered page could not finish loading."}
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
