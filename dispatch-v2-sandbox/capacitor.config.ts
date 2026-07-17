import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.greenhillssupply.dispatch",
  appName: "GreenHills Dispatch",
  webDir: "build/client",
  server: {
    url: "https://dispatch.winterwatch-pro.info",
    cleartext: false,
  },
  ios: {
    contentInset: "automatic",
    preferredContentMode: "mobile",
    scrollEnabled: true,
    allowsLinkPreview: false,
  },
};

export default config;
