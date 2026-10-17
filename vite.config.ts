import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "node:path"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    host: true,
    allowedHosts: true,
    // chamadas a /api vão para a API de login (server/)
    proxy: { "/api": "http://localhost:3333" },
  },
  preview: {
    proxy: { "/api": "http://localhost:3333" },
  },
})
