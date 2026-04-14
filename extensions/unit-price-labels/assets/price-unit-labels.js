(function () {
  const root = document.getElementById("ghs-price-unit-labels-root");
  const dataScript = document.getElementById("ghs-price-unit-labels-data");

  if (!root || !dataScript) return;

  let pageData;
  try {
    pageData = JSON.parse(dataScript.textContent || "{}");
  } catch (_error) {
    return;
  }

  const productSelector = (root.dataset.productPriceSelector || "").trim();
  const cardSelector = (root.dataset.cardPriceSelector || "").trim();
  const shop = pageData.shop;
  const apiUrl = pageData.apiUrl;

  const fallbackProductSelectors = [
    ".product__info-container .price",
    ".product .price",
    "[data-product-price]",
    ".price",
  ];

  const fallbackCardSelectors = [
    ".card-information .price",
    ".card__information .price",
    ".product-card-wrapper .price",
    ".grid-product__price",
    ".price",
  ];

  function normalizeHandleFromUrl(value) {
    if (!value) return null;
    try {
      const url = new URL(value, window.location.origin);
      const match = url.pathname.match(/\/products\/([^/?#]+)/);
      return match ? decodeURIComponent(match[1]) : null;
    } catch (_error) {
      return null;
    }
  }

  function hasCurrencyText(element) {
    const text = (element.textContent || "").trim();
    return /\$\s?\d|\d[\d,.]*\s?(USD|CAD|EUR)|£\s?\d|€\s?\d/.test(text);
  }

  function findCandidate(selectorList, scope) {
    for (const selector of selectorList) {
      const candidates = scope.querySelectorAll(selector);
      for (const candidate of candidates) {
        if (
          candidate instanceof HTMLElement &&
          !candidate.querySelector(".ghs-unit-label") &&
          hasCurrencyText(candidate)
        ) {
          return candidate;
        }
      }
    }

    return null;
  }

  function appendLabel(element, unitLabel) {
    if (!element || !unitLabel || element.querySelector(".ghs-unit-label")) return;
    const label = document.createElement("span");
    label.className = "ghs-unit-label";
    label.textContent = unitLabel;
    element.appendChild(label);
  }

  function applyProductLabel() {
    const product = pageData.product;
    if (!product || !product.unitLabel) return;

    const selectors = productSelector
      ? productSelector.split(",").map((part) => part.trim()).filter(Boolean)
      : fallbackProductSelectors;

    const matches = new Set();
    selectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((element) => {
        if (element instanceof HTMLElement && hasCurrencyText(element)) {
          matches.add(element);
        }
      });
    });

    if (!matches.size) {
      const fallback = findCandidate(fallbackProductSelectors, document);
      if (fallback) appendLabel(fallback, product.unitLabel);
      return;
    }

    matches.forEach((element) => appendLabel(element, product.unitLabel));
  }

  function productCardContainers() {
    return Array.from(
      document.querySelectorAll(
        [
          ".card-wrapper",
          ".grid__item",
          ".product-grid-item",
          ".product-item",
          ".boost-sd__product-item",
          "li[class*='product']",
        ].join(","),
      ),
    );
  }

  function applyCollectionLabels() {
    const collectionProducts = pageData.collectionProducts || {};
    if (!Object.keys(collectionProducts).length) return;

    const selectors = cardSelector
      ? cardSelector.split(",").map((part) => part.trim()).filter(Boolean)
      : fallbackCardSelectors;

    productCardContainers().forEach((container) => {
      if (!(container instanceof HTMLElement)) return;
      const anchor = container.querySelector("a[href*='/products/']");
      if (!(anchor instanceof HTMLAnchorElement)) return;

      const handle = normalizeHandleFromUrl(anchor.href);
      const unitLabel = handle ? collectionProducts[handle] : null;
      if (!unitLabel) return;

      const priceElement = findCandidate(selectors, container) || findCandidate(fallbackCardSelectors, container);
      appendLabel(priceElement, unitLabel);
    });
  }

  async function fetchLabels(handles) {
    if (!apiUrl || !shop || !handles.length) return {};

    const url = new URL(apiUrl);
    url.searchParams.set("shop", shop);
    handles.forEach((handle) => url.searchParams.append("handle", handle));

    try {
      const response = await fetch(url.toString(), { credentials: "omit" });
      if (!response.ok) return {};
      const payload = await response.json();
      return payload.labels || {};
    } catch (_error) {
      return {};
    }
  }

  function currentProductHandle() {
    if (pageData.product && pageData.product.handle) return pageData.product.handle;
    return normalizeHandleFromUrl(window.location.href);
  }

  function collectionHandles() {
    const handles = productCardContainers()
      .map((container) => {
        const anchor = container.querySelector("a[href*='/products/']");
        return anchor instanceof HTMLAnchorElement ? normalizeHandleFromUrl(anchor.href) : null;
      })
      .filter(Boolean);

    return Array.from(new Set(handles));
  }

  async function applyAll() {
    const handles = new Set();
    const productHandle = currentProductHandle();
    if (productHandle) handles.add(productHandle);
    collectionHandles().forEach((handle) => handles.add(handle));

    const fetchedLabels = await fetchLabels(Array.from(handles));
    if (productHandle && fetchedLabels[productHandle]) {
      pageData.product = pageData.product || {};
      pageData.product.handle = productHandle;
      pageData.product.unitLabel = fetchedLabels[productHandle];
    }
    pageData.collectionProducts = Object.assign({}, pageData.collectionProducts || {}, fetchedLabels);

    applyProductLabel();
    applyCollectionLabels();
  }

  document.addEventListener("shopify:section:load", applyAll);
  document.addEventListener("DOMContentLoaded", applyAll);
  window.addEventListener("load", applyAll);

  const observer = new MutationObserver(() => applyAll());
  observer.observe(document.body, { childList: true, subtree: true });

  applyAll();
})();
