import prisma from "../db.server";

export async function getAppSettings(shop: string) {
  const existing = await prisma.appSettings.findUnique({
    where: { shop },
  });

  if (existing) return existing;

  return prisma.appSettings.create({
    data: {
      shop,
      useTestFlatRate: false,
      testFlatRateCents: 5000,
      enableCalculatedRates: true,
      enableRemoteSurcharge: true,
      enableDebugLogging: false,
      showVendorSource: true,
    },
  });
}

export async function saveAppSettings(
  shop: string,
  values: {
    useTestFlatRate: boolean;
    testFlatRateCents: number;
    enableCalculatedRates: boolean;
    enableRemoteSurcharge: boolean;
    enableDebugLogging: boolean;
    showVendorSource: boolean;
  },
) {
  return prisma.appSettings.upsert({
    where: { shop },
    update: values,
    create: {
      shop,
      ...values,
    },
  });
}
