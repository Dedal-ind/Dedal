import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Explicit imports from "vitest" read better than ambient globals.
    globals: false,
    // application-config.js throws on a missing variable at import time.
    setupFiles: ["tests/setup/test-environment.js"],
    include: ["tests/**/*.test.js"],
    /*
     * src/ is CommonJS. A require() inside a service bypasses Vite's module graph
     * and loads a second copy of whatever it pulls in, so a test that imports a
     * model *and* a service that requires it would register the mongoose model
     * twice. Externalising src/ sends every path through Node's own require cache.
     */
    server: { deps: { external: [/[\\/]src[\\/]/] } },
    // The memory server downloads its binary once and boots slowly the first time.
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
