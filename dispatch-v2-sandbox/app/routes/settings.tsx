import { data, Form, Link, useActionData, useLoaderData, useNavigation } from "react-router";
import {
  createDispatchUser,
  DISPATCH_PERMISSIONS,
  getDispatchAuthSetupStatus,
  listDispatchUsers,
  requireDispatchUser,
  resetDispatchUserPassword,
  saveDispatchUserRole,
} from "../lib/auth.server";
import {
  getDefaultDispatchOperationalSettings,
  getDispatchSystemStatus,
  loadDispatchOperationalSettings,
  saveDispatchOperationalSettings,
  type DispatchOperationalSettings,
} from "../lib/dispatch.server";
import { PermissionNav } from "../components/PermissionNav";

function formNumber(form: FormData, key: keyof DispatchOperationalSettings, fallback: number) {
  const parsed = Number(form.get(String(key)));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function formBoolean(form: FormData, key: keyof DispatchOperationalSettings) {
  return String(form.get(String(key)) || "") === "1";
}

export async function loader({ request }: { request: Request }) {
  const currentUser = await requireDispatchUser(request, "settings");
  const [users, authStatus] = await Promise.all([
    listDispatchUsers(),
    getDispatchAuthSetupStatus(),
  ]);
  let operations = getDefaultDispatchOperationalSettings();
  let settingsStorageError = "";

  try {
    operations = await loadDispatchOperationalSettings();
  } catch (error) {
    settingsStorageError =
      error instanceof Error
        ? error.message
        : "Unable to load dispatch settings. Run sql/phase3_reliability.sql.";
  }

  return data({
    currentUser,
    users,
    permissions: DISPATCH_PERMISSIONS,
    operations,
    settingsStorageError,
    authStatus,
    systemStatus: getDispatchSystemStatus(),
  });
}

export async function action({ request }: { request: Request }) {
  const currentUser = await requireDispatchUser(request, "settings");
  const form = await request.formData();
  const intent = String(form.get("intent") || "save-user");

  if (intent === "save-operations") {
    const defaults = getDefaultDispatchOperationalSettings();
    const saved = await saveDispatchOperationalSettings(
      {
        shopAddress: String(form.get("shopAddress") || defaults.shopAddress).trim(),
        defaultImportLimit: formNumber(form, "defaultImportLimit", defaults.defaultImportLimit),
        defaultImportSinceDays: formNumber(
          form,
          "defaultImportSinceDays",
          defaults.defaultImportSinceDays,
        ),
        calculateDistancesOnImport: formBoolean(form, "calculateDistancesOnImport"),
        distanceLimit: formNumber(form, "distanceLimit", defaults.distanceLimit),
        mapRefreshSeconds: formNumber(form, "mapRefreshSeconds", defaults.mapRefreshSeconds),
        driverLocationSeconds: formNumber(
          form,
          "driverLocationSeconds",
          defaults.driverLocationSeconds,
        ),
        driverReleaseDelayMinutes: formNumber(
          form,
          "driverReleaseDelayMinutes",
          defaults.driverReleaseDelayMinutes,
        ),
        quickDeliverEnabled: formBoolean(form, "quickDeliverEnabled"),
        chimeEnabled: formBoolean(form, "chimeEnabled"),
        defaultDispatchDateMode: String(
          form.get("defaultDispatchDateMode") || defaults.defaultDispatchDateMode,
        ),
        loaderAutoAdvance: formBoolean(form, "loaderAutoAdvance"),
      },
      currentUser.email,
    );

    return data({ ok: true, message: "Saved dispatch operations settings.", saved });
  }

  const userId = String(form.get("userId") || "");
  const email = String(form.get("email") || "");

  if (intent === "create-user") {
    const newUserEmail = String(form.get("newUserEmail") || "").trim();
    const temporaryPassword = String(form.get("newTemporaryPassword") || "");
    const displayName = String(form.get("newDisplayName") || "");
    const role = String(form.get("newRole") || "dispatch_view");
    const permissions = form.getAll("newPermissions").map(String);
    const isActive = String(form.get("newIsActive") || "") === "1";

    try {
      const created = await createDispatchUser({
        email: newUserEmail,
        temporaryPassword,
        displayName,
        role,
        permissions,
        isActive,
        actorEmail: currentUser.email,
      });
      return data({ ok: true, message: `Created user ${created.role.email}.` });
    } catch (error) {
      return data(
        { ok: false, message: error instanceof Error ? error.message : "Unable to create user." },
        { status: 400 },
      );
    }
  }

  if (intent === "reset-password") {
    const temporaryPassword = String(form.get("temporaryPassword") || "");
    if (!userId || !email) {
      return data({ ok: false, message: "Missing user." }, { status: 400 });
    }

    try {
      await resetDispatchUserPassword({
        userId,
        email,
        temporaryPassword,
        actorEmail: currentUser.email,
      });

      return data({ ok: true, message: `Reset password for ${email}.` });
    } catch (error) {
      return data(
        { ok: false, message: error instanceof Error ? error.message : "Unable to reset password." },
        { status: 400 },
      );
    }
  }

  const displayName = String(form.get("displayName") || "");
  const role = String(form.get("role") || "viewer");
  const permissions = form.getAll("permissions").map(String);
  const isActive = String(form.get("isActive") || "") === "1";

  if (!userId || !email) {
    return data({ ok: false, message: "Missing user." }, { status: 400 });
  }

  const saved = await saveDispatchUserRole({
    userId,
    email,
    displayName,
    role,
    permissions,
    isActive,
  });

  return data({ ok: true, message: `Saved ${saved.email}.` });
}

function statusPill(label: string, ok: boolean) {
  return (
    <span className={ok ? "miniStatus ready" : "miniStatus missing"}>
      {label}: {ok ? "Ready" : "Missing"}
    </span>
  );
}

function RoleOptions() {
  return (
    <>
      <option value="admin">Admin</option>
      <option value="dispatcher">Dispatcher</option>
      <option value="dispatch_view">Dispatch View Only</option>
      <option value="driver">Driver</option>
      <option value="loader">Loader</option>
      <option value="viewer">Viewer</option>
    </>
  );
}

export default function Settings() {
  const {
    currentUser,
    users,
    permissions,
    operations,
    settingsStorageError,
    authStatus,
    systemStatus,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as { ok?: boolean; message?: string } | undefined;
  const navigation = useNavigation();

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>Dispatch Settings</h1>
          <p className="muted">
            Signed in as {currentUser.email}. Manage users, permissions, dispatch defaults, imports,
            maps, and system readiness from one place.
          </p>
        </div>
        <PermissionNav />
      </header>

      {actionData?.message ? (
        <div className={actionData.ok === false ? "notice error" : "notice"}>{actionData.message}</div>
      ) : null}

      {settingsStorageError ? (
        <div className="notice error">
          Settings storage is not ready: {settingsStorageError}
        </div>
      ) : null}

      <section className="settingsDashboard">
        <article className="panel settingsPanel">
          <div className="panelHeader">
            <div>
              <p className="eyebrow">System</p>
              <h2>Readiness</h2>
              <p className="muted">Safe status only. No secret values are displayed.</p>
            </div>
            <Link className="toolbarLink" to="/setup-status">
              Setup JSON
            </Link>
          </div>
          <div className="statusGrid">
            {statusPill("Auth env", authStatus.ok)}
            {statusPill("Supabase", systemStatus.supabaseConfigured)}
            {statusPill("Shopify import", systemStatus.shopifyImportReady)}
            {statusPill("Maps server", systemStatus.googleMapsServerConfigured)}
            {statusPill("Maps browser", systemStatus.googleMapsBrowserConfigured)}
            {statusPill("Import secret", systemStatus.importSecretConfigured)}
            {statusPill("Distance secret", systemStatus.distanceSecretConfigured)}
            {statusPill("Admin emails", authStatus.adminEmailsConfigured)}
          </div>
          <div className="settingsFacts">
            <span>Node: {systemStatus.nodeVersion}</span>
            <span>Role rows: {authStatus.roleCount ?? "unknown"}</span>
            <span>Shop origin: {systemStatus.shopAddress}</span>
          </div>
        </article>

        <Form method="post" className="panel settingsPanel">
          <input type="hidden" name="intent" value="save-operations" />
          <div className="panelHeader">
            <div>
              <p className="eyebrow">Operations</p>
              <h2>Dispatch Defaults</h2>
              <p className="muted">Controls that mirror the old classic dispatch setup area.</p>
            </div>
            <button type="submit" className="primaryButton" disabled={navigation.state !== "idle"}>
              Save Settings
            </button>
          </div>
          <div className="settingsForm threeColumn">
            <label className="wideField">
              Shop origin address
              <input name="shopAddress" defaultValue={operations.shopAddress} />
            </label>
            <label>
              Import limit
              <input name="defaultImportLimit" type="number" min="1" defaultValue={operations.defaultImportLimit} />
            </label>
            <label>
              Import lookback days
              <input
                name="defaultImportSinceDays"
                type="number"
                min="1"
                defaultValue={operations.defaultImportSinceDays}
              />
            </label>
            <label>
              Distance batch limit
              <input name="distanceLimit" type="number" min="1" defaultValue={operations.distanceLimit} />
            </label>
            <label>
              Map refresh seconds
              <input name="mapRefreshSeconds" type="number" min="15" defaultValue={operations.mapRefreshSeconds} />
            </label>
            <label>
              GPS send seconds
              <input
                name="driverLocationSeconds"
                type="number"
                min="5"
                defaultValue={operations.driverLocationSeconds}
              />
            </label>
            <label>
              Next stop release minutes
              <input
                name="driverReleaseDelayMinutes"
                type="number"
                min="1"
                defaultValue={operations.driverReleaseDelayMinutes}
              />
            </label>
            <label>
              Default date mode
              <select name="defaultDispatchDateMode" defaultValue={operations.defaultDispatchDateMode}>
                <option value="today-plus-undated">Today plus undated</option>
                <option value="today-only">Today only</option>
                <option value="all-active">All active</option>
              </select>
            </label>
          </div>
          <div className="permissionGrid">
            <label className="checkLabel permissionCheck">
              <input
                name="calculateDistancesOnImport"
                type="checkbox"
                value="1"
                defaultChecked={operations.calculateDistancesOnImport}
              />
              Calculate distances on import
            </label>
            <label className="checkLabel permissionCheck">
              <input name="chimeEnabled" type="checkbox" value="1" defaultChecked={operations.chimeEnabled} />
              New order chime
            </label>
            <label className="checkLabel permissionCheck">
              <input
                name="loaderAutoAdvance"
                type="checkbox"
                value="1"
                defaultChecked={operations.loaderAutoAdvance}
              />
              Loader auto-advance
            </label>
            <label className="checkLabel permissionCheck">
              <input
                name="quickDeliverEnabled"
                type="checkbox"
                value="1"
                defaultChecked={operations.quickDeliverEnabled}
              />
              Test quick-deliver mode
            </label>
          </div>
        </Form>

        <article className="panel settingsPanel">
          <div className="panelHeader">
            <div>
              <p className="eyebrow">Shortcuts</p>
              <h2>Dispatch Admin Pages</h2>
            </div>
          </div>
          <div className="settingsShortcuts">
            <Link to="/imports">Shopify Import</Link>
            <Link to="/routes">Routes</Link>
            <Link to="/trucks">Trucks</Link>
            <Link to="/drivers">Drivers</Link>
            <Link to="/orders">Orders</Link>
            <Link to="/timing">Timing Learning</Link>
            <Link to="/audit">Audit Log</Link>
            <Link to="/updates">Shopify Updates</Link>
            <Link to="/map">Map & Tracking</Link>
            <Link to="/monitor">Monitor</Link>
          </div>
        </article>
      </section>

      <section className="settingsGrid">
        <div className="sectionTitle">
          <p className="eyebrow">Access</p>
          <h2>Users & Roles</h2>
        </div>
        <Form method="post" className="panel userRoleCard addUserCard">
          <div className="panelHeader">
            <div>
              <p className="eyebrow">Add User</p>
              <h2>Create Dispatch Login</h2>
              <p className="muted">Creates the Supabase login and assigns the dispatch role in one step.</p>
            </div>
            <label className="switchLine">
              <input name="newIsActive" type="checkbox" value="1" defaultChecked />
              Active
            </label>
          </div>
          <div className="settingsForm twoColumn">
            <label>
              Email
              <input name="newUserEmail" type="email" required placeholder="name@example.com" />
            </label>
            <label>
              Temporary password
              <input
                name="newTemporaryPassword"
                type="password"
                required
                autoComplete="new-password"
                minLength={8}
                placeholder="Minimum 8 characters"
              />
            </label>
            <label>
              Display name
              <input name="newDisplayName" placeholder="Optional display name" />
            </label>
            <label>
              Role
              <select name="newRole" defaultValue="dispatch_view">
                <RoleOptions />
              </select>
            </label>
          </div>
          <div className="permissionGrid">
            {permissions.map((permission) => (
              <label key={`new-${permission.key}`} className="checkLabel permissionCheck">
                <input
                  name="newPermissions"
                  type="checkbox"
                  value={permission.key}
                  defaultChecked={permission.key === "board"}
                />
                {permission.label}
              </label>
            ))}
          </div>
          <button
            type="submit"
            name="intent"
            value="create-user"
            className="successButton"
            disabled={navigation.state !== "idle"}
          >
            Add User
          </button>
        </Form>
        {users.map((user) => {
          const role = user.role;
          const selectedPermissions = new Set(role?.permissions || []);
          return (
            <Form key={user.id} method="post" className="panel userRoleCard">
              <div className="panelHeader">
                <div>
                  <p className="eyebrow">{role?.role || "New User"}</p>
                  <h2>{role?.displayName || user.email || "No email"}</h2>
                  <p className="muted">
                    {user.email} · last sign in{" "}
                    {user.lastSignInAt ? new Date(user.lastSignInAt).toLocaleString() : "never"}
                  </p>
                </div>
                <label className="switchLine">
                  <input name="isActive" type="checkbox" value="1" defaultChecked={role?.isActive !== false} />
                  Active
                </label>
              </div>
              <input type="hidden" name="userId" value={user.id} />
              <input type="hidden" name="email" value={user.email} />
              <div className="settingsForm twoColumn">
                <label>
                  Display name
                  <input name="displayName" defaultValue={role?.displayName || user.email} />
                </label>
                <label>
                  Role
                  <select name="role" defaultValue={role?.role || "viewer"}>
                    <RoleOptions />
                  </select>
                </label>
                <div className="helperText">
                  Driver login links are managed on the <Link to="/drivers">Drivers</Link> page.
                </div>
              </div>
              <div className="permissionGrid">
                {permissions.map((permission) => (
                  <label key={permission.key} className="checkLabel permissionCheck">
                    <input
                      name="permissions"
                      type="checkbox"
                      value={permission.key}
                      defaultChecked={role?.role === "admin" || selectedPermissions.has(permission.key)}
                    />
                    {permission.label}
                  </label>
                ))}
              </div>
              <button
                type="submit"
                name="intent"
                value="save-user"
                className="primaryButton"
                disabled={navigation.state !== "idle"}
              >
                Save Permissions
              </button>
              <div className="settingsForm twoColumn passwordResetBox">
                <label>
                  Temporary password
                  <input
                    name="temporaryPassword"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    placeholder="Minimum 8 characters"
                  />
                </label>
                <button
                  type="submit"
                  name="intent"
                  value="reset-password"
                  className="warningButton"
                  disabled={navigation.state !== "idle"}
                >
                  Reset Password
                </button>
              </div>
            </Form>
          );
        })}
      </section>
    </main>
  );
}
