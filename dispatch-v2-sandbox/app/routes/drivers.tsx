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
import { listDispatchUsers, requireDispatchEditor, requireDispatchUser } from "../lib/auth.server";
import {
  createDispatchDriver,
  deactivateDispatchDriver,
  loadDispatchDriversForManagement,
  updateDispatchDriver,
  type DispatchEmployeeOption,
} from "../lib/dispatch.server";
import { PermissionNav } from "../components/PermissionNav";

export async function loader({ request }: { request: Request }) {
  await requireDispatchUser(request, "routes");
  const started = performance.now();
  const url = new URL(request.url);
  const selectedDriverId = url.searchParams.get("driver");
  const [drivers, users] = await Promise.all([
    loadDispatchDriversForManagement(500),
    listDispatchUsers(),
  ]);
  const selectedDriver =
    drivers.find((driver) => driver.id === selectedDriverId) ||
    drivers.find((driver) => driver.isActive) ||
    drivers[0] ||
    null;

  return data({
    drivers,
    users,
    selectedDriver,
    loadedAt: new Date().toISOString(),
    loadMs: Math.round(performance.now() - started),
  });
}

function employeeInputFromForm(form: FormData, userEmailById: Map<string, string>) {
  const linkedUserId = String(form.get("linkedUserId") || "").trim();
  return {
    name: String(form.get("name") || ""),
    email: String(form.get("email") || ""),
    phone: String(form.get("phone") || ""),
    role: String(form.get("role") || "Driver"),
    userId: linkedUserId,
    userEmail: linkedUserId ? userEmailById.get(linkedUserId) || "" : "",
    isActive: String(form.get("isActive") || "true") === "true",
    notes: String(form.get("notes") || ""),
  };
}

export async function action({ request }: { request: Request }) {
  const currentUser = await requireDispatchUser(request, "routes");
  await requireDispatchEditor(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  const driverId = String(form.get("driverId") || "").trim();
  const users = await listDispatchUsers();
  const userEmailById = new Map(users.map((user) => [user.id, user.email]));
  const input = employeeInputFromForm(form, userEmailById);

  try {
    if (intent === "create-driver") {
      const driver = await createDispatchDriver(input, currentUser.email);
      return redirect(`/drivers?driver=${encodeURIComponent(driver.id)}`);
    }

    if (intent === "update-driver") {
      if (!driverId) return data({ ok: false, message: "Missing driver." }, { status: 400 });
      const driver = await updateDispatchDriver(driverId, input, currentUser.email);
      return data({ ok: true, message: `Saved driver ${driver.name}.`, driver });
    }

    if (intent === "deactivate-driver") {
      if (!driverId) return data({ ok: false, message: "Missing driver." }, { status: 400 });
      const driver = await deactivateDispatchDriver(driverId, currentUser.email);
      return redirect(`/drivers?deactivated=${encodeURIComponent(driver.name)}`);
    }

    return data({ ok: false, message: "Unknown driver action." }, { status: 400 });
  } catch (error) {
    return data(
      {
        ok: false,
        message:
          error instanceof Error
            ? `${error.message} If this mentions user_id or user_email, run sql/driver_user_links.sql in Supabase.`
            : "Unable to save driver.",
      },
      { status: 500 },
    );
  }
}

function driverSearchText(driver: DispatchEmployeeOption) {
  return [
    driver.name,
    driver.email,
    driver.phone,
    driver.role,
    driver.userEmail,
    driver.isActive ? "active" : "inactive",
    driver.notes,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function linkedUserLabel(user: { email: string; role: { displayName?: string; role?: string } | null }) {
  const name = user.role?.displayName || "";
  const role = user.role?.role || "no role";
  return `${name && name !== user.email ? `${name} · ` : ""}${user.email} (${role})`;
}

function LinkedUserSelect({
  users,
  defaultValue,
}: {
  users: Awaited<ReturnType<typeof listDispatchUsers>>;
  defaultValue?: string;
}) {
  return (
    <select name="linkedUserId" defaultValue={defaultValue || ""}>
      <option value="">No linked login</option>
      {users.map((user) => (
        <option key={user.id} value={user.id}>
          {linkedUserLabel(user)}
        </option>
      ))}
    </select>
  );
}

export default function DriversPage() {
  const { drivers, users, selectedDriver, loadedAt, loadMs } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as { ok?: boolean; message?: string } | undefined;
  const navigation = useNavigation();
  const [search, setSearch] = useState("");
  const normalizedSearch = search.trim().toLowerCase();
  const visibleDrivers = useMemo(
    () => drivers.filter((driver) => !normalizedSearch || driverSearchText(driver).includes(normalizedSearch)),
    [drivers, normalizedSearch],
  );

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Drivers</p>
          <h1>Driver Directory</h1>
          <p className="muted">
            Add drivers, keep contact info in one place, and link each driver to the Supabase login that should see their route.
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
          {navigation.state !== "idle" ? "Saving driver..." : actionData?.message}
        </div>
      ) : null}

      <section className="toolbar">
        <input
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
          placeholder="Search driver, email, phone, linked user, role, status, notes..."
        />
      </section>

      <section className="ordersLayout">
        <aside className="panel orderBrowser">
          <div className="panelHeader">
            <div>
              <p className="eyebrow">Crew</p>
              <h2>{visibleDrivers.length} drivers</h2>
            </div>
          </div>
          <div className="orderList">
            {visibleDrivers.map((driver) => (
              <Link
                key={driver.id}
                className={`orderCard orderLink ${selectedDriver?.id === driver.id ? "selectedOrder" : ""}`}
                to={`/drivers?driver=${encodeURIComponent(driver.id)}`}
              >
                <strong>{driver.name}</strong>
                <span>{driver.role || "Driver"}</span>
                <div className="routeTimingLine">
                  <strong>{driver.phone || "No phone"}</strong>
                  <span>{driver.email || "No email"}</span>
                </div>
                <small>{driver.userEmail ? `Linked to ${driver.userEmail}` : "No linked login"}</small>
                <small>{driver.isActive ? "Active" : "Inactive"}</small>
              </Link>
            ))}
            {!visibleDrivers.length ? <div className="empty">No matching drivers.</div> : null}
          </div>
        </aside>

        <section className="panel orderEditorPanel">
          {selectedDriver ? (
            <Form key={selectedDriver.id} method="post" className="orderEditor">
              <input type="hidden" name="driverId" value={selectedDriver.id} />
              <div className="panelHeader">
                <div>
                  <p className="eyebrow">Edit Selected Driver</p>
                  <h2>{selectedDriver.name}</h2>
                  <p className="muted">
                    Link this driver to one Supabase user. Driver route visibility will use this link first.
                  </p>
                </div>
                <span className="statusBadge">{selectedDriver.isActive ? "Active" : "Inactive"}</span>
              </div>
              <div className="createFields orderEditFields">
                <label>
                  Driver Name
                  <input name="name" defaultValue={selectedDriver.name} required />
                </label>
                <label>
                  Linked Login
                  <LinkedUserSelect users={users} defaultValue={selectedDriver.userId} />
                </label>
                <label>
                  Email
                  <input name="email" type="email" defaultValue={selectedDriver.email} />
                </label>
                <label>
                  Phone
                  <input name="phone" defaultValue={selectedDriver.phone} placeholder="262-555-0100" />
                </label>
                <label>
                  Role / Position
                  <input name="role" defaultValue={selectedDriver.role || "Driver"} />
                </label>
                <label>
                  Active
                  <select name="isActive" defaultValue={selectedDriver.isActive ? "true" : "false"}>
                    <option value="true">Active</option>
                    <option value="false">Inactive</option>
                  </select>
                </label>
                <label className="wideField">
                  Notes
                  <textarea name="notes" defaultValue={selectedDriver.notes} rows={4} />
                </label>
              </div>
              <div className="editorActions">
                <button className="successButton" type="submit" name="intent" value="update-driver">
                  Save Driver
                </button>
                <button
                  className="dangerButton"
                  type="submit"
                  name="intent"
                  value="deactivate-driver"
                  onClick={(event) => {
                    if (!window.confirm(`Deactivate driver ${selectedDriver.name}? Existing route history will stay intact.`)) {
                      event.preventDefault();
                    }
                  }}
                >
                  Deactivate Driver
                </button>
              </div>
            </Form>
          ) : (
            <div className="bigEmpty">
              <h2>No driver selected</h2>
              <p className="muted">Create a driver below, then link their login in one place.</p>
            </div>
          )}
        </section>
      </section>

      <Form method="post" className="panel orderEditor">
        <div className="panelHeader">
          <div>
            <p className="eyebrow">Add Driver</p>
            <h2>Create Driver</h2>
          </div>
        </div>
        <div className="createFields orderEditFields">
          <label>
            Driver Name
            <input name="name" placeholder="Michael J" required />
          </label>
          <label>
            Linked Login
            <LinkedUserSelect users={users} />
          </label>
          <label>
            Email
            <input name="email" type="email" placeholder="driver@example.com" />
          </label>
          <label>
            Phone
            <input name="phone" placeholder="262-555-0100" />
          </label>
          <label>
            Role / Position
            <input name="role" defaultValue="Driver" />
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
            <textarea name="notes" rows={3} placeholder="Optional schedule notes, license info, restrictions, etc." />
          </label>
        </div>
        <div className="editorActions">
          <button className="primaryButton" type="submit" name="intent" value="create-driver">
            Add Driver
          </button>
        </div>
      </Form>
    </main>
  );
}
