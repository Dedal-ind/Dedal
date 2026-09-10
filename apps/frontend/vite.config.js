import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  /*
   * `@dedal/shared` is a linked workspace package, and Vite skips pre-bundling
   * linked deps by default. Its ESM entry does `import shared from
   * "./index.cjs"`, which the browser cannot satisfy — a raw CommonJS file has
   * no `default` export. Including it here makes esbuild convert the CJS to ESM
   * up front, so the interop default exists in dev the same way it does in the
   * Rollup build.
   */
  optimizeDeps: {
    include: ['@dedal/shared'],
  },
  server: {
    /*
     * Google Sign-In opens its account chooser in a popup and reports the result
     * by calling postMessage back on window.opener. Under COOP `same-origin` the
     * browser severs that opener reference, so the popup closes and the token is
     * never delivered — and Google surfaces the failure as the misleading "origin
     * is not allowed for the given client ID". `same-origin-allow-popups` keeps
     * the isolation for everything else while letting our own popups talk back.
     *
     * These are dev-server headers only. Whatever proxy or host serves the
     * production build has to set the same thing, or Google sign-in breaks there
     * in exactly this way.
     */
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
      'Cross-Origin-Embedder-Policy': 'unsafe-none',
    },
  },
})