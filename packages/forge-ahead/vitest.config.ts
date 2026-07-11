import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Enable global test functions (describe, it, expect, etc.)
    // This is required for ArchUnitTS to extend Vitest with custom matchers
    globals: true,

    // Use Node environment for testing
    environment: "node",

    // TypeScript's published compiler bundle points at a source map that is
    // not included in the npm package. Keep it on Node's native loader path so
    // Vite does not try to resolve that missing map during SSR transforms.
    server: {
      deps: {
        external: ["typescript"],
      },
    },

    // Configure code coverage
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
    },

    // Include all test files
    include: ["**/*.{test,spec}.?(c|m)[jt]s?(x)"],
  },
});
