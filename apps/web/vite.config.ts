import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = env.VITE_API_PROXY_TARGET ?? "http://localhost:3041";

  const allowedHosts = [
    "localhost",
    "superlms.skylarbarnes.com",
    "lmsapi.skylarbarnes.com",
    ".skylarbarnes.com",
  ];

  return {
    plugins: [react()],
    server: {
      port: 5174,
      host: true,
      allowedHosts,
      proxy: {
        "/auth": apiTarget,
        "/api": apiTarget,
      },
    },
    preview: {
      port: 5174,
      host: true,
      allowedHosts,
      proxy: {
        "/auth": apiTarget,
        "/api": apiTarget,
      },
    },
  };
});
