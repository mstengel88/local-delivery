# Dispatch v2 Sandbox

This is a separate sandbox app for rebuilding dispatch reliability without touching the existing quote/contractor app.

## Phase 1 Scope

- Fast board load from `dispatch_orders` and `dispatch_routes`
- Unscheduled queue
- Route cards with assigned stops
- Assign orders by dropdown or drag/drop
- Unassign orders
- Move stops up/down
- No map, Shopify sync, GPS, or native camera upload yet

## Phase 2 Scope

- `/driver` shows one current stop at a time for the selected route
- Driver can enter loaded quantity, mark enroute, capture proof fields, and mark delivered
- `/loader` shows the next load per route and lets the loader add prep notes
- Both field pages auto-refresh while visible without pulling the full classic board UI

## Phase 3 Reliability

- Audit logging is written to `dispatch_audit_log` for assignment, reordering, enroute, delivered, and loader prep actions
- Audit logging is non-blocking, so missing audit storage will not crash dispatch actions
- Driver and loader pages use smaller data queries than the board
- A root error boundary shows actionable errors instead of a blank screen
- `/audit` shows recent dispatch actions with searchable before/after snapshots
- The main board auto-refreshes every 30 seconds while visible and not saving
- The board includes lightweight manual route creation and manual order intake
- The board defaults to today's dispatch date, can include undated orders, and has an all-active view
- `/orders` lets dispatchers search, edit, cancel, and reopen orders without hard-deleting history
- `/routes` lets dispatchers edit, deactivate, and reactivate routes without deleting history
- `/monitor` is a lightweight read-only route status screen for TV/tablet use with route progress, current stop, next load, and active totals
- `/imports` pulls recent unfulfilled Shopify delivery orders into dispatch and splits multi-product orders into separate tickets with `a`, `b`, `c` suffixes
- `/updates` shows Shopify import/reconciliation events and the exact fields that changed from before/after audit snapshots
- The board can calculate missing round-trip mileage/time from the shop to each delivery address using Google Routes API
- `/map` shows active route lines and route toggles for the selected delivery day using Google Maps in the browser
- `/map` also shows route-colored live driver markers from `dispatch_driver_locations`; the driver page reports GPS while open
- Supabase Auth users can sign in with their existing email/password; `/settings` assigns dispatch roles and page permissions

Run this in Supabase SQL Editor before serious testing:

```sql
-- paste sql/phase3_reliability.sql
```

If you only need the learned route timing table, paste this smaller file instead:

```sql
-- paste sql/learned_timing_metrics.sql
```

## Local Run

```sh
cp .env.example .env
npm install --legacy-peer-deps
npm run dev
```

Open `http://localhost:3010`.

## iOS App

The iOS app is a Capacitor shell around the deployed dispatch app at:

```text
https://dispatch.winterwatch-pro.info
```

That keeps the native app using the same backend routes, Supabase auth, live GPS, photo upload, Shopify import, and delivery email system as the web app.

First-time setup is already done in this repo, but these are the repeatable commands:

```sh
npm install
npm run ios:sync
npm run ios:open
```

Open the generated Xcode project at:

```text
ios/App/App.xcodeproj
```

In Xcode:

- Select the `App` target.
- Set the signing team.
- Keep device family set to iPhone and iPad.
- Build/run on an iPhone or iPad simulator/device.

The app includes iOS permission descriptions for camera, location, and photo library because the driver workflow uses GPS proof and delivery photos.

## Docker

```sh
docker build -t dispatch-v2-sandbox .
docker run --env-file .env -p 3010:3000 dispatch-v2-sandbox
```

Or with Compose:

```sh
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 dispatch-v2-sandbox
```

This image uses Node 22 because Supabase's current realtime client expects native WebSocket support at startup. The app also includes the `ws` transport fallback so a stale Node 20 image will not crash before the board loads, but Node 22 is still the preferred runtime.

If the Pi cannot pull from Docker Hub, build the image on another machine and load it on the Pi:

```sh
docker build -t dispatch-v2-sandbox:latest .
docker save dispatch-v2-sandbox:latest | gzip > dispatch-v2-sandbox.tar.gz
scp dispatch-v2-sandbox.tar.gz pi@Docker:/home/pi/
```

On the Pi:

```sh
gunzip -c /home/pi/dispatch-v2-sandbox.tar.gz | docker load
cd /home/pi/dispatch-v2-sandbox
docker compose -f docker-compose.yml -f docker-compose.image.yml up -d
docker compose -f docker-compose.yml -f docker-compose.image.yml ps
docker compose -f docker-compose.yml -f docker-compose.image.yml logs -f dispatch-v2-sandbox
```

The `docker-compose.image.yml` override disables local build and uses the preloaded `dispatch-v2-sandbox:latest` image.

The container includes a `/health` check. After deploy, verify the origin before troubleshooting cloudflared:

```sh
curl -I http://127.0.0.1:3010/health
docker inspect --format='{{json .State.Health}}' dispatch-v2-sandbox
```

## Environment

Use a sandbox Supabase project if possible. If you point this at production Supabase, it will update real `dispatch_orders` route assignments.

Required:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DISPATCH_ADMIN_EMAILS` comma-separated emails that should automatically receive admin access

Optional for Shopify import:

- `SHOPIFY_SHOP_DOMAIN`, `SHOPIFY_STORE_DOMAIN`, or `SHOPIFY_SHOP`
- `SHOPIFY_ADMIN_ACCESS_TOKEN`, or `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET`
- `SHOPIFY_API_SECRET_KEY`, `SHOPIFY_CLIENT_SECRET`, and `SHOPIFY_CLIENT_SECRET_KEY` are also accepted as secret aliases
- `SHOPIFY_API_VERSION`
- `DISPATCH_IMPORT_SECRET`
- `GOOGLE_MAPS_API_KEY`
- `GOOGLE_MAPS_BROWSER_API_KEY` for the `/map` page. This must have Maps JavaScript API enabled and should be restricted by HTTP referrer.
- `DISPATCH_SHOP_ADDRESS`
- `DISTANCE_CALC_SECRET`

## Unattended Shopify Import

Set `DISPATCH_IMPORT_SECRET` to a long random value, then call the endpoint from cron:

```sh
curl -fsS "https://your-sandbox-domain/api/shopify-import?secret=YOUR_SECRET&limit=50&sinceDays=7"
```

You can also pass the secret as a header:

```sh
curl -fsS -H "x-dispatch-secret: YOUR_SECRET" "https://your-sandbox-domain/api/shopify-import?limit=50&sinceDays=7"
```

## Distance Calculation

Set `GOOGLE_MAPS_API_KEY` and `DISPATCH_SHOP_ADDRESS`, then use the board button to calculate missing times.

For unattended calculation:

```sh
curl -fsS "https://your-sandbox-domain/api/calculate-distances?secret=YOUR_SECRET&date=all&mode=missing&limit=40"
```

## Design Rule

Keep this boring and fast. If a feature makes the board heavier, move it to a separate page or background job.
