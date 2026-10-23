import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${process.env.OIC_RUNNER_PORT || 3001}`,
        changeOrigin: true
      },
      "/api/reports": {
        target: `http://127.0.0.1:${process.env.OIC_RUNNER_PORT || 3001}`,
        changeOrigin: true
      }
    }
  }
});
