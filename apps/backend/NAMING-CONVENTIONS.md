# Dedal — Naming Conventions

This document is living. When a new convention decision is made, add it here
in the same commit. It is the single source of truth for both the backend and
the frontend projects. PR reviews reject naming violations.

---

## 1. The single most important rule — full readability, no abbreviations

Names are written in full. A name should read like prose to someone who has
never seen the code. We optimise for the reader, not the typist — the editor
autocompletes, the reader does not.

Write `applicationConfig`, not `appCfg`. Write `connectToDatabase`, not
`connDb`. Write `errorHandlerMiddleware`, not `errHandler`.

**Allowed acronyms** (well-known, treated as words): `id`, `url`, `api`,
`pdf`, `jwt`, `otp`, `qr`, `usn`, `aishe`.

**Explicitly banned** as filenames or variable names: `db`, `req`, `res`,
`cfg`, `err`, `conn`, `msg`, `tmp`, `val`.

**One exception:** `req` and `res` are permitted *only* inside Express route
handler signatures, because they are the framework's universal convention and
every Express developer recognises them instantly. Everywhere else — including
filenames like `database-config.js` (never `db-config.js`) — the full word is
required. In this repo we go one step further and prefer `request` / `response`
in our own middleware signatures (cf. `error-handler-middleware.js`,
`not-found-handler-middleware.js`); `req`/`res` remain acceptable in ordinary
route handlers.

---

## 2. Universal casing table

| Thing                     | Casing                    | Example                        |
| ------------------------- | ------------------------- | ------------------------------ |
| JavaScript variables      | camelCase                 | `applicationPort`              |
| JavaScript functions      | camelCase                 | `connectToDatabase`            |
| React components          | PascalCase                | `HelloScreen`                  |
| Classes                   | PascalCase                | `EmailService`                 |
| Constants                 | UPPER_SNAKE_CASE          | `ERROR_CODES`                  |
| Backend files             | kebab-case + role suffix  | `database-connection.js`       |
| React component files     | PascalCase.jsx            | `HelloScreen.jsx`              |
| Hook files                | useCamelCase.js           | `usePassScanner.js`            |
| Helper/utility files      | kebab-case.js             | `api-client.js`                |
| Environment variables     | UPPER_SNAKE_CASE          | `DATABASE_URI`                 |
| **MongoDB collections**   | plural camelCase          | `users`, `festEvents`          |
| **MongoDB fields**        | camelCase                 | `createdAt`, `isActive`        |
| **MongoDB indexes**       | index_{collection}_{fields} | `index_users_emailAddress`   |
| API URL paths             | kebab-case, versioned     | `/api/v1/health`               |
| API path params           | camelCase                 | `:festId`, `:eventId`          |
| JSON keys                 | camelCase                 | `successCount`                 |

---

## 3. File naming — backend

Backend JavaScript files are **kebab-case with a role suffix** so a file's
responsibility is obvious from its name alone. Recognised role suffixes:
`controller`, `service`, `model`, `routes`, `middleware`, `validator`,
`helpers`, `config`, `connection`, `codes`.

Files that already follow this in the repo today:

- `src/config/application-config.js`   — config role
- `src/config/database-config.js`      — config role
- `src/database/database-connection.js`— connection role
- `src/middleware/error-handler-middleware.js` — middleware role
- `src/routes/health-routes.js`        — routes role
- `src/constants/error-codes.js`       — codes role

Never `dbConfig.js`, `errorHandler.js`, `asyncHandler.js` (camelCase),
never `db-config.js` (abbreviation).

---

## 4. Variable naming

- **Be specific.** `participantEmailAddress`, not `email` when ambiguous.
- **Booleans** start with `is` / `has` / `can` / `should`:
  `isActive`, `hasCheckedIn`, `canScan`, `shouldRetry`.
- **Collections are plural:** `festEvents`, `participants`,
  `requiredEnvironmentVariables` (cf. `application-config.js`).
- **No single-letter loop variables.** Use `event`, `participant`, `index`.
- **Suffix rules:** counts end in `Count` (`successCount`); identifiers end
  in `Id` (`festId`); dates/times end in a time word (`createdAt`,
  `expiresAt`); durations end in `Milliseconds`.
- **Money** is stored in paise as an integer (`amountPaise`) — deferred until
  payments enter the project, but the rule is fixed now.

---

## 5. Function naming

Functions start with a verb describing what they do.

| Verb       | Use for                                  |
| ---------- | ---------------------------------------- |
| `get`      | return a value, no side effects          |
| `fetch`    | retrieve over the network / from Mongo   |
| `create`   | make and persist a new thing             |
| `update`   | modify an existing thing                 |
| `delete`   | remove a thing                           |
| `connect`  | establish a connection                   |
| `validate` | check and throw on invalid input         |
| `handle`   | respond to an event / error              |
| `format`   | turn a value into a display string       |

- Async functions do **not** carry an `Async` suffix — `connectToDatabase`,
  not `connectToDatabaseAsync`.
- React event handlers: implementation is `handle*` (`handleToggleRow`),
  the prop passed in is `on*` (`onClear`, `onArchive`).

---

## 6. React components

- One component per file. File name (PascalCase.jsx) **equals** the exported
  component name — `HelloScreen.jsx` exports `HelloScreen`.
- Props are camelCase.
- Custom hooks use the `use` prefix and live in `useCamelCase.js` files.

---

## 7. API URLs

- Lowercase kebab-case, always versioned under `/api/v1/...`.
- Path parameters are camelCase: `/api/v1/fests/:festId/events/:eventId`.
- Today's only route: `GET /api/v1/health`.

---

## 8. JSON keys and response envelopes

All JSON keys are camelCase. Every response uses one of two envelopes:

```jsonc
// Success
{ "data": { "status": "ok", "timestamp": "2026-07-07T13:57:05.294Z" } }

// Error
{ "error": { "code": "ROUTE_NOT_FOUND", "message": "Route not found.",
             "details": { } } }
```

Error `code` values are UPPER_SNAKE_CASE string constants, stable over time,
because the frontend switches on them. They live in `src/constants/error-codes.js`.

---

## 9. MongoDB specifics

- Collection names are **plural camelCase**: `users`, `festEvents`, `passes`.
- Field names are **camelCase**: `emailAddress`, `isActive`.
- **No dots or dollar signs** in field names.
- `_id` is always the primary key. References use a descriptive name plus
  `Id`: `userId`, `festId` — never a bare `id` for a foreign reference.
- Timestamps are camelCase `createdAt` / `updatedAt`, produced by the Mongoose
  schema option `timestamps: true` (not hand-rolled).
- Indexes are named `index_{collection}_{fields_joined_by_underscore}`, e.g.
  `index_users_emailAddress`, `index_passes_festId_participantId`.

---

## 10. Environment variables

UPPER_SNAKE_CASE, prefixed by concern:

- `APPLICATION_*` — `APPLICATION_PORT`, `APPLICATION_ENVIRONMENT`
- `DATABASE_*`    — `DATABASE_URI`
- `JWT_*`         — `JWT_SECRET`, `JWT_EXPIRY_DAYS`
- `EMAIL_*`       — `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`
- `RESEND_*`      — `RESEND_API_KEY`

Duration variables carry their unit, per §4 — hence `JWT_EXPIRY_DAYS`, not
`JWT_EXPIRY`.

The `EMAIL_SMTP_*` namespace existed so a future non-SMTP sender would not have
to squat on the generic names. That sender arrived: delivery now goes through
Resend's HTTP API, the `EMAIL_SMTP_*` variables are gone, and `EMAIL_*` is left
holding only what every transport needs — the sender identity.

`RESEND_API_KEY` is a deliberate exception to prefix-by-concern: a provider
credential is named for its provider, so swapping providers adds a new variable
rather than silently changing what an existing one means. Its PRESENCE selects
the transport (see `services/email-service.js`), which is the same pattern the
S3 upload driver uses.

`application-config.js` fails fast when any of these is missing, except
`JWT_EXPIRY_DAYS` (defaults to 30), `EMAIL_FROM_NAME` and `RESEND_API_KEY`
(both optional — absent, development prints mail to the console).

---

## 11. Git branches

`type/kebab-case-description`. Allowed types: `feature`, `fix`, `refactor`,
`chore`, `documentation`, `test`. Example: `feature/participant-pass-scanning`.

---

## 12. Commit messages

Conventional Commits: `type(scope): message`. Example:
`feature(health): add liveness endpoint`. Same type vocabulary as branches.

---

## 13. Anti-pattern table

| Anti-pattern                     | Instead                          |
| -------------------------------- | -------------------------------- |
| `dbConfig.js`                    | `database-config.js`             |
| `errHandler`, `errorHandler.js`  | `error-handler-middleware.js`    |
| `data`, `info`, `temp`, `obj`    | a specific noun                  |
| `flag`, `status` (as boolean)    | `isActive`, `hasCheckedIn`       |
| `getData()`                      | `fetchParticipants()`            |
| `email` (ambiguous scope)        | `participantEmailAddress`        |
| snake_case JSON keys             | camelCase JSON keys              |
| unversioned `/api/health`        | `/api/v1/health`                 |

---

## 14. Domain glossary

Use these words and only these — do not invent synonyms.

- **Fest** — the top-level event container.
- **Event** — a single activity inside a fest (Robowars, Hackathon).
- **Match** — one round of a bracket event.
- **Participant** — a person registered for one or more events.
- **Coordinator** — staff running specific events.
- **Volunteer** — staff scanning at assigned events.
- **Administrator** — college staff who created the fest.
- **Pass** — the per-fest QR credential a participant carries.
- **Entitlement** — what a pass may do at a checkpoint.
- **Scan** — one recorded check-in/out event.
- **USN** — Karnataka University Seat Number (e.g. `1RV22CS042` = RVCE, 2022
  intake, CS branch, roll 042).
- **AISHE code** — All India Survey on Higher Education college identifier
  (e.g. `C-11566`).
