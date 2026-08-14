import { useEffect, useState } from "react";
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
  loadDispatchOperationalSettings,
  loadLoaderState,
  markLoadStarted,
  markStopEnroute,
  type DispatchOrder,
} from "../lib/dispatch.server";
import { requireDispatchUser } from "../lib/auth.server";
import { PermissionNav } from "../components/PermissionNav";
import { useDispatchVersionRevalidator } from "../components/useDispatchVersionRevalidator";
import {
  DEFAULT_TICKET_CREATOR_URL,
  buildLoaderTicketCreatorUrl,
  loaderTicketPo,
} from "../lib/ticket-creator";

export async function loader({ request }: { request: Request }) {
  await requireDispatchUser(request, "loader");
  const url = new URL(request.url);
  const requestedDate = url.searchParams.get("date");
  const [loaderState, operations] = await Promise.all([
    loadLoaderState({
      dateKey: requestedDate === "all" ? null : requestedDate || undefined,
      includeUndated: url.searchParams.get("includeUndated") !== "0",
    }),
    loadDispatchOperationalSettings().catch(() => null),
  ]);
  return data({
    ...loaderState,
    ticketCreatorUrl: process.env.LOADER_TICKET_CREATOR_URL || process.env.TICKET_CREATOR_URL || DEFAULT_TICKET_CREATOR_URL,
    operations: {
      refreshSeconds: operations?.mapRefreshSeconds || 15,
    },
  });
}

export function shouldRevalidate({ actionResult, defaultShouldRevalidate }: any) {
  if (actionResult?.skipLoaderRevalidate) return false;
  return defaultShouldRevalidate;
}

export async function action({ request }: { request: Request }) {
  await requireDispatchUser(request, "loader");
  const form = await request.formData();
  const intent = String(form.get("intent") || "loading");
  const orderId = String(form.get("orderId") || "").trim();
  const loaderNote = String(form.get("loaderNote") || "").trim();
  const loadedQuantity = String(form.get("loadedQuantity") || "").trim().replace(",", ".");

  if (!orderId) {
    return data({ ok: false, message: "Missing load." }, { status: 400 });
  }

  if (intent === "loading") {
    const updatedOrder = await markLoadStarted(orderId, loaderNote);
    return data({
      ok: true,
      intent,
      message: "Driver notified that loading has started.",
      updatedOrder,
      skipLoaderRevalidate: true,
    });
  }

  if (intent === "submit-loaded") {
    if (!loadedQuantity) {
      return data({ ok: false, message: "Enter the total loaded before submitting." }, { status: 400 });
    }
    if (!/^\d+(\.\d{1,2})?$/.test(loadedQuantity)) {
      return data({ ok: false, message: "Enter loaded quantity in 4.10 format." }, { status: 400 });
    }
    const updatedOrder = await markStopEnroute(orderId, loadedQuantity, {
      actor: "loader",
      loaderNote,
      markLoaderPrepared: true,
    });
    return data({
      ok: true,
      intent,
      message: "Loaded quantity submitted. Driver route is now enroute.",
      updatedOrder,
      skipLoaderRevalidate: true,
    });
  }

  return data({
    ok: false,
    message: "Unknown loader action.",
  }, { status: 400 });
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

const LOADER_QUANTITY_DRAFTS_KEY = "dispatchLoaderQuantityDrafts";

function readLoaderQuantityDrafts() {
  try {
    return JSON.parse(window.localStorage.getItem(LOADER_QUANTITY_DRAFTS_KEY) || "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function writeLoaderQuantityDrafts(drafts: Record<string, string>) {
  window.localStorage.setItem(LOADER_QUANTITY_DRAFTS_KEY, JSON.stringify(drafts));
}

export default function LoaderBoard() {
  const loaderData = useLoaderData<typeof loader>();
  const [loaderState, setLoaderState] = useState(loaderData);
  const [sunnyMode, setSunnyMode] = useState(false);
  const [quantityDrafts, setQuantityDrafts] = useState<Record<string, string>>({});
  const [ticketPreview, setTicketPreview] = useState<{ url: string; po: string } | null>(null);
  const { routeLoads, totalWaiting } = loaderState;
  const ticketCreatorUrl = loaderData.ticketCreatorUrl || DEFAULT_TICKET_CREATOR_URL;
  const actionData = useActionData<typeof action>() as {
    ok?: boolean;
    intent?: string;
    message?: string;
    updatedOrder?: DispatchOrder;
  } | undefined;
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  useDispatchVersionRevalidator(revalidator, { intervalMs: 6000 });
  const [showPreparedPopup, setShowPreparedPopup] = useState(false);

  useEffect(() => {
    setSunnyMode(window.localStorage.getItem("loaderColorMode") === "sunny");
    setQuantityDrafts(readLoaderQuantityDrafts());
  }, []);

  useEffect(() => {
    setLoaderState(loaderData);
  }, [loaderData]);

  useEffect(() => {
    if (actionData?.ok !== true || !actionData.updatedOrder) return;
    if (actionData.intent === "submit-loaded") setShowPreparedPopup(true);
    if (actionData.intent === "submit-loaded") {
      setQuantityDrafts((current) => {
        const next = { ...current };
        delete next[actionData.updatedOrder!.id];
        writeLoaderQuantityDrafts(next);
        return next;
      });
    }
    setLoaderState((current) => {
      const routeLoads =
        actionData.intent === "submit-loaded"
          ? current.routeLoads.filter((entry) => entry.nextLoad?.id !== actionData.updatedOrder?.id)
          : current.routeLoads.map((entry) =>
              entry.nextLoad?.id === actionData.updatedOrder?.id
                ? { ...entry, nextLoad: actionData.updatedOrder }
                : entry,
            );

      return {
        ...current,
        routeLoads,
        totalWaiting: routeLoads.length,
      };
    });

    const timer = window.setTimeout(() => {
      if (document.visibilityState === "visible") revalidator.revalidate();
    }, 250);
    return () => {
      window.clearTimeout(timer);
    };
  }, [actionData, revalidator]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") revalidator.revalidate();
    }, Math.max(30, Number(loaderData.operations?.refreshSeconds || 30)) * 1000);
    return () => window.clearInterval(interval);
  }, [loaderData.operations?.refreshSeconds, revalidator]);

  const toggleSunnyMode = () => {
    setSunnyMode((current) => {
      const next = !current;
      window.localStorage.setItem("loaderColorMode", next ? "sunny" : "dark");
      return next;
    });
  };

  const updateQuantityDraft = (orderId: string, value: string) => {
    setQuantityDrafts((current) => {
      const next = { ...current, [orderId]: value };
      if (!value.trim()) delete next[orderId];
      writeLoaderQuantityDrafts(next);
      return next;
    });
  };

  const formatQuantityDraft = (orderId: string, value: string) => {
    const normalized = value.trim().replace(",", ".");
    if (!normalized) {
      updateQuantityDraft(orderId, "");
      return;
    }

    const numeric = Number(normalized);
    if (!Number.isFinite(numeric)) return;
    updateQuantityDraft(orderId, numeric.toFixed(2));
  };

  return (
    <main className={sunnyMode ? "page loaderPage loaderSunnyMode" : "page loaderPage"}>
      <header className="topbar">
        <div>
          <p className="eyebrow">Loader Mode</p>
          <h1>Next Loads</h1>
          <p className="muted">{totalWaiting} route{totalWaiting === 1 ? "" : "s"} waiting for material prep.</p>
        </div>
        <div className="topbarActions loaderTopActions">
          <button type="button" className="loaderColorToggle" onClick={toggleSunnyMode}>
            {sunnyMode ? "Dark Mode" : "Sunny Mode"}
          </button>
          <PermissionNav />
        </div>
      </header>

      {(actionData?.message || navigation.state !== "idle") ? (
        <div className={actionData?.ok === false ? "notice error" : "notice"}>
          {navigation.state !== "idle" ? "Saving..." : actionData?.message}
        </div>
      ) : null}

      {showPreparedPopup ? (
        <div className="preparedPopup" role="dialog" aria-modal="true" aria-label="Load prepared">
          <div className="preparedPopupCard">
            <div className="middleFingerGraphic" aria-label="Middle finger">
              {"\u{1F595}"}
            </div>
            <button
              type="button"
              className="preparedPopupButton"
              onClick={() => {
                setShowPreparedPopup(false);
                revalidator.revalidate();
              }}
            >
              Back to Loader
            </button>
          </div>
        </div>
      ) : null}

      {ticketPreview ? (
        <div className="ticketPreviewOverlay" role="dialog" aria-modal="true" aria-label={`Loader ticket ${ticketPreview.po}`}>
          <div className="ticketPreviewModal">
            <div className="ticketPreviewHeader">
              <div>
                <p className="eyebrow">Loader Ticket</p>
                <h2>PO #{ticketPreview.po}</h2>
              </div>
              <button type="button" className="modalCloseButton" onClick={() => setTicketPreview(null)}>
                Close
              </button>
            </div>
            <iframe title={`Loader ticket ${ticketPreview.po}`} src={ticketPreview.url} />
          </div>
        </div>
      ) : null}

      <section className="loaderGrid">
        {routeLoads.map(({ route, nextLoad }) => {
          if (!nextLoad) return null;
          const preparedAt = checklistValue(nextLoad, "loaderPreparedAt");
          const loadingAt = checklistValue(nextLoad, "loaderLoadingAt");
          const loaderNote = checklistValue(nextLoad, "loaderNote");
          const loadedQuantity = checklistValue(nextLoad, "loaderLoadedQuantity") || checklistValue(nextLoad, "loadedQuantity");
          const quantityDraft = quantityDrafts[nextLoad.id] ?? loadedQuantity;
          const ticketUrl = buildLoaderTicketCreatorUrl(ticketCreatorUrl, nextLoad, route, loadedQuantity, { embed: true });
          const ticketPo = loaderTicketPo(nextLoad);

          return (
            <article key={`${route.id}-${nextLoad.id}`} className="panel loadCard">
              <div className="panelHeader">
                <div>
                  <p className="eyebrow">{route.code}</p>
                  <h2>{route.truck || "No truck"} · {route.driver || "No driver"}</h2>
                  <p className="muted">{route.shift || "No shift"} · {route.region || "No region"}</p>
                </div>
                <span className="statusBadge">{preparedAt ? "Enroute" : loadingAt ? "Loading" : "Next"}</span>
              </div>

              <div className="loadBody">
                <strong>{orderNumber(nextLoad)} · {nextLoad.customer || "No customer"}</strong>
                <p>{nextLoad.quantity} {nextLoad.unit} {nextLoad.material}</p>
                <span>{nextLoad.address}, {nextLoad.city}</span>
                {loadingAt ? <small>Driver message sent: loading this order now.</small> : null}
                {loadedQuantity ? <small>Total loaded: {loadedQuantity}</small> : null}
                {loaderNote ? <small>Loader note: {loaderNote}</small> : null}
                {loadingAt || loadedQuantity ? (
                  <button
                    type="button"
                    className="ticketCreatorButton loaderTicketButton"
                    onClick={() => setTicketPreview({ url: ticketUrl, po: ticketPo })}
                  >
                    View Loader Ticket · PO #{ticketPo}
                  </button>
                ) : null}
              </div>

              <Form method="post" className="loaderForm" noValidate>
                <input type="hidden" name="orderId" value={nextLoad.id} />
                <label>
                  Message to driver
                  <input name="loaderNote" placeholder="Example: loading 10 yards into truck 308" defaultValue={loaderNote} />
                </label>
                <label>
                  Total loaded
                  <input
                    className="loaderQuantityInput"
                    name="loadedQuantity"
                    type="tel"
                    placeholder="Example: 4.10"
                    value={quantityDraft}
                    onChange={(event) => updateQuantityDraft(nextLoad.id, event.currentTarget.value)}
                    onBlur={(event) => formatQuantityDraft(nextLoad.id, event.currentTarget.value)}
                    inputMode="decimal"
                    autoComplete="off"
                    enterKeyHint="done"
                  />
                </label>
                <div className="loaderActions">
                  <button type="submit" name="intent" value="loading" className="secondaryButton">
                    {loadingAt ? "Update Loading Message" : "Loading"}
                  </button>
                  <button type="submit" name="intent" value="submit-loaded" className="primaryButton">
                    Done Loading
                  </button>
                </div>
              </Form>
            </article>
          );
        })}

        {!routeLoads.length ? (
          <section className="panel bigEmpty">
            <h2>No loads waiting</h2>
            <p className="muted">When routes have active stops, the next material load will appear here.</p>
          </section>
        ) : null}
      </section>
    </main>
  );
}
