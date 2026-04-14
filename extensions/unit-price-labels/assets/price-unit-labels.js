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
  const debugEnabled = new URLSearchParams(window.location.search).get("ghs-unit-debug") === "1";

  function setDebug(message, details) {
    if (!debugEnabled) return;
    let panel = document.querySelector(".ghs-unit-debug");
    if (!(panel instanceof HTMLElement)) {
      panel = document.createElement("div");
      panel.className = "ghs-unit-debug";
      document.body.appendChild(panel);
    }

    const detailText = details ? `\n${JSON.stringify(details, null, 2)}` : "";
    panel.textContent = `${message}${detailText}`;
  }

  function applyGlobalLabelColor() {
    if (!pageData.labelColor) return;
    document.documentElement.style.setProperty("--gh-price-unit-color", pageData.labelColor);
  }

  const fallbackProductSelectors = [
    ".product__info-container .price",
    ".product .price",
    "[data-product-price]",
    ".price",
  ];

  const fallbackCardSelectors = [
    ".product-card .f-price-item--sale",
    ".product-card .f-price-item--regular",
    ".product-card .f-price",
    ".product-card__info .f-price-item--sale",
    ".product-card__info .f-price-item--regular",
    ".product-card__info .f-price",
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

  function getMoneyElements(scope) {
    return Array.from(scope.querySelectorAll("*")).filter((element) => {
      if (!(element instanceof HTMLElement)) return false;
      if (element.querySelector(".ghs-unit-label")) return false;
      if (element.children.length > 2) return false;

      const text = (element.textContent || "").trim();
      if (!text || text.length > 48) return false;
      if (!hasCurrencyText(element)) return false;

      const style = window.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") return false;

      return true;
    });
  }

  function appendLabelBlock(element, unitLabel) {
    if (!element || !unitLabel) return;
    if (element.parentElement && element.parentElement.querySelector(".ghs-unit-label")) return;

    const label = document.createElement("span");
    label.className = "ghs-unit-label";
    label.textContent = unitLabel;
    if (pageData.labelColor) label.style.color = pageData.labelColor;

    if (element.parentElement) {
      element.insertAdjacentText("beforeend", " ");
      element.appendChild(label);
      setDebug("Label appended", { text: unitLabel, target: element.textContent });
      return;
    }

    element.appendChild(label);
    setDebug("Label appended", { text: unitLabel, target: element.textContent });
  }

  function appendLabel(element, unitLabel) {
    if (!element || !unitLabel || element.querySelector(".ghs-unit-label")) return;
    const label = document.createElement("span");
    label.className = "ghs-unit-label";
    label.textContent = unitLabel;
    if (pageData.labelColor) label.style.color = pageData.labelColor;
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
      const fallback =
        findCandidate(fallbackProductSelectors, document) ||
        getMoneyElements(document.querySelector("main") || document.body)[0];
      if (fallback) appendLabelBlock(fallback, product.unitLabel);
      return;
    }

    matches.forEach((element) => appendLabelBlock(element, product.unitLabel));
  }

  function productCardContainers() {
    const hyperCards = Array.from(document.querySelectorAll(".product-card"));
    if (hyperCards.length) return hyperCards;

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

      const hyperPriceElement =
        container.querySelector(".f-price-item--sale") ||
        container.querySelector(".f-price-item--regular") ||
        container.querySelector(".f-price");

      const priceElement =
        hyperPriceElement ||
        findCandidate(selectors, container) ||
        findCandidate(fallbackCardSelectors, container) ||
        getMoneyElements(container)[0];

      appendLabelBlock(priceElement, unitLabel);
    });
  }

  async function fetchLabels(handles) {
    if (!apiUrl || !shop || !handles.length) return {};

    const url = new URL(apiUrl);
    url.searchParams.set("shop", shop);
    handles.forEach((handle) => url.searchParams.append("handle", handle));

    try {
      const response = await fetch(url.toString(), { credentials: "omit" });
      if (!response.ok) {
        setDebug("Unit label API failed", { status: response.status, url: url.toString() });
        return {};
      }
      const payload = await response.json();
      setDebug("Unit label API response", payload);
      return payload || { labels: {} };
    } catch (_error) {
      setDebug("Unit label API threw", { url: url.toString() });
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
    setDebug("Handles detected", { handles: Array.from(handles), shop, apiUrl });

    const fetchedPayload = await fetchLabels(Array.from(handles));
    const fetchedLabels = fetchedPayload.labels || {};
    if (fetchedPayload.color) {
      pageData.labelColor = fetchedPayload.color;
    }
    applyGlobalLabelColor();
    if (productHandle && fetchedLabels[productHandle]) {
      pageData.product = pageData.product || {};
      pageData.product.handle = productHandle;
      pageData.product.unitLabel = fetchedLabels[productHandle];
    }
    pageData.collectionProducts = Object.assign({}, pageData.collectionProducts || {}, fetchedLabels);

    applyProductLabel();
    applyCollectionLabels();
    setDebug("Apply complete", {
      product: pageData.product || null,
      collectionProducts: pageData.collectionProducts || {},
    });
  }

  document.addEventListener("shopify:section:load", applyAll);
  document.addEventListener("DOMContentLoaded", applyAll);
  window.addEventListener("load", applyAll);

  const observer = new MutationObserver(() => applyAll());
  observer.observe(document.body, { childList: true, subtree: true });

  applyGlobalLabelColor();
  applyAll();
})();
