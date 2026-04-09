declare global {
  interface Window {
    google: any;
  }
}

let googlePlacesPromise: Promise<void> | null = null;

export function loadGooglePlaces(apiKey: string): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Window is not available"));
  }

  if (window.google?.maps?.places) {
    return Promise.resolve();
  }

  if (googlePlacesPromise) {
    return googlePlacesPromise;
  }

  googlePlacesPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(
      'script[data-google-places="true"]',
    ) as HTMLScriptElement | null;

    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () =>
        reject(new Error("Failed to load Google Places")),
      );
      return;
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      apiKey,
    )}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.dataset.googlePlaces = "true";

    script.onload = () => {
      if (window.google?.maps?.places) {
        resolve();
      } else {
        reject(new Error("Google Places loaded, but places library missing"));
      }
    };

    script.onerror = () => reject(new Error("Failed to load Google Places"));
    document.head.appendChild(script);
  });

  return googlePlacesPromise;
}

export function attachAddressAutocomplete(options: {
  address1Id: string;
  cityId: string;
  provinceId: string;
  postalCodeId: string;
  countryId: string;
}) {
  if (typeof window === "undefined" || !window.google?.maps?.places) {
    console.error("[GOOGLE PLACES] places library not available");
    return;
  }

  const address1 = document.getElementById(options.address1Id) as HTMLInputElement | null;
  const city = document.getElementById(options.cityId) as HTMLInputElement | null;
  const province = document.getElementById(options.provinceId) as HTMLInputElement | null;
  const postalCode = document.getElementById(options.postalCodeId) as HTMLInputElement | null;
  const country = document.getElementById(options.countryId) as HTMLInputElement | null;

  if (!address1 || !city || !province || !postalCode || !country) {
    console.error("[GOOGLE PLACES] missing address inputs");
    return;
  }

  const autocomplete = new window.google.maps.places.Autocomplete(address1, {
    types: ["address"],
    componentRestrictions: { country: ["us"] },
    fields: ["address_components", "formatted_address"],
  });

  autocomplete.addListener("place_changed", () => {
    const place = autocomplete.getPlace();
    const components = place?.address_components || [];

    let streetNumber = "";
    let route = "";
    let locality = "";
    let administrativeArea = "";
    let zip = "";
    let countryCode = "US";

    for (const component of components) {
      const types: string[] = component.types || [];

      if (types.includes("street_number")) streetNumber = component.long_name || "";
      if (types.includes("route")) route = component.long_name || "";
      if (types.includes("locality")) locality = component.long_name || "";
      if (types.includes("administrative_area_level_1")) {
        administrativeArea = component.short_name || component.long_name || "";
      }
      if (types.includes("postal_code")) zip = component.long_name || "";
      if (types.includes("country")) {
        countryCode = component.short_name || component.long_name || "US";
      }
    }

    address1.value = [streetNumber, route].filter(Boolean).join(" ").trim();
    city.value = locality;
    province.value = administrativeArea;
    postalCode.value = zip;
    country.value = countryCode;
  });
}