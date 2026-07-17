import { useMemo, useState } from "react";
import {
  data,
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import {
  createDispatchTruck,
  deleteDispatchTruck,
  loadDispatchTrucks,
  updateDispatchTruck,
  type DispatchTruck,
} from "../lib/dispatch.server";
import { requireDispatchEditor, requireDispatchUser } from "../lib/auth.server";
import { PermissionNav } from "../components/PermissionNav";

export async function loader({ request }: { request: Request }) {
  await requireDispatchUser(request, "routes");
  const started = performance.now();
  const url = new URL(request.url);
  const selectedTruckId = url.searchParams.get("truck");
  const trucks = await loadDispatchTrucks(500);
  const selectedTruck =
    trucks.find((truck) => truck.id === selectedTruckId) ||
    trucks.find((truck) => truck.isActive) ||
    trucks[0] ||
    null;

  return data({
    trucks,
    selectedTruck,
    loadedAt: new Date().toISOString(),
    loadMs: Math.round(performance.now() - started),
  });
}

export async function action({ request }: { request: Request }) {
  await requireDispatchUser(request, "routes");
  await requireDispatchEditor(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  const truckId = String(form.get("truckId") || "").trim();
  const truckNumber = String(form.get("truckNumber") || "").trim();
  const input = {
    truckNumber,
    name: String(form.get("name") || ""),
    tons: String(form.get("tons") || ""),
    yards: String(form.get("yards") || ""),
    isActive: String(form.get("isActive") || "true") === "true",
    notes: String(form.get("notes") || ""),
  };

  try {
    if (intent === "create-truck") {
      const truck = await createDispatchTruck(input);
      return redirect(`/trucks?truck=${encodeURIComponent(truck.id)}`);
    }

    if (intent === "update-truck") {
      if (!truckId) return data({ ok: false, message: "Missing truck." }, { status: 400 });
      const truck = await updateDispatchTruck(truckId, input);
      return data({ ok: true, message: `Saved truck ${truck.truckNumber}.`, truck });
    }

    if (intent === "delete-truck") {
      if (!truckId) return data({ ok: false, message: "Missing truck." }, { status: 400 });
      const truck = await deleteDispatchTruck(truckId);
      return redirect(`/trucks?deleted=${encodeURIComponent(truck.truckNumber)}`);
    }

    return data({ ok: false, message: "Unknown truck action." }, { status: 400 });
  } catch (error) {
    return data(
      { ok: false, message: error instanceof Error ? error.message : "Unable to save truck." },
      { status: 500 },
    );
  }
}

function truckSearchText(truck: DispatchTruck) {
  return [
    truck.truckNumber,
    truck.name,
    truck.tons ? `${truck.tons} tons` : "",
    truck.yards ? `${truck.yards} yards` : "",
    truck.isActive ? "active" : "inactive",
    truck.notes,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function formatCapacity(value: number, unit: string) {
  const label = Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
  return `${label} ${unit}`;
}

export default function TrucksPage() {
  const { trucks, selectedTruck, loadedAt, loadMs } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as { ok?: boolean; message?: string } | undefined;
  const navigation = useNavigation();
  const [search, setSearch] = useState("");
  const normalizedSearch = search.trim().toLowerCase();
  const visibleTrucks = useMemo(
    () => trucks.filter((truck) => !normalizedSearch || truckSearchText(truck).includes(normalizedSearch)),
    [trucks, normalizedSearch],
  );

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Fleet</p>
          <h1>Truck Fleet</h1>
          <p className="muted">
            Manage truck numbers and capacities. These tons/yards limits are enforced when orders are assigned to routes.
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
          {navigation.state !== "idle" ? "Saving truck..." : actionData?.message}
        </div>
      ) : null}

      <section className="toolbar">
        <input
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
          placeholder="Search truck number, name, tons, yards, status, notes..."
        />
      </section>

      <section className="ordersLayout">
        <aside className="panel orderBrowser">
          <div className="panelHeader">
            <div>
              <p className="eyebrow">Fleet</p>
              <h2>{visibleTrucks.length} trucks</h2>
            </div>
          </div>
          <div className="orderList">
            {visibleTrucks.map((truck) => (
              <Link
                key={truck.id}
                className={`orderCard orderLink ${selectedTruck?.id === truck.id ? "selectedOrder" : ""}`}
                to={`/trucks?truck=${encodeURIComponent(truck.id)}`}
              >
                <strong>{truck.truckNumber}</strong>
                <span>{truck.name || "No display name"}</span>
                <div className="routeTimingLine">
                  <strong>{formatCapacity(truck.tons, "tons")}</strong>
                  <span>{formatCapacity(truck.yards, "yards")}</span>
                </div>
                <small>{truck.isActive ? "Active" : "Inactive"}</small>
              </Link>
            ))}
            {!visibleTrucks.length ? <div className="empty">No matching trucks.</div> : null}
          </div>
        </aside>

        <section className="panel orderEditorPanel">
          {selectedTruck ? (
            <Form key={selectedTruck.id} method="post" className="orderEditor">
              <input type="hidden" name="truckId" value={selectedTruck.id} />
              <div className="panelHeader">
                <div>
                  <p className="eyebrow">Edit Selected Truck</p>
                  <h2>{selectedTruck.truckNumber}</h2>
                </div>
                <span className="statusBadge">{selectedTruck.isActive ? "Active" : "Inactive"}</span>
              </div>
              <div className="createFields orderEditFields">
                <label>
                  Truck Number
                  <input name="truckNumber" defaultValue={selectedTruck.truckNumber} required />
                </label>
                <label>
                  Display Name
                  <input name="name" defaultValue={selectedTruck.name} placeholder="Optional" />
                </label>
                <label>
                  Tons
                  <input name="tons" type="number" min="0.01" step="0.01" defaultValue={selectedTruck.tons || 22} />
                </label>
                <label>
                  Yards
                  <input name="yards" type="number" min="0.01" step="0.01" defaultValue={selectedTruck.yards || 30} />
                </label>
                <label>
                  Active
                  <select name="isActive" defaultValue={selectedTruck.isActive ? "true" : "false"}>
                    <option value="true">Active</option>
                    <option value="false">Inactive</option>
                  </select>
                </label>
                <label className="wideField">
                  Notes
                  <textarea name="notes" defaultValue={selectedTruck.notes} rows={4} />
                </label>
              </div>
              <div className="editorActions">
                <button className="successButton" type="submit" name="intent" value="update-truck">Save Truck</button>
                <button
                  className="dangerButton"
                  type="submit"
                  name="intent"
                  value="delete-truck"
                  onClick={(event) => {
                    if (!window.confirm(`Delete truck ${selectedTruck.truckNumber}? This cannot be undone.`)) {
                      event.preventDefault();
                    }
                  }}
                >
                  Delete Truck
                </button>
              </div>
            </Form>
          ) : (
            <div className="bigEmpty">
              <h2>No truck selected</h2>
              <p className="muted">Create a truck below to start enforcing route capacity.</p>
            </div>
          )}
        </section>
      </section>

      <Form method="post" className="panel orderEditor">
        <div className="panelHeader">
          <div>
            <p className="eyebrow">Add Truck</p>
            <h2>Create Fleet Truck</h2>
          </div>
        </div>
        <div className="createFields orderEditFields">
          <label>
            Truck Number
            <input name="truckNumber" placeholder="310" required />
          </label>
          <label>
            Display Name
            <input name="name" placeholder="Truck 310" />
          </label>
          <label>
            Tons
            <input name="tons" type="number" min="0.01" step="0.01" defaultValue="22" />
          </label>
          <label>
            Yards
            <input name="yards" type="number" min="0.01" step="0.01" defaultValue="30" />
          </label>
          <label>
            Active
            <select name="isActive" defaultValue="true">
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </label>
          <label className="wideField">
            Notes
            <textarea name="notes" rows={3} placeholder="Optional notes, restrictions, or repairs" />
          </label>
        </div>
        <div className="editorActions">
          <button className="primaryButton" type="submit" name="intent" value="create-truck">Add Truck</button>
        </div>
      </Form>
    </main>
  );
}
