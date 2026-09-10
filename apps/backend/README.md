# Dedal — Backend

Node.js + Express + Mongoose. Local MongoDB for dev.

## Requirements

- Node.js v20 or newer.
- MongoDB Community Server running locally on default port 27017.
  (Not Atlas — Atlas is only for the hosted environment.)

## First-time setup

1. Install MongoDB Community Server. Ensure the Windows service is set to
   Automatic startup so it survives reboot.
2. Clone this repo. `cd backend`.
3. `npm install`.
4. Copy `.env.example` to `.env` and fill in `DATABASE_URI`. For local Mongo
   the default URI is:

   ```
   mongodb://127.0.0.1:27017/festAppMvp
   ```

   Use `127.0.0.1` explicitly, not `localhost` — Windows can resolve
   `localhost` via IPv6 which mongod doesn't listen on.
5. `npm run dev`. You should see:

   ```
   Database connected
   Server listening on port 5000
   ```

## Scripts

- `npm run dev`   — nodemon, restarts on file changes
- `npm start`     — plain node

## Endpoints (as of Day 2 — update this line as we add more)

- `GET /api/v1/health` — liveness check

## Conventions

See `NAMING-CONVENTIONS.md` at the repo root. Follow it for every new file.
PR reviews reject naming violations.

## Troubleshooting

- **`ECONNREFUSED 127.0.0.1:27017`** — mongod isn't running. Start it or check
  the Windows service.
- **`Missing required environment variables`** — `.env` is missing or a key is
  misspelled.
- **`querySrv EBADNAME`** — you used a `mongodb+srv://` URI without a real
  Atlas host. Use the local `mongodb://` URI in dev.
