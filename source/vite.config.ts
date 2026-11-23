import { defineConfig } from "vite";
import { api } from "./server/api.ts";

export default defineConfig({
  css: { postcss: { plugins: [] } },
  server: { host: "127.0.0.1", port: 5173, fs: { strict: true, deny: ["**/.env*", "**/.git/**", "**/data/**", "**/*.db*"] } },
  plugins: [{
    name: "zapis-pro-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith("/api/")) void api(req, res);
        else next();
      });
    },
  }],
});
