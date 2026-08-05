# Shopify App Cutover

`Local-Delivery` is the surviving Shopify app.

## Final Shopify Extension Ownership

- `unit-price-labels`: the only Online Store theme app embed. It adds unit labels to product and collection prices.
- `checkout-ui`: the checkout delivery-area guard. It calls `https://app.ghstickets.com/api/shipping-estimate`.
- `delivery-customization`: retired. The function returned no operations and did not change delivery options.

The contractor operations website is a separate web application, not a theme
app embed. It currently reads orders and writes fulfillment data through a
Shopify offline session, so its Shopify app must not be uninstalled until that
runtime is switched to the surviving `Local-Delivery` app credentials and has a
fresh offline session.

## Cutover Sequence

1. Run `npm run verify:shopify-cutover` and `npm run build`.
2. Create an unreleased preview with:
   `npm run deploy -- --no-release --allow-updates --allow-deletes --version local-delivery-cutover-preview`
3. Release the consolidated `Local-Delivery` version.
4. Reauthorize `Local-Delivery` in Shopify so the new order and fulfillment
   scopes are granted.
5. Set the same long random `SHOPIFY_GATEWAY_SECRET` value on both production
   containers. Set `SHOPIFY_GATEWAY_URL` on the contractor container to
   `https://app.ghstickets.com/api/internal/shopify-graphql`.
6. Deploy both web applications and restart both containers.
7. Open `Local-Delivery` from Shopify Admin once to create or refresh the
   offline session used by the gateway.
8. Validate the `GHS Shipping Calc` carrier service points to
   `https://app.ghstickets.com/api/carrier-service`, then validate product
   lookup, order import, draft-order creation, and fulfillment updates from the
   contractor operations website.
9. Disable the contractor app embed in the live theme, if it is present.
10. Uninstall the contractor Shopify app only after step 8 succeeds.

## Rollback

If contractor order or fulfillment actions fail, leave or reinstall the
contractor Shopify app and restore its previous runtime API key and secret.
The storefront unit-label embed remains owned by `Local-Delivery` and does not
need to be rolled back.
