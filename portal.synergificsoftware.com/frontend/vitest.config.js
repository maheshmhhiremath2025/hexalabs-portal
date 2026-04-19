import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react-swc'

// Vitest config — separate from vite.config.js so test-only deps stay out of the prod build.
// `setupFiles` registers @testing-library/jest-dom matchers (toBeInTheDocument, etc.)
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.js'],
    include: ['src/**/*.{test,spec}.{js,jsx}'],
    css: false,
  },
})
