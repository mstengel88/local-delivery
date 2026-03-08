const CARRIER_NAME = "GHS Shipping Calc";

const LIST_CARRIER_SERVICES = `#graphql
  query CarrierServices {
    carrierServices(first: 20) {
      nodes {
        id
        name
        active
        callbackUrl
        supportsServiceDiscovery
      }
    }
  }
`;

const CREATE_CARRIER_SERVICE = `#graphql
  mutation CreateCarrierService($input: DeliveryCarrierServiceCreateInput!) {
    carrierServiceCreate(input: $input) {
      carrierService {
        id
        name
        active
        callbackUrl
        supportsServiceDiscovery
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const UPDATE_CARRIER_SERVICE = `#graphql
  mutation UpdateCarrierService($id: ID!, $input: DeliveryCarrierServiceUpdateInput!) {
    carrierServiceUpdate(id: $id, input: $input) {
      carrierService {
        id
        name
        active
        callbackUrl
        supportsServiceDiscovery
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export async function registerCarrierService(admin: any) {
  const appUrl = process.env.SHOPIFY_APP_URL;

  if (!appUrl) {
    return {
      ok: false,
      step: "env",
      message: "SHOPIFY_APP_URL is missing",
    };
  }

  const callbackUrl = `${appUrl.replace(/\/$/, "")}/api/carrier-service`;

  try {
    const listResponse = await admin.graphql(LIST_CARRIER_SERVICES);
    const listJson = await listResponse.json();

    const carriers = listJson?.data?.carrierServices?.nodes || [];
    const existing = carriers.find((service: any) => service.name === CARRIER_NAME);

    if (existing) {
      const needsUpdate =
        existing.callbackUrl !== callbackUrl ||
        existing.active !== true ||
        existing.supportsServiceDiscovery !== true;

      if (!needsUpdate) {
        return {
          ok: true,
          step: "exists",
          message: "Carrier service already exists and is correct",
          carrier: existing,
          callbackUrl,
        };
      }

      const updateResponse = await admin.graphql(UPDATE_CARRIER_SERVICE, {
        variables: {
          id: existing.id,
          input: {
            name: CARRIER_NAME,
            callbackUrl,
            active: true,
            supportsServiceDiscovery: true,
          },
        },
      });

      const updateJson = await updateResponse.json();
      const updateErrors = updateJson?.data?.carrierServiceUpdate?.userErrors || [];

      if (updateErrors.length > 0) {
        return {
          ok: false,
          step: "update",
          message: "Carrier update failed",
          errors: updateErrors,
          raw: updateJson,
          callbackUrl,
        };
      }

      return {
        ok: true,
        step: "updated",
        message: "Carrier service updated",
        carrier: updateJson?.data?.carrierServiceUpdate?.carrierService,
        callbackUrl,
      };
    }

    const createResponse = await admin.graphql(CREATE_CARRIER_SERVICE, {
      variables: {
        input: {
          name: CARRIER_NAME,
          callbackUrl,
          active: true,
          supportsServiceDiscovery: true,
        },
      },
    });

    const createJson = await createResponse.json();
    const createErrors = createJson?.data?.carrierServiceCreate?.userErrors || [];

    if (createErrors.length > 0) {
      return {
        ok: false,
        step: "create",
        message: "Carrier creation failed",
        errors: createErrors,
        raw: createJson,
        callbackUrl,
      };
    }

    return {
      ok: true,
      step: "created",
      message: "Carrier service created",
      carrier: createJson?.data?.carrierServiceCreate?.carrierService,
      callbackUrl,
    };
  } catch (error: any) {
    return {
      ok: false,
      step: "exception",
      message: error?.message || "Unknown error",
      error: String(error),
      callbackUrl,
    };
  }
}