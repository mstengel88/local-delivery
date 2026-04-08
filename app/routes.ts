import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/_index/route.tsx"),

  route("auth/login", "routes/auth.login/route.tsx"),
  route("auth/*", "routes/auth.$.tsx"),

  route("app", "routes/app.tsx", [
    index("routes/app._index.tsx"),
    route("admin", "routes/app.admin.tsx"),
    route("additional", "routes/app.additional.tsx"),
    route("custom-quote", "routes/app.custom-quote.tsx"),
  ]),

  route("api/shipping-estimate", "routes/api.shipping-estimate.ts"),
  route("api/carrier-service", "routes/api.carrier-service.ts"),

  route("app/api/shipping-estimate", "routes/app.api.shipping-estimate.ts"),
  route("app/api/carrier-service", "routes/app.api.carrier-service.ts"),

  route("webhooks/app/scopes_update", "routes/webhooks.app.scopes_update.tsx"),
  route("webhooks/app/uninstalled", "routes/webhooks.app.uninstalled.tsx"),
] satisfies RouteConfig;