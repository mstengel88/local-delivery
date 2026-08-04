import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  data,
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  useRevalidator,
} from "react-router";
import {
  loadDriverState,
  loadDispatchOperationalSettings,
  markStopDelivered,
  markStopEnroute,
  assertDriverCanAccessOrder,
  type DispatchOrder,
} from "../lib/dispatch.server";
import { requireDispatchUser } from "../lib/auth.server";
import { PermissionNav } from "../components/PermissionNav";
import { useDispatchVersionRevalidator } from "../components/useDispatchVersionRevalidator";

export async function loader({ request }: { request: Request }) {
  const currentUser = await requireDispatchUser(request, "driver");
  const url = new URL(request.url);
  const requestedDate = url.searchParams.get("date");
  const [driverState, operations] = await Promise.all([
    loadDriverState(url.searchParams.get("route"), {
      dateKey: requestedDate === "all" ? null : requestedDate || undefined,
      includeUndated: url.searchParams.get("includeUndated") !== "0",
    }, currentUser),
    loadDispatchOperationalSettings().catch(() => null),
  ]);
  return data({
    ...driverState,
    operations: {
      refreshSeconds: operations?.mapRefreshSeconds || 15,
      driverLocationSeconds: operations?.driverLocationSeconds || 20,
    },
  });
}

export function shouldRevalidate({ actionResult, defaultShouldRevalidate }: any) {
  if (actionResult?.skipDriverRevalidate) return false;
  return defaultShouldRevalidate;
}

export async function action({ request }: { request: Request }) {
  const currentUser = await requireDispatchUser(request, "driver");
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  const orderId = String(form.get("orderId") || "").trim();

  if (!orderId) {
    return data({ ok: false, message: "Missing stop." }, { status: 400 });
  }

  if (intent === "enroute") {
    const loadedQuantity = String(form.get("loadedQuantity") || "").trim();
    if (!loadedQuantity) {
      return data({ ok: false, message: "Enter loaded quantity before marking enroute." }, { status: 400 });
    }
    try {
      await assertDriverCanAccessOrder(orderId, currentUser);
      const updatedOrder = await markStopEnroute(orderId, loadedQuantity);
      return data({
        ok: true,
        intent,
        message: "Stop marked enroute.",
        updatedOrder,
        skipDriverRevalidate: true,
      });
    } catch (error) {
      return data(
        { ok: false, message: error instanceof Error ? error.message : "Unable to mark stop enroute." },
        { status: 500 },
      );
    }
  }

  if (intent === "delivered") {
    const proofName = String(form.get("proofName") || "").trim();
    const proofNotes = String(form.get("proofNotes") || "").trim();
    const gpsLocation = String(form.get("gpsLocation") || "").trim();
    const photoUrls = String(form.get("photoUrls") || "").trim();

    if (!proofName || !gpsLocation || !photoUrls) {
      return data(
        { ok: false, message: "Proof name, GPS/location, and photo URL are required." },
        { status: 400 },
      );
    }

    try {
      await assertDriverCanAccessOrder(orderId, currentUser);
      const updatedOrder = await markStopDelivered(orderId, { proofName, proofNotes, gpsLocation, photoUrls });
      return data({
        ok: true,
        intent,
        message: updatedOrder.updatedOrders?.length > 1
          ? `Stop delivered. ${updatedOrder.updatedOrders.length} tickets from this Shopify order were completed.`
          : "Stop delivered. Next stop is ready.",
        updatedOrder,
        updatedOrders: updatedOrder.updatedOrders || [updatedOrder],
      });
    } catch (error) {
      return data(
        { ok: false, message: error instanceof Error ? error.message : "Unable to mark stop delivered." },
        { status: 500 },
      );
    }
  }

  return data({ ok: false, message: "Unknown driver action." }, { status: 400 });
}

function orderNumber(order: DispatchOrder) {
  return order.orderNumber ? `#${order.orderNumber}` : order.id;
}

function checklistValue(order: DispatchOrder, key: string) {
  try {
    const parsed = JSON.parse(order.checklistJson || "{}");
    return typeof parsed?.[key] === "string" ? parsed[key] : "";
  } catch {
    return "";
  }
}

type DriverAttachment = {
  dataUrl: string;
  name?: string;
  note?: string;
  attachedAt?: string;
};

function driverAttachmentFromChecklist(order: DispatchOrder): DriverAttachment | null {
  try {
    const parsed = JSON.parse(order.checklistJson || "{}") as { driverAttachment?: DriverAttachment };
    return typeof parsed.driverAttachment?.dataUrl === "string" ? parsed.driverAttachment : null;
  } catch {
    return null;
  }
}

type DeliveryGps = {
  value: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  capturedAt: string;
};

type TrackingPosition = {
  coords: {
    latitude: number;
    longitude: number;
    accuracy: number | null;
    heading?: number | null;
    speed?: number | null;
  };
  timestamp: number;
};

function fullAddress(order: DispatchOrder) {
  return [order.address, order.city].filter(Boolean).join(", ").trim();
}

function googleMapsAddressUrl(order: DispatchOrder) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress(order))}`;
}

function googleMapsGpsUrl(location: DeliveryGps) {
  return `https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}`;
}

function googleMapsEmbedUrl(location: DeliveryGps) {
  return `https://www.google.com/maps?q=${location.latitude},${location.longitude}&z=18&output=embed`;
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error || new Error("Unable to read photo."));
    reader.readAsDataURL(file);
  });
}

async function compressDeliveryPhoto(file: File) {
  const originalDataUrl = await readFileAsDataUrl(file);
  if (typeof document === "undefined" || !file.type.startsWith("image/")) return originalDataUrl;

  const image = new Image();
  const objectUrl = URL.createObjectURL(file);
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Unable to prepare delivery photo."));
      image.src = objectUrl;
    });

    const maxSide = 1200;
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
    const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
    const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return originalDataUrl;
    context.drawImage(image, 0, 0, width, height);
    const compressedDataUrl = canvas.toDataURL("image/jpeg", 0.72);
    return compressedDataUrl.length < originalDataUrl.length ? compressedDataUrl : originalDataUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function gpsErrorMessage(error: GeolocationPositionError) {
  if (error.code === error.PERMISSION_DENIED) {
    return "Location permission was denied. Allow location access for this site/app, then reload the driver page.";
  }
  if (error.code === error.POSITION_UNAVAILABLE) {
    return "The device could not determine its current location.";
  }
  return "GPS timed out. Keep the driver page open and make sure location services are enabled.";
}

function gpsFromPosition(position: TrackingPosition): DeliveryGps {
  const latitude = Number(position.coords.latitude.toFixed(6));
  const longitude = Number(position.coords.longitude.toFixed(6));
  const accuracy =
    Number.isFinite(position.coords.accuracy) && position.coords.accuracy !== null
      ? Math.round(position.coords.accuracy)
      : null;
  const capturedAt = new Date(position.timestamp).toISOString();
  return {
    value: `${latitude},${longitude}${accuracy ? ` accuracy ${accuracy}m` : ""}`,
    latitude,
    longitude,
    accuracy,
    capturedAt,
  };
}

async function loadNativeGeolocation() {
  try {
    const [{ Capacitor }, { Geolocation }] = await Promise.all([
      import("@capacitor/core"),
      import("@capacitor/geolocation"),
    ]);
    return Capacitor.isNativePlatform() ? Geolocation : null;
  } catch {
    return null;
  }
}

export default function DriverRoute() {
  const loaderData = useLoaderData<typeof loader>();
  const [driverState, setDriverState] = useState(loaderData);
  const { routes, selectedRoute, currentStop, remainingStops } = driverState;
  const actionData = useActionData<typeof action>() as {
    ok?: boolean;
    intent?: string;
    message?: string;
    updatedOrder?: DispatchOrder;
  } | undefined;
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  useDispatchVersionRevalidator(revalidator, { intervalMs: 6000 });
  const driverAttachment = currentStop ? driverAttachmentFromChecklist(currentStop) : null;
  const lastLocationSentAtRef = useRef(0);
  const [trackingStatus, setTrackingStatus] = useState("GPS tracking has not started yet.");
  const [deliveryGps, setDeliveryGps] = useState<DeliveryGps | null>(null);
  const [deliveryGpsStatus, setDeliveryGpsStatus] = useState("GPS proof has not been captured yet.");
  const [photoProof, setPhotoProof] = useState("");
  const [photoName, setPhotoName] = useState("");
  const [loadedQuantity, setLoadedQuantity] = useState("");
  const [proofNotes, setProofNotes] = useState("");
  const [draftStatus, setDraftStatus] = useState("");
  const isSaving = navigation.state !== "idle";

  function draftKey(orderId?: string | null) {
    return orderId ? `dispatch-driver-proof-v2:${orderId}` : "";
  }

  useEffect(() => {
    setDriverState(loaderData);
  }, [loaderData]);

  useEffect(() => {
    const key = draftKey(currentStop?.id);
    if (!currentStop || !key) {
      setPhotoProof("");
      setPhotoName("");
      setDeliveryGps(null);
      setLoadedQuantity("");
      setProofNotes("");
      setDeliveryGpsStatus("GPS proof has not been captured yet.");
      setDraftStatus("");
      return;
    }

    try {
      const savedDraft = JSON.parse(window.localStorage.getItem(key) || "{}") as {
        photoProof?: string;
        photoName?: string;
        proofNotes?: string;
        deliveryGps?: DeliveryGps | null;
      };
      setPhotoProof(savedDraft.photoProof || "");
      setPhotoName(savedDraft.photoName || "");
      setLoadedQuantity("");
      setProofNotes(savedDraft.proofNotes || "");
      setDeliveryGps(savedDraft.deliveryGps || null);
      setDeliveryGpsStatus(
        savedDraft.deliveryGps
          ? `GPS proof restored from ${new Date(savedDraft.deliveryGps.capturedAt).toLocaleTimeString()}.`
          : "GPS proof has not been captured yet.",
      );
      setDraftStatus(savedDraft.photoProof || savedDraft.deliveryGps || savedDraft.proofNotes ? "Restored saved proof draft." : "");
    } catch {
      setPhotoProof("");
      setPhotoName("");
      setLoadedQuantity("");
      setProofNotes("");
      setDeliveryGps(null);
      setDeliveryGpsStatus("GPS proof has not been captured yet.");
      setDraftStatus("");
    }
  }, [currentStop?.id]);

  useEffect(() => {
    const key = draftKey(currentStop?.id);
    if (!currentStop || !key) return;
    try {
      window.localStorage.setItem(
        key,
        JSON.stringify({
          proofNotes,
          deliveryGps,
          photoProof,
          photoName,
          savedAt: new Date().toISOString(),
        }),
      );
      if (loadedQuantity || proofNotes || deliveryGps || photoProof) {
        setDraftStatus("Proof draft saved on this device.");
      }
    } catch {
      setDraftStatus("Proof draft could not be saved on this device. If the photo is large, retake it smaller.");
    }
  }, [currentStop?.id, deliveryGps, loadedQuantity, photoName, photoProof, proofNotes]);

  useEffect(() => {
    function revalidateIfVisible() {
      if (document.visibilityState === "visible") revalidator.revalidate();
    }
    window.addEventListener("focus", revalidateIfVisible);
    window.addEventListener("pageshow", revalidateIfVisible);
    document.addEventListener("visibilitychange", revalidateIfVisible);
    return () => {
      window.removeEventListener("focus", revalidateIfVisible);
      window.removeEventListener("pageshow", revalidateIfVisible);
      document.removeEventListener("visibilitychange", revalidateIfVisible);
    };
  }, [revalidator]);

  useEffect(() => {
    if (actionData?.ok !== true || !actionData.updatedOrder) return;
    const updatedOrder = actionData.updatedOrder;

    setDriverState((current) => {
      if (!current.selectedRoute) return current;

      const deliveredIds = new Set(
        actionData.intent === "delivered"
          ? (actionData.updatedOrders || [updatedOrder]).map((order: DispatchOrder) => order.id)
          : [],
      );
      const nextRouteOrders =
        actionData.intent === "delivered"
          ? current.selectedRoute.orders.filter((order) => !deliveredIds.has(order.id))
          : current.selectedRoute.orders.map((order) =>
              order.id === updatedOrder.id ? updatedOrder : order,
            );
      const activeStops = nextRouteOrders.filter(
        (order) => order.status !== "delivered" && order.deliveryStatus !== "delivered",
      );
      const nextCurrentStop =
        activeStops.find((order) => order.deliveryStatus === "en_route") ||
        activeStops[0] ||
        null;

      return {
        ...current,
        selectedRoute: {
          ...current.selectedRoute,
          orders: nextRouteOrders,
        },
        currentStop: nextCurrentStop,
        remainingStops: activeStops.length,
      };
    });

    if (actionData.intent === "delivered") {
      try {
        window.localStorage.removeItem(draftKey(updatedOrder.id));
      } catch {
        // Local draft cleanup is best-effort.
      }
      setDraftStatus("");
    }

    const timer = window.setTimeout(() => {
      if (document.visibilityState === "visible") revalidator.revalidate();
    }, 900);
    return () => window.clearTimeout(timer);
  }, [actionData, revalidator]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") revalidator.revalidate();
    }, Math.max(30, Number(loaderData.operations?.refreshSeconds || 30)) * 1000);
    return () => window.clearInterval(interval);
  }, [loaderData.operations?.refreshSeconds, revalidator]);

  useEffect(() => {
    if (!selectedRoute?.id || typeof window === "undefined") {
      setTrackingStatus("Select a route to start live GPS tracking.");
      return;
    }
    if (!navigator.geolocation) {
      setTrackingStatus("This device/browser does not support GPS tracking.");
      return;
    }

    let cancelled = false;
    let cleanupWatch: (() => void) | null = null;
    lastLocationSentAtRef.current = 0;

    function trackingError(error: GeolocationPositionError | Error | { message?: string; code?: number }) {
      if (cancelled) return;
      if ("code" in error && typeof error.code === "number") {
        setTrackingStatus(gpsErrorMessage(error as GeolocationPositionError));
        return;
      }
      setTrackingStatus(error.message || "Unable to start live GPS tracking.");
    }

    async function sendPosition(position: TrackingPosition) {
      if (cancelled) return;
      const latestGps = gpsFromPosition(position);
      setDeliveryGps(latestGps);
      setDeliveryGpsStatus(`GPS proof ready at ${new Date(latestGps.capturedAt).toLocaleTimeString()}.`);
      const now = Date.now();
      const sendIntervalMs = Math.max(45, Number(loaderData.operations?.driverLocationSeconds || 60)) * 1000;
      if (now - lastLocationSentAtRef.current < sendIntervalMs) return;
      lastLocationSentAtRef.current = now;
      setTrackingStatus("Sending live GPS location...");

      try {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 8000);
        const response = await fetch("/api/driver-location", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            routeId: selectedRoute.id,
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            heading: position.coords.heading,
            speed: position.coords.speed,
            capturedAt: new Date(position.timestamp).toISOString(),
          }),
          signal: controller.signal,
        });
        window.clearTimeout(timeout);
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        if (!response.ok || payload?.ok === false) {
          setTrackingStatus(payload?.message || `GPS update failed (${response.status}).`);
          return;
        }
        setTrackingStatus(`Live GPS sent at ${new Date().toLocaleTimeString()}.`);
      } catch (error) {
        setTrackingStatus(error instanceof Error ? `GPS update failed: ${error.message}` : "GPS update failed.");
      }
    }

    async function startTracking() {
      setTrackingStatus("Starting full-time live GPS tracking...");
      const nativeGeolocation = await loadNativeGeolocation();

      if (nativeGeolocation) {
        try {
          const currentPermissions = await nativeGeolocation.checkPermissions().catch(() => null);
          if (currentPermissions?.location !== "granted" && currentPermissions?.coarseLocation !== "granted") {
            await nativeGeolocation.requestPermissions({ permissions: ["location"] });
          }

          const currentPosition = await nativeGeolocation.getCurrentPosition({
            enableHighAccuracy: true,
            maximumAge: 15000,
            timeout: 10000,
          });
          await sendPosition(currentPosition as TrackingPosition);

          const watchId = await nativeGeolocation.watchPosition(
            {
              enableHighAccuracy: true,
              maximumAge: 15000,
              timeout: 15000,
            },
            (position, error) => {
              if (error) {
                trackingError(new Error(error.message || "Native GPS tracking failed."));
                return;
              }
              if (position) void sendPosition(position as TrackingPosition);
            },
          );
          cleanupWatch = () => {
            void nativeGeolocation.clearWatch({ id: watchId });
          };
          return;
        } catch (error) {
          if (cancelled) return;
          setTrackingStatus(error instanceof Error ? error.message : "Native GPS tracking failed.");
          return;
        }
      }

      const watchId = navigator.geolocation.watchPosition(sendPosition, trackingError, {
        enableHighAccuracy: true,
        maximumAge: 15000,
        timeout: 15000,
      });
      cleanupWatch = () => navigator.geolocation.clearWatch(watchId);
    }

    void startTracking();

    return () => {
      cancelled = true;
      cleanupWatch?.();
    };
  }, [loaderData.operations?.driverLocationSeconds, selectedRoute?.id]);

  function captureDeliveryGps() {
    if (!navigator.geolocation) {
      setDeliveryGpsStatus("This device/browser does not support GPS capture.");
      return;
    }
    setDeliveryGpsStatus("Capturing delivery GPS...");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latestGps = gpsFromPosition(position);
        setDeliveryGps(latestGps);
        setDeliveryGpsStatus(`GPS proof ready at ${new Date(latestGps.capturedAt).toLocaleTimeString()}.`);
      },
      (error) => setDeliveryGpsStatus(gpsErrorMessage(error)),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  }

  async function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) {
      setPhotoProof("");
      setPhotoName("");
      return;
    }

    setPhotoName("Preparing photo...");
    setDraftStatus("Compressing delivery photo so it submits faster.");
    try {
      const compressedDataUrl = await compressDeliveryPhoto(file);
      setPhotoProof(compressedDataUrl);
      setPhotoName(file.name);
      setDraftStatus("Photo ready and saved on this device.");
    } catch {
      const fallbackDataUrl = await readFileAsDataUrl(file);
      setPhotoProof(fallbackDataUrl);
      setPhotoName(file.name);
      setDraftStatus("Photo ready, but it could not be compressed on this device.");
    }
  }

  return (
    <main className="page narrowPage driverPage">
      <header className="topbar driverTopbar">
        <div>
          <p className="eyebrow">Driver Mode</p>
          <h1>{selectedRoute?.truck || selectedRoute?.code || "No route selected"}</h1>
          <p className="muted">
            {selectedRoute?.driver || "No driver"} · {remainingStops} stop{remainingStops === 1 ? "" : "s"} remaining
          </p>
        </div>
        <PermissionNav />
      </header>

      {(actionData?.message || navigation.state !== "idle") ? (
        <div className={actionData?.ok === false ? "notice error" : "notice"}>
          {navigation.state !== "idle" ? "Saving..." : actionData?.message}
        </div>
      ) : null}

      {draftStatus ? (
        <div className="notice subtleNotice">
          <strong>Saved on device:</strong> {draftStatus}
        </div>
      ) : null}

      <div className="notice trackingNotice">
        <strong>Live tracking:</strong> {trackingStatus}
      </div>

      <section className="toolbar">
        <Form method="get" className="routeSelector">
          <select name="route" defaultValue={selectedRoute?.id || ""}>
            {routes.map((route) => (
              <option key={route.id} value={route.id}>
                {route.code} · {route.truck || "No truck"} · {route.driver || "No driver"}
              </option>
            ))}
          </select>
          <button type="submit">Open Route</button>
        </Form>
      </section>

      {!selectedRoute ? (
        <section className="panel bigEmpty">
          <h2>No active route</h2>
          <p className="muted">Assign an order to a route on the board first.</p>
        </section>
      ) : null}

      {selectedRoute && !currentStop ? (
        <section className="panel bigEmpty">
          <h2>Route complete</h2>
          <p className="muted">No more active stops are waiting on this route.</p>
        </section>
      ) : null}

      {currentStop ? (
        <section className="panel driverStop">
          <div className="panelHeader">
            <div>
              <p className="eyebrow">Current Stop</p>
              <h2>{orderNumber(currentStop)} · {currentStop.customer || "No customer"}</h2>
              {currentStop.deliveryStatus === "en_route" ? (
                <address className="driverAddress">{fullAddress(currentStop) || "No address"}</address>
              ) : null}
            </div>
            <span className="statusBadge">{currentStop.deliveryStatus === "en_route" ? "Enroute" : "Dispatched"}</span>
          </div>

          <div className="detailGrid">
            <div>
              <span>Material</span>
              <strong>{currentStop.loadLabel || `${currentStop.quantity} ${currentStop.unit} ${currentStop.material}`}</strong>
            </div>
            <div>
              <span>Phone / Email</span>
              <strong>{currentStop.contact || "Not provided"}</strong>
            </div>
            <div>
              <span>Requested</span>
              <strong>{currentStop.requestedWindow || "No date"}</strong>
            </div>
            <div>
              <span>ETA</span>
              <strong>{currentStop.eta || "Not set"}</strong>
            </div>
            {currentStop.deliveryStatus === "en_route" ? (
              <div className="driverAddressTile">
                <span>Delivery Address</span>
                <strong>{fullAddress(currentStop) || "No address"}</strong>
              </div>
            ) : null}
            {currentStop.proofNotes ? (
              <div className="driverNotesTile">
                <span>Order Notes</span>
                <strong>{currentStop.proofNotes}</strong>
              </div>
            ) : null}
          </div>

          {driverAttachment ? (
            <section className="driverAttachmentCard">
              <div>
                <p className="eyebrow">Dispatch Photo</p>
                <h3>{driverAttachment.name || "Order photo"}</h3>
                {driverAttachment.note ? <p>{driverAttachment.note}</p> : null}
              </div>
              <img src={driverAttachment.dataUrl} alt={driverAttachment.name || "Driver-visible order attachment"} />
            </section>
          ) : null}

          {currentStop.deliveryStatus !== "en_route" ? (
            <Form method="post" className="fieldCard">
              <input type="hidden" name="intent" value="enroute" />
              <input type="hidden" name="orderId" value={currentStop.id} />
              <label>
                Quantity loaded
                <input
                  name="loadedQuantity"
                  value={loadedQuantity}
                  onChange={(event) => setLoadedQuantity(event.currentTarget.value)}
                  placeholder={`Example: ${currentStop.quantity}`}
                  autoComplete="off"
                  required
                />
              </label>
              <button type="submit" className="primaryButton" disabled={isSaving || !loadedQuantity.trim()}>
                {isSaving ? "Saving..." : "Mark Enroute"}
              </button>
            </Form>
          ) : (
            <Form method="post" className="fieldCard">
              <input type="hidden" name="intent" value="delivered" />
              <input type="hidden" name="orderId" value={currentStop.id} />
              <input type="hidden" name="proofName" value={selectedRoute.driver || "Driver"} />
              <input type="hidden" name="gpsLocation" value={deliveryGps?.value || ""} />
              <input type="hidden" name="photoUrls" value={photoProof} />
              <div className="proofSummary">
                <span>Proof Driver</span>
                <strong>{selectedRoute.driver || "Driver"}</strong>
              </div>
              <div className="proofTools">
                <button type="button" className="primaryButton" onClick={captureDeliveryGps}>
                  Capture GPS
                </button>
                <label className="cameraButton">
                  Take Picture
                  <input type="file" accept="image/*" capture="environment" onChange={handlePhotoChange} />
                </label>
              </div>
              <div className="gpsProofCard">
                <div>
                  <span>GPS Verification</span>
                  <strong>{deliveryGps ? deliveryGps.value : deliveryGpsStatus}</strong>
                </div>
                {deliveryGps ? (
                  <>
                    <iframe
                      title="Delivery GPS verification map"
                      src={googleMapsEmbedUrl(deliveryGps)}
                      loading="lazy"
                      referrerPolicy="no-referrer-when-downgrade"
                    />
                    <a href={googleMapsGpsUrl(deliveryGps)} target="_blank" rel="noreferrer">
                      Open GPS Pin
                    </a>
                  </>
                ) : null}
              </div>
              {photoProof ? (
                <figure className="photoProofPreview">
                  <img src={photoProof} alt="Delivery proof preview" />
                  <figcaption>{photoName || "Delivery photo ready"}</figcaption>
                </figure>
              ) : (
                <div className="empty">Take a delivery photo before marking this stop delivered.</div>
              )}
              <label>
                Delivery notes
                <textarea
                  name="proofNotes"
                  placeholder="Optional driver notes"
                  rows={4}
                  value={proofNotes}
                  onChange={(event) => setProofNotes(event.currentTarget.value)}
                />
              </label>
              <button type="submit" className="successButton" disabled={isSaving || !deliveryGps || !photoProof}>
                {isSaving ? "Submitting..." : "Mark Delivered"}
              </button>
            </Form>
          )}
        </section>
      ) : null}

      {currentStop?.deliveryStatus === "en_route" ? (
        <div className="driverBottomBar">
          <a href={googleMapsAddressUrl(currentStop)} target="_blank" rel="noreferrer">
            Open Address In Google Maps
          </a>
        </div>
      ) : null}
    </main>
  );
}
