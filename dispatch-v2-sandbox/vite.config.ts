import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: Number(process.env.PORT || 3010),
  },
  plugins: [reactRouter(), tsconfigPaths()],
});
