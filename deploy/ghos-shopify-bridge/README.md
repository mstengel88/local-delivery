# GHOS Shopify Bridge

This deployment moves the surviving `Local-Delivery` Shopify runtime from the
Pi to GHOS without changing the Shopify app identity.

It intentionally runs one application container and reuses the existing GHOS
PostgreSQL service. It serves:

- Shopify carrier delivery pricing and checkout estimates;
- storefront unit-label lookups and the embedded unit-label administration;
- the private Shopify Admin GraphQL gateway used by Dispatch v2 and GHOS
  quoting for orders, draft orders, and fulfillment actions.

The Shopify theme and checkout extensions are deployed to Shopify's CDN. They
are not separate GHOS containers.

## Safety rules

1. Keep the Pi deployment running until GHOS passes the validation checklist.
2. Do not change `SHOPIFY_API_KEY`, the installed Shopify app, or extension
   ownership during the host move.
3. Do not point `app.ghstickets.com` at GHOS until the temporary LAN endpoint
   and an authenticated offline session have been verified.
4. Never commit `bridge.env`, `cloudflare.env`, database dumps, or session data.

## Files

- `compose.yml`: isolated app service on temporary LAN port 8086.
- `compose.cloudflare.yml`: optional production Cloudflare connector, enabled
  only at hostname cutover.
- `bridge.env.example`: required configuration names without secret values.
- `cloudflare.env.example`: Cloudflare tunnel token placeholder.

## Deployment outline

1. Back up the current GHOS application/database stack.
2. Copy this repository to `/opt/ghos/apps/local-delivery`.
3. Create a dedicated `shopify_bridge` PostgreSQL role and database in the
   existing `ghos-postgres` container.
4. Populate `bridge.env` from the current Pi container without printing secrets.
5. Export/import the Shopify `Session` table, or reauthorize the installed app
   immediately before cutover.
6. Start the isolated service:

   ```sh
   docker compose --env-file bridge.env -f compose.yml up -d --build
   ```

7. Validate `http://GHOS-LAN-IP:8086/healthz`, delivery rates, unit labels, and
   gateway operations.
8. Start the dedicated Cloudflare connector and move only
   `app.ghstickets.com` to it.
9. Validate production, then stop (but do not immediately delete) the Pi
   container for a rollback window.

## Rollback

Stop the GHOS Cloudflare connector and restore the previous tunnel route to the
still-intact Pi container. No Shopify extension reinstallation is required.
