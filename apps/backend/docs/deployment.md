# Deployment

The backend and frontend are a single pnpm workspace monorepo. The server
has one clone of this repository; both deploy scripts operate against it.

Machine-specific values come from `deploy.config.ps1` files (gitignored)
alongside each deploy script. See the `.example` files for every value.

---

## Backend deploy (`apps/backend/deploy.ps1`)

1. **Pre-flight** — verifies the SSH key exists and the server is reachable.
2. **Push check** — fetches `origin/main` and compares it to the local HEAD.
   The backend deploys from the *remote* branch, not the local working tree,
   so unpushed commits silently ship nothing. The script refuses to continue
   if commits exist locally that are not on `origin/main`.
3. **Confirmation prompt** — requires typing `YES`.
4. **Fetch and reset** — SSHs in, `cd` to the repository root
   (`DEPLOY_REPO_REMOTE_PATH`), `git fetch origin main && git reset --hard origin/main`.
5. **Install** — `pnpm install --filter fest-app-backend... --frozen-lockfile --prod`
   from the repository root. The `...` suffix includes the backend's
   workspace dependencies (`@dedal/shared`). If this fails, the script
   stops — PM2 is never restarted with a broken dependency tree.
6. **Migrations** — `node scripts/deploy-migrate.js` from `apps/backend/`.
   Seeds the policy registry from bundled text (idempotent — skips kinds
   that already have an effective version) and then asserts every kind has
   one. If this fails, the script stops — PM2 is never restarted into a
   refusal loop.
7. **PM2 restart** — `pm2 restart <process> --update-env && pm2 status`.
8. **Health check** — polls the health endpoint (up to 5 attempts, 3 s apart)
   for a 200 containing `"ok"`.

### Policy registry ordering constraint

The backend **refuses to start** unless every legal-document kind has exactly
one effective, hashed version in the policy registry (see
`src/helpers/policy-registry-boot.js`). The deploy-migrate script handles
this automatically by seeding from the bundled policy text under
`apps/backend/policies/`. In development the same seeding happens at boot.

If you need to publish a specific version manually (e.g. with new wording
that differs from the bundled text):

```
ssh <server> "cd <repo-path>/apps/backend && \
  node scripts/publish-policy-version.js -- \
    --kind termsOfService --label 2026-09 --effective 2026-09-07"
```

Current kinds: `termsOfService`, `privacyPolicy` (defined in
`src/constants/consent-constants.js`, `POLICY_DOCUMENT_KINDS`).

## Frontend deploy (`apps/frontend/deploy.ps1`)

The frontend builds locally and uploads the dist via SCP. It does not pull
code on the server and is unaffected by the monorepo consolidation — the
nginx root and remote dist path stay exactly where they are.

1. **Pre-flight** — verifies the SSH key, `package.json`, and
   `.env.production` exist.
2. **SSH check** — verifies the server is reachable.
3. **Local build** — `npm run build` (Vite). Fails if no `dist/index.html`.
4. **Confirmation prompt** — requires typing `YES`.
5. **Clear remote** — removes old assets, index, SVGs and JPEGs from the
   remote dist directory via SSH.
6. **Upload** — `scp -r dist/* <server>:<remote-path>/`.
7. **Bundle verification** — fetches the public URL (cache-busted) and
   compares the Vite content-hashed bundle filename against the local build.
   A mismatch means the upload did not take effect (wrong remote path or
   nginx not pointing at it).
8. **Cache-Control warning** — warns if `index.html` is served without a
   `Cache-Control` header, which causes the stale-UI problem documented in
   `server-nginx-config.md`.

---

## Configuration values

### Backend (`apps/backend/deploy.config.ps1`)

| Variable | Description |
|---|---|
| `DEPLOY_SSH_KEY_PATH` | Absolute local path to the SSH private key |
| `DEPLOY_SERVER_IP` | IP or hostname of the deploy target |
| `DEPLOY_SERVER_USER` | SSH user on the server |
| `DEPLOY_REPO_REMOTE_PATH` | Server path to the **repository root** (not `apps/backend`) |
| `DEPLOY_PM2_PROCESS_NAME` | PM2 process name to restart |
| `DEPLOY_BACKEND_HEALTH_URL` | Health endpoint URL |
| `DEPLOY_PNPM_PATH` | Absolute path to the pnpm binary on the server |

### Frontend (`apps/frontend/deploy.config.ps1`)

| Variable | Description |
|---|---|
| `DEPLOY_SSH_KEY_PATH` | Absolute local path to the SSH private key |
| `DEPLOY_SERVER_IP` | IP or hostname of the deploy target |
| `DEPLOY_SERVER_USER` | SSH user on the server |
| `DEPLOY_FRONTEND_REMOTE_PATH` | Server path where nginx serves the frontend dist |
| `DEPLOY_FRONTEND_VERIFY_URL` | Public frontend URL for bundle verification |

---

## Staging environment

Set `APPLICATION_ENVIRONMENT=staging` in the backend `.env` and
`VITE_APP_ENVIRONMENT=staging` in the frontend `.env` / `.env.production`.

### What staging enforces

| Guard | Behaviour |
|---|---|
| **Email** | Suppressed for every address **not** in `STAGING_EMAIL_ALLOWLIST` (comma-separated). Empty list = all email suppressed (fail closed). Suppressed sends are logged as `[email:staging-suppressed]` and return success to the caller. |
| **Razorpay** | The backend **refuses to boot** if `RAZORPAY_KEY_ID` is set and does not start with `rzp_test_`. Absent keys are fine (payment features degrade gracefully). |
| **Master OTP** | **Not available** in staging. The `000000` code is gated on `APPLICATION_ENVIRONMENT=development` only — there is no env var to toggle it, so a misconfigured flag cannot enable it outside development. |
| **S3** | The backend **refuses to boot** if `S3_BUCKET_NAME` is set and `PRODUCTION_S3_BUCKET_NAME` is unset (cannot verify isolation) or the two values match (would write into production storage). Absent S3 keys are fine (uploads use local disk). |
| **Frontend banner** | A sticky amber bar appears at the top of every page for any non-production environment. The label is fetched from the server's `/health/environment` endpoint at runtime — a build made without `VITE_APP_ENVIRONMENT` still shows the banner if the server reports staging. Unknown/unreachable environments show "UNKNOWN ENVIRONMENT" (fail closed). |
| **Purge test tool** | Allowed in staging (and development/test), blocked in production. |
| **Database seeding** | All seed scripts refuse to run — they require `APPLICATION_ENVIRONMENT=development`. |

### Staging `.env` checklist

```
APPLICATION_ENVIRONMENT=staging
DATABASE_URI=<staging database — NOT the production URI>
RAZORPAY_KEY_ID=rzp_test_...        # test key, or omit entirely
RAZORPAY_KEY_SECRET=<test secret>
STAGING_EMAIL_ALLOWLIST=you@example.com,teammate@example.com
S3_BUCKET_NAME=<staging bucket>
PRODUCTION_S3_BUCKET_NAME=<production bucket name — so the boot check can verify they differ>
```

---

## One-time server migration to the monorepo

These steps move the server from two separate clones to one consolidated
repository. They touch the server directly and should be run in a
maintenance window. Read the whole list before starting.

**Pre-requisites on your local machine:**
- The consolidated repository is pushed to GitHub with a remote the server
  can reach.
- You have your `deploy.config.ps1` files updated with the new values
  (`DEPLOY_REPO_REMOTE_PATH`, `DEPLOY_PNPM_PATH`, and `DEPLOY_BACKEND_REMOTE_PATH`
  removed).

**On the server (in order):**

1. **Install pnpm.** The backend's workspace dependency (`@dedal/shared`)
   requires pnpm — npm cannot resolve `workspace:*` references.
   ```bash
   curl -fsSL https://get.pnpm.io/install.sh | sh -
   ```
   Note the absolute path it installs to (e.g. `/home/ubuntu/.local/share/pnpm/pnpm`
   or `/usr/local/bin/pnpm`). This is the value for `DEPLOY_PNPM_PATH`.
   Verify: `<pnpm-path> --version`

2. **Clone the consolidated repository.**
   ```bash
   cd /home/ubuntu
   git clone https://github.com/<org>/<repo>.git dedal
   ```
   This creates `/home/ubuntu/dedal` — the value for `DEPLOY_REPO_REMOTE_PATH`.

3. **Copy the backend `.env` from the old clone.**
   ```bash
   cp /home/ubuntu/Management-backend/.env /home/ubuntu/dedal/apps/backend/.env
   ```

4. **Install backend dependencies.**
   ```bash
   cd /home/ubuntu/dedal
   <pnpm-path> install --filter fest-app-backend... --frozen-lockfile --prod
   ```

5. **Run deploy migrations.**
   ```bash
   cd /home/ubuntu/dedal/apps/backend
   node scripts/deploy-migrate.js
   ```
   This must print "Policy registry OK." If it fails, fix the issue before
   continuing — the backend will refuse to start without it.

6. **Update the PM2 process to point at the new location.**
   ```bash
   pm2 stop festpass-backend
   pm2 delete festpass-backend
   cd /home/ubuntu/dedal/apps/backend
   pm2 start server.js --name festpass-backend --update-env
   pm2 save
   ```

7. **Verify the backend is healthy.**
   ```bash
   curl -s https://dedal.in/api/v1/health
   ```
   Must return `{"status":"ok",...}`.

8. **Verify the frontend still works.** The frontend dist path
   (`/home/ubuntu/festpass-frontend-git/dist`) and nginx config are
   unchanged. Load `https://dedal.in` in a browser to confirm.

9. **Archive the old clones** (do not delete yet — keep them for rollback).
   ```bash
   mv /home/ubuntu/Management-backend /home/ubuntu/Management-backend.archived
   mv /home/ubuntu/festpass-frontend-git /home/ubuntu/festpass-frontend-git.archived
   ```
   Delete them after the new setup has been stable for a week.

**Rollback if something goes wrong at any step:**
- Stop the new PM2 process: `pm2 stop festpass-backend && pm2 delete festpass-backend`
- Restart from the old clone: `cd /home/ubuntu/Management-backend && pm2 start server.js --name festpass-backend`
- The frontend is unaffected — its nginx root never moved.

---

## What did NOT change on the server

| Item | Status |
|---|---|
| PM2 process name (`festpass-backend`) | Unchanged |
| Frontend dist path (`/home/ubuntu/festpass-frontend-git/dist`) | Unchanged |
| nginx configuration | Unchanged |
| Health endpoint URL | Unchanged |
| SSH key, user, IP | Unchanged |
| Frontend deploy flow (local build → SCP) | Unchanged |
