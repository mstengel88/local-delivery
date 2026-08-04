import { Link, useLocation, useRouteLoaderData } from "react-router";
import type { DispatchPermission } from "../lib/auth.server";

type RootData = {
  currentUser?: {
    role?: {
      role?: string;
      permissions?: DispatchPermission[];
    };
  } | null;
};

const LINKS: Array<{ to: string; label: string; permission: DispatchPermission }> = [
  { to: "/", label: "Board", permission: "board" },
  { to: "/calendar", label: "Calendar", permission: "calendar" },
  { to: "/allotment", label: "Allotment", permission: "allotment" },
  { to: "/orders", label: "Orders", permission: "orders" },
  { to: "/delivered", label: "Delivered", permission: "orders" },
  { to: "/routes", label: "Routes", permission: "routes" },
  { to: "/trucks", label: "Trucks", permission: "routes" },
  { to: "/drivers", label: "Drivers", permission: "routes" },
  { to: "/imports", label: "Import", permission: "imports" },
  { to: "/monitor", label: "Monitor", permission: "monitor" },
  { to: "/map", label: "Map", permission: "map" },
  { to: "/updates", label: "Updates", permission: "updates" },
  { to: "/timing", label: "Timing", permission: "timing" },
  { to: "/driver", label: "Driver", permission: "driver" },
  { to: "/loader", label: "Loader", permission: "loader" },
  { to: "/audit", label: "Audit", permission: "audit" },
  { to: "/admin", label: "Admin", permission: "settings" },
  { to: "/settings", label: "Settings", permission: "settings" },
];

const DISPATCH_VIEW_PERMISSIONS = new Set<DispatchPermission>([
  "board",
]);

function canOpen(permission: DispatchPermission, rootData: RootData | undefined) {
  const role = rootData?.currentUser?.role;
  if (!role) return false;
  if (role.role === "admin") return true;
  if (role.role === "dispatch_view" && DISPATCH_VIEW_PERMISSIONS.has(permission)) return true;
  return Boolean(role.permissions?.includes(permission));
}

export function PermissionNav() {
  const rootData = useRouteLoaderData("root") as RootData | undefined;
  const location = useLocation();
  const visibleLinks = LINKS.filter((link) => canOpen(link.permission, rootData));
  const roleName = rootData?.currentUser?.role?.role || "";
  const showQuoteTool = Boolean(rootData?.currentUser) && roleName !== "dispatch_view";

  return (
    <details className="navMenu">
      <summary aria-label="Open navigation menu">
        <span className="hamburgerIcon" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <strong>Menu</strong>
      </summary>
      <nav className="navPills" aria-label="Dispatch navigation">
        {showQuoteTool ? (
          <Link to="/custom-quote" className={location.pathname === "/custom-quote" ? "active" : ""}>
            Quote Tool
          </Link>
        ) : null}
        {visibleLinks.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className={location.pathname === link.to ? "active" : ""}
          >
            {link.label}
          </Link>
        ))}
        {rootData?.currentUser ? <Link to="/login?logout=1">Log Out</Link> : null}
      </nav>
    </details>
  );
}
