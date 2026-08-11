-- CreateTable
CREATE TABLE IF NOT EXISTS "AppSettings" (
    "shop" TEXT NOT NULL,
    "useTestFlatRate" BOOLEAN NOT NULL DEFAULT false,
    "testFlatRateCents" INTEGER NOT NULL DEFAULT 5000,
    "enableCalculatedRates" BOOLEAN NOT NULL DEFAULT true,
    "enableRemoteSurcharge" BOOLEAN NOT NULL DEFAULT true,
    "enableDebugLogging" BOOLEAN NOT NULL DEFAULT false,
    "showVendorSource" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "AppSettings_pkey" PRIMARY KEY ("shop")
);
