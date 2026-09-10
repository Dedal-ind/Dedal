# Sprint A security pass

Four deferred controls. They are listed together because they are one piece of
work: each is a partial answer to the same question — *what happens when a
credential leaks?* — and shipping any one alone buys less than it looks like it
does. Doing them as a set is the point of this note.

Raised by STEP-AUDIT-01 (findings H1/H3) and deferred by STEP-AUDIT-FIX-05.

---

## 1. QR token rotation — *the deleted control*

**Status: not implemented. The field that implied it has been removed.**

`passes.qrTokenRotatedAt` existed as a `Date` on the schema and was never
written or read by any code. It has been deleted (STEP-AUDIT-FIX-05). The
deletion is not the fix — it removes a lie, nothing more. A schema column named
for a control that does not exist reads to the next author as though rotation
already happens.

**What is actually true today:** a pass's `qrToken` is minted once, at pass
creation, and never changes. Gate entitlements are `maximumUses: null`
(unlimited) for the whole fest window. So a screenshot of anybody's gate QR is a
permanent, unlimited, transferable fest pass, and nothing detects or limits its
reuse.

**What the fix needs:**
- Rotate `qrToken` on a schedule (the pass screen already re-fetches, so the
  client side is close to free).
- Reinstate a rotation timestamp — *when there is code writing it*.
- A short grace where the previous token still scans, or every rotation races
  the person currently at the gate.
- Uniqueness is already enforced by `index_passes_qrToken`; a rotation must go
  through the same insert-and-retry path as `insertPassWithUniqueSecrets`.

**Why it does not stand alone:** rotation limits *how long* a leaked QR works.
It does nothing about the account behind it, which is item 2.

---

## 2. Session invalidation / JWT revocation

**Status: not implemented.**

Tokens are signed with a 30-day expiry (`JWT_EXPIRY_DAYS`, default 30) and there
is no revocation list, no token version on the user, and no sign-out-everywhere.
A JWT, once issued, is valid for its full life no matter what happens to the
account. Blocking a user (`isBlocked`) stops them at the service checks that read
the flag, but does not invalidate any token already in their hands.

**What the fix needs:** a per-user token version or a revocation store checked in
`authentication-middleware`, bumped on sign-out-everywhere, on block, and on the
incident path in item 4.

**Why it does not stand alone:** without this, item 1 rotates the QR while the
session that can re-read the new QR stays valid.

---

## 3. Real per-user rate limits

**Status: deliberately removed, and still removed.**

Rate limiting was removed wholesale in STEP-D12-HOTFIX-RATE-LIMIT because the
devtunnel puts the whole team behind one IP, so an IP bucket produced cascading
429s during testing. That was the right call for a tunnel and is the wrong state
to run a real fest in.

The OTP resend cooldown (`OTP_RESEND_COOLDOWN_SECONDS`, 60s, per email) was
deliberately kept and is **not** what this item is about.

**What the fix needs:** limits keyed on the authenticated user, not the source
IP — which is the thing the tunnel broke. Scan endpoints and OTP request are the
ones that matter. Note `TRUST_PROXY_HOPS` is already configured, so a real
deployment can recover the client IP if a second dimension is wanted.

**Why it does not stand alone:** without limits, a leaked QR or token can be
brute-forced or replayed at machine speed, which shrinks items 1 and 2 to
decoration. The 6-digit `backupCode` is the sharpest case: unlimited guesses
against a 10^6 space is not a secret.

---

## 4. Stolen-phone incident response

**Status: no path exists.**

There is no way for a participant or an administrator to say "this device is
gone". No pass invalidation, no re-issue, no way to revoke the entitlements
already on it. Today the honest answer to a stolen phone is: that person's pass
works for whoever holds it, until the fest ends.

**What the fix needs:** an admin (and ideally self-service) action that, in one
step, rotates the `qrToken` (item 1), issues a new `backupCode`, revokes the
active session (item 2), and writes an audit entry. The entitlements themselves
should survive — they belong to the person, not the device.

**Why it is last:** it is the one that needs all three others to exist, and it is
the only one a user will ever ask for by name.

---

## Ordering

3 → 2 → 1 → 4. Rate limits first because they are the cheapest and they cap the
blast radius of everything else. Revocation next, because rotation without it
leaves the session that fetches the new token. Rotation third. The incident path
last, because it is the composition of the other three and is not worth building
twice.

- Multi-use offer claims (offerClaim entitlements, phase 2 of admin-defined offers) raise the value of the non-rotating qrToken debt above: a forwarded pass screenshot now lets someone else collect a participant's booked meals at an offer counter, not just walk a gate. Rotation is still the fix; unchanged here.

---

## Deliberate non-builds: destructive operations we chose NOT to offer

Both of these were asked for by the client in words that sound like features.
Neither is an oversight, and each is recorded here with the trade-off so the
decision can be revisited on purpose rather than rediscovered by accident.

### 1. Fest HARD DELETE — not built. Archive and Cancel cover the real intents.

**What the client asked for:** the ability to "delete a fest".

**What exists instead:** two operations, either of which is probably what was
meant.
- **Archive** (`POST /fests/:festId/archive`) hides the fest from participants
  while preserving every registration, pass, scan and audit row — all still
  readable in Data Controls. Reversible via Unarchive, which returns the fest to
  DRAFT.
- **Cancel** (`POST /fests/:festId/cancel`) calls the fest off: every event
  cascades, every participant is emailed once, every held seat ends, and captured
  payments are marked refund-pending. Irreversible by design.

**Why a hard delete is not there:** this codebase deletes nothing historical, as
a matter of policy rather than convenience. Scan rows, audit rows, consent
records, certificates and match rows are all append-only or
superseded-not-deleted; staff assignments have a model-level hook that *refuses*
deletion outright. A fest delete would have to walk and purge every dependent
collection — registrations, passes, entitlements, scans, payment orders,
certificates, audit logs, consent records, contingents and their claims — and
then answer a question none of the read paths currently have an answer for: what
does an audit-log query about a fest that no longer exists return? "This fest was
deleted" is a different answer from "no such fest id", and only one of them is
compatible with an audit trail meaning anything.

**The trade-off, plainly:** we trade the ability to make a fest vanish for the
guarantee that no participant's record of what they paid for and where they
scanned can be erased by an admin action. For a platform that handles money and
attendance, that is the right side of the trade.

**Open question for the client:** is "archive is sufficient" an acceptable
answer? If yes, this is closed. If a genuine purge is required — most plausibly
for a data-retention or right-to-erasure obligation rather than for tidiness —
that is a separate spec, and it needs the audit-query answer decided first.

### 2. Automated Razorpay refunds — not built. Marker-and-manual is the pattern.

**What the client asked for:** money back when something is cancelled.

**What exists instead:** every cancellation path that finds captured money sets
`PAYMENT_ORDER_STATUSES.REFUND_PENDING` on the payment order and writes a
`payment.refundPending` audit row carrying the payment group, registration,
amount and what initiated it. An operator then refunds from the Razorpay
dashboard. This is the same pattern contingent cancellation established, and
event and fest cancellation now reuse it rather than inventing a parallel one.

**Why the API call is not there:** `services/razorpay-client.js` creates orders
and nothing else — there is no refund call anywhere in the codebase, and adding
one is not a small change. It needs, in order:
1. **A client-approved refund policy.** Full or partial? Are platform fees and
   GST deducted or absorbed? Is a cancelled-by-organiser refund treated
   differently from a participant who walked away? Is a credit note against a
   future fest acceptable instead of cash back? Nothing in the product answers
   these, and the API call cannot be written before they are answered — the
   amount to refund is a policy decision, not a technical one.
2. **A webhook handler for Razorpay's refund lifecycle** (`refund.created`,
   `refund.processed`, `refund.failed`), because a refund is asynchronous and a
   marker that says "refunded" before the gateway agrees is worse than no marker.
3. **A participant-facing refund status** on the registration row, or the
   participant learns the outcome only by watching their bank account.

**The trade-off:** manual refunds cost operator time and scale badly past a few
dozen. In exchange, no automated path can move real money on the strength of an
unreviewed policy assumption. Until the policy exists, the marker is the honest
implementation.

---

## PURGE_TEST_TOOL — the dev-only fest purge (must be removed at handover)

**What it is:** `DELETE /api/v1/fests/:festId/purge` hard-deletes one fest and
every row under it. It exists because the team tests against a live-connected
Atlas database and would otherwise be deleting documents by hand in Compass.

**It is the single exception to the delete-nothing policy above, and it is
bounded on every side:**
- **Environment-gated at the ROUTE**, ahead of authentication. Outside
  `development` / `staging` / `test` the request is refused with 403
  `PURGE_NOT_ALLOWED_IN_ENVIRONMENT` having touched no data. There is no code path
  from a production request to a delete.
- **One fest per request.** There is deliberately no purge-all endpoint: the blast
  radius of one accidental request must never exceed one fest.
- **Rate limited** to 5 purges per administrator per rolling hour, so a
  misconfigured integration test looping cannot drain the database.
- **Consent records are never purged.** They are compliance evidence about a
  PERSON, not data about a fest, and must outlive anything an admin can delete.
- **The audit row is written FIRST** (`test.festPurged`, with per-collection
  counts) and is explicitly excluded from the audit-log deletion, so it survives
  as the only record that the fest ever existed.
- **Strong UI ceremony:** dev/staging only (feature-detected from
  `GET /api/v1/health/environment`, never from the hostname), per-collection
  counts shown before confirming, and a verbatim typed `PURGE <fest name>`.
- **One accountability bypass, narrowly marked.** `staff-assignment-model.js`
  normally refuses deletion outright; the purge passes `{ allowTestPurge: true }`
  per query. Nothing in the production path sets it, and deleting the marked block
  restores the invariant absolutely.

**Removal at handover — one commit.** Every attachment point carries the literal
marker `PURGE_TEST_TOOL` with the comment "Test tool — remove at handover. Grep
PURGE_TEST_TOOL." Run `npm run assert:no-test-tools` (backend) to list them; it
exits non-zero while any remain, and it is intended as a pre-release / CI gate on
the release branch. As of writing the attachment points are:

| File | Purpose |
| --- | --- |
| `backend/src/services/fest-purge-service.js` | the whole service — delete the file |
| `backend/src/middleware/require-purge-environment-middleware.js` | the environment gate — delete the file |
| `backend/src/routes/fest-routes.js` | two route registrations + imports |
| `backend/src/controllers/fest-controller.js` | two handlers + import + exports |
| `backend/src/constants/error-codes.js` | `PURGE_NOT_ALLOWED_IN_ENVIRONMENT`, `PURGE_RATE_LIMITED` |
| `backend/src/constants/audit-log-constants.js` | `TEST_FEST_PURGED` |
| `backend/src/models/staff-assignment-model.js` | the `allowTestPurge` bypass block |
| `backend/src/services/fest-cancellation-service.js` | one cross-reference comment only |
| `backend/tests/integration/fest-purge-test-tool.integration.test.js` | the suite — delete the file |
| `apps/frontend/src/helpers/deployment-environment.js` | feature detection — delete the file |
| `apps/frontend/src/screens-admin/admin-event-access/AdminEventAccessScreen.jsx` | button, modal branch, counts panel, state, probe |
| `apps/frontend/src/brand-admin/brand-copy.js` | the purge copy block |

`GET /api/v1/health/environment` may stay: it is a harmless, non-destructive
read that other clients may legitimately want.

---

## Deploy-side bug: Razorpay redirect callback POST gets 405 (NOT fixable in code)

Discovered 2026-07-31 while diagnosing the "logged out when paying" report.
Razorpay's documented in-app-browser flow (`redirect: true` + `callback_url`,
used by CheckoutScreen for Instagram/Facebook/Messenger/Opera Mini/UC user
agents) returns the participant by **POSTing** the payment result to
`https://dedal.in/payment-processing/:paymentGroupId`. The production web
server currently answers `405 Method Not Allowed` for POST on SPA routes
(verified live with curl on 2026-07-31; GET on the same path returns 200).
Every in-app-browser payment therefore dead-ends on an nginx error page after
paying — the money is captured (the webhook still confirms it server-side) but
the participant never sees the processing/success screen.

Fix is deployment configuration, not application code — in the frontend
server's nginx site config, let POST fall through to the SPA entrypoint:

```nginx
location / {
  try_files $uri /index.html;
  error_page 405 =200 /index.html;   # Razorpay redirect-flow callback POSTs here
}
```

(or the equivalent `if ($request_method = POST) { rewrite ^ /index.html last; }`
inside the SPA location). The SPA ignores the POST body; the processing screen
re-reads status by polling, so serving index.html for the POST is sufficient
and safe. Owner: deploy config is intentionally left to the project owner.
