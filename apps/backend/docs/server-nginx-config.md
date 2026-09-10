# Server nginx configuration — pending changes

Two defects live in the web server's configuration rather than in application
code, so neither can be fixed by a deploy of this repository. Both are one-line
additions to the nginx site that serves `dedal.in`. They are collected here so
they can be applied in a single SSH session.

Verify the current config location first (it is typically
`/etc/nginx/sites-available/dedal.in` symlinked into `sites-enabled`):

```bash
sudo nginx -T | grep -n "server_name dedal.in" -A 40
```

---

## 1. `index.html` must never be cached by the browser (STALE-UI BUG)

**Symptom.** Shipped UI changes are not visible to users on `dedal.in`, often
for hours, while the person who deployed sees them immediately (their hard
refresh masks it). Reported repeatedly by the client.

**Diagnosis (2026-08-01).** The deployed bundle was verified byte-identical to a
fresh local build — the frontend was *not* stale on the server. The cause is
purely in response headers:

```
$ curl -sI https://dedal.in/
Content-Type: text/html
Last-Modified: Sat, 01 Aug 2026 06:38:50 GMT
        ← no Cache-Control header at all
```

With no explicit caching directive but a `Last-Modified` present, browsers apply
*heuristic freshness* — commonly about 10% of the document's age — so a
returning visitor reuses a stale `index.html` without revalidating, and that
window widens as the file ages.

That is fatal in combination with the (otherwise correct) asset policy:

```
$ curl -sI https://dedal.in/assets/index-<hash>.js
Cache-Control: public, max-age=2592000, immutable
```

Content-hashed filenames make `immutable` the right answer **only while
index.html is always fresh**. When it is not, the stale index.html references
the previous bundle hash, which the browser also still holds as immutable, and
the visitor gets an entirely stale application that ordinary refreshing cannot
clear.

**Fix.** Serve the entrypoint with `no-cache` and leave the hashed assets alone:

```nginx
# The SPA entrypoint: never reuse without revalidating. Costs one 304 per
# visit; without it, a stale index.html pins the browser to an old, immutable
# bundle and shipped changes stay invisible for hours.
location = /index.html {
    add_header Cache-Control "no-cache, must-revalidate" always;
}

# Content-hashed assets stay immutable — the filename changes on every build,
# so this is safe AND desirable once index.html is always fresh.
location /assets/ {
    add_header Cache-Control "public, max-age=2592000, immutable" always;
}
```

Cloudflare is not implicated: `cf-cache-status: DYNAMIC` on the document means
the edge is already passing it through. No service worker exists
(`/sw.js` and `/service-worker.js` both 404), so nothing else intercepts fetches.

**Verify after applying:**

```bash
curl -sI https://dedal.in/ | grep -i cache-control
# expect: Cache-Control: no-cache, must-revalidate
```

---

## 2. Razorpay in-app-browser callback POSTs get 405

Cross-referenced from `security-debt.md` (recorded 2026-07-31 during the
"logged out when paying" diagnosis) and repeated here so both server changes are
applied together.

Razorpay's documented in-app-browser flow (`redirect: true` + `callback_url`,
used by `CheckoutScreen` for Instagram/Facebook/Messenger/Opera Mini/UC user
agents) returns the participant by **POSTing** to
`https://dedal.in/payment-processing/:paymentGroupId`. The server answers
`405 Method Not Allowed` for POST on SPA routes (verified with curl; GET on the
same path returns 200). The payment itself succeeds — the webhook confirms it
server-side — but the participant dead-ends on an nginx error page instead of
the processing screen.

```nginx
location / {
    try_files $uri /index.html;
    error_page 405 =200 /index.html;   # Razorpay redirect-flow callback POSTs here
}
```

The SPA ignores the POST body; the processing screen re-reads status by polling,
so serving `index.html` for the POST is sufficient and safe.

**Verify after applying:**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://dedal.in/payment-processing/test
# expect: 200
```

---

Apply both, then `sudo nginx -t && sudo systemctl reload nginx`.

---

## 3. Deploy-script notes

`apps/backend/deploy.ps1` and `apps/frontend/deploy.ps1` are tracked in
version control. Machine-specific values (SSH key path, server IP) live in
`deploy.config.ps1` files (gitignored). Two behaviours that caused "it was
shipped but it isn't live" confusion have been hardened in the scripts:

1. **The two scripts deploy from different sources.** The frontend script builds
   and uploads *this machine's* working tree, so local edits reach production
   even when uncommitted. The backend script runs
   `git reset --hard origin/main` *on the server*, so it can only ship what has
   been **pushed to GitHub** — unpushed commits deploy nothing, while pm2
   restarts cleanly and the health check still passes, making a no-op look like
   a success. The backend script now fetches `origin/main`, lists any unpushed
   commits, and **aborts** rather than performing a silent no-op; it also warns
   about uncommitted files.

2. **The frontend script's verification proved nothing.** It only checked that
   `https://dedal.in` returned 200 — which it does while serving a months-old
   build. It now extracts the content-hashed bundle name from the freshly built
   `dist/index.html`, fetches the live (cache-busted) `index.html`, and fails
   the deploy if the served hash differs from the built one. It also warns when
   `index.html` comes back with no `Cache-Control` header, i.e. while section 1
   of this document is still unapplied.

If these scripts are ever brought into version control, move `$KEY` and
`$SERVER_IP` to environment variables first so no credential path is committed.
