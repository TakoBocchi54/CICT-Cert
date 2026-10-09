import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Proxy API requests to the backend server change the URL to match your backend server's address
    proxy: { "/api": "http://localhost:5000" },
  },
})
