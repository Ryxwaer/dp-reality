import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // `isomorphic-dompurify` pulls jsdom in itself, so we don't need the
    // jsdom environment here — node is enough and keeps the test
    // process small.
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globals: false
  }
})
