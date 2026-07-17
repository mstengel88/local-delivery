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
  markLoadPrepared,
  type DispatchOrder,
} from "../lib/dispatch.server";
import { requireDispatchUser } from "../lib/auth.server";
import { PermissionNav } from "../components/PermissionNav";

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
  const orderId = String(form.get("orderId") || "").trim();
  const loaderNote = String(form.get("loaderNote") || "").trim();

  if (!orderId) {
    return data({ ok: false, message: "Missing load." }, { status: 400 });
  }

  const updatedOrder = await markLoadPrepared(orderId, loaderNote);
  return data({
    ok: true,
    message: "Load marked prepared.",
    updatedOrder,
    skipLoaderRevalidate: true,
  });
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

export default function LoaderBoard() {
  const loaderData = useLoaderData<typeof loader>();
  const [loaderState, setLoaderState] = useState(loaderData);
  const { routeLoads, totalWaiting } = loaderState;
  const actionData = useActionData<typeof action>() as {
    ok?: boolean;
    message?: string;
    updatedOrder?: DispatchOrder;
  } | undefined;
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const [showPreparedPopup, setShowPreparedPopup] = useState(false);

  useEffect(() => {
    setLoaderState(loaderData);
  }, [loaderData]);

  useEffect(() => {
    if (actionData?.ok !== true || !actionData.updatedOrder) return;
    setShowPreparedPopup(true);
    setLoaderState((current) => {
      const routeLoads = current.routeLoads.filter(
        (entry) => entry.nextLoad?.id !== actionData.updatedOrder?.id,
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

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Loader Mode</p>
          <h1>Next Loads</h1>
          <p className="muted">{totalWaiting} route{totalWaiting === 1 ? "" : "s"} waiting for material prep.</p>
        </div>
        <PermissionNav />
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

      <section className="loaderGrid">
        {routeLoads.map(({ route, nextLoad }) => {
          if (!nextLoad) return null;
          const preparedAt = checklistValue(nextLoad, "loaderPreparedAt");
          const loaderNote = checklistValue(nextLoad, "loaderNote");

          return (
            <article key={`${route.id}-${nextLoad.id}`} className="panel loadCard">
              <div className="panelHeader">
                <div>
                  <p className="eyebrow">{route.code}</p>
                  <h2>{route.truck || "No truck"} · {route.driver || "No driver"}</h2>
                  <p className="muted">{route.shift || "No shift"} · {route.region || "No region"}</p>
                </div>
                <span className="statusBadge">{preparedAt ? "Prepared" : "Next"}</span>
              </div>

              <div className="loadBody">
                <strong>{orderNumber(nextLoad)} · {nextLoad.customer || "No customer"}</strong>
                <p>{nextLoad.quantity} {nextLoad.unit} {nextLoad.material}</p>
                <span>{nextLoad.address}, {nextLoad.city}</span>
                {loaderNote ? <small>Loader note: {loaderNote}</small> : null}
              </div>

              <Form method="post" className="loaderForm">
                <input type="hidden" name="orderId" value={nextLoad.id} />
                <label>
                  Loader note
                  <input name="loaderNote" placeholder="Example: staged by bay 2" defaultValue={loaderNote} />
                </label>
                <button type="submit" className="primaryButton">
                  {preparedAt ? "Update Load Note" : "Mark Load Prepared"}
                </button>
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
