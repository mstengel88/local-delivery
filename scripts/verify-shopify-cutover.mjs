import {access, readFile, readdir} from "node:fs/promises";
import {join} from "node:path";

const requiredScopes = [
  "read_orders",
  "read_products",
  "write_fulfillments",
  "read_merchant_managed_fulfillment_orders",
  "write_merchant_managed_fulfillment_orders",
];

const expectedExtensions = new Set(["checkout-ui", "unit-price-labels"]);
const appConfig = await readFile("shopify.app.toml", "utf8");
const scopeMatch = appConfig.match(/scopes\s*=\s*"([^"]+)"/);

if (!scopeMatch) {
  throw new Error("Could not find access_scopes.scopes in shopify.app.toml");
}

const configuredScopes = new Set(scopeMatch[1].split(",").map((scope) => scope.trim()));
const missingScopes = requiredScopes.filter((scope) => !configuredScopes.has(scope));

if (missingScopes.length) {
  throw new Error(`Missing cutover scopes: ${missingScopes.join(", ")}`);
}

const entries = await readdir("extensions", {withFileTypes: true});
const candidateDirectories = entries
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
const extensionDirectories = [];

for (const directory of candidateDirectories) {
  try {
    await access(join("extensions", directory, "shopify.extension.toml"));
    extensionDirectories.push(directory);
  } catch {
    // Empty or asset-only directories are not Shopify extensions.
  }
}
const unexpectedExtensions = extensionDirectories.filter(
  (directory) => !expectedExtensions.has(directory),
);
const missingExtensions = [...expectedExtensions].filter(
  (directory) => !extensionDirectories.includes(directory),
);

if (unexpectedExtensions.length || missingExtensions.length) {
  throw new Error(
    [
      unexpectedExtensions.length
        ? `Unexpected extensions: ${unexpectedExtensions.join(", ")}`
        : "",
      missingExtensions.length
        ? `Missing extensions: ${missingExtensions.join(", ")}`
        : "",
    ]
      .filter(Boolean)
      .join(". "),
  );
}

for (const directory of expectedExtensions) {
  await readFile(join("extensions", directory, "shopify.extension.toml"), "utf8");
}

console.log(
  "Shopify cutover configuration verified: unit-price-labels + checkout-ui, with contractor operations scopes.",
);
