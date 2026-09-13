import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/*
 * KEEP THE PRE-BUNDLED @dedal/shared IN STEP WITH ITS SOURCE.
 *
 * `@dedal/shared` has to be pre-bundled (see optimizeDeps below), and Vite only
 * rebuilds a pre-bundled dependency when the lockfile or this config changes —
 * never when a linked workspace package's own files change. So adding an export
 * to packages/shared left the browser importing the OLD bundle, and the app
 * died on load with "does not provide an export named …". That happened with
 * describeVideoSource, and it would happen again with every future shared edit.
 *
 * Two halves, because the source can change in two situations:
 *   - while the dev server is STOPPED: on start, the shared files are hashed and
 *     compared with the hash recorded last time; a difference forces a re-bundle.
 *   - while it is RUNNING: the shared folder is watched, and any change restarts
 *     the server with a forced re-bundle.
 */
const SHARED_PACKAGE_DIRECTORY = fileURLToPath(new URL('../../packages/shared', import.meta.url))
const VITE_CACHE_DIRECTORY = fileURLToPath(new URL('./node_modules/.vite', import.meta.url))
const SHARED_HASH_FILE = path.join(VITE_CACHE_DIRECTORY, 'dedal-shared.hash')

function hashSharedPackage() {
  const hash = createHash('sha256')
  const fileNames = readdirSync(SHARED_PACKAGE_DIRECTORY)
    .filter((fileName) => /\.(c?js|json)$/.test(fileName))
    .sort()
  for (const fileName of fileNames) {
    hash.update(fileName)
    hash.update(readFileSync(path.join(SHARED_PACKAGE_DIRECTORY, fileName)))
  }
  return hash.digest('hex')
}

function recordSharedHash(sharedHash) {
  mkdirSync(VITE_CACHE_DIRECTORY, { recursive: true })
  writeFileSync(SHARED_HASH_FILE, sharedHash)
}

function rebundleSharedPackageOnChange() {
  return {
    name: 'dedal-rebundle-shared-package',
    apply: 'serve',
    config() {
      const sharedHash = hashSharedPackage()
      const recordedHash = existsSync(SHARED_HASH_FILE) ? readFileSync(SHARED_HASH_FILE, 'utf8') : null
      if (recordedHash === sharedHash) {
        return undefined
      }
      recordSharedHash(sharedHash)
      return { optimizeDeps: { force: true } }
    },
    configureServer(server) {
      server.watcher.add(SHARED_PACKAGE_DIRECTORY)
      let restartTimer = null
      const handleSharedChange = (changedPath) => {
        if (!path.resolve(changedPath).startsWith(SHARED_PACKAGE_DIRECTORY)) {
          return
        }
        /* Debounced: an editor save can emit several events for one change. */
        clearTimeout(restartTimer)
        restartTimer = setTimeout(() => {
          recordSharedHash(hashSharedPackage())
          server.config.logger.info('[dedal] packages/shared changed — re-bundling it', { timestamp: true })
          server.restart(true)
        }, 150)
      }
      server.watcher.on('change', handleSharedChange)
      server.watcher.on('add', handleSharedChange)
      server.watcher.on('unlink', handleSharedChange)
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), rebundleSharedPackageOnChange()],
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