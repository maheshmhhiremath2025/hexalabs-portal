import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react-swc'

export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 3000,
    allowedHosts: ["getlabs.cloud", "www.getlabs.cloud"],
  },
  plugins: [
    react(),
    tailwindcss(),
  ],
})
