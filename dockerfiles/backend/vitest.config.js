import { defineConfig } from 'vitest/config'

// Backend test runner config.
// Tests live in __tests__/. We use the node environment (no DOM) and skip network/DB
// in unit tests — anything that needs MongoDB should mock it or run as integration.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['__tests__/**/*.test.js'],
  },
})
