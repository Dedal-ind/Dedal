# Contact-number coverage across registration paths

The client's requirement: **a contact number must be on file for every
participant of a team event, not only the person who created the team.**

There is deliberately no second phone field on the registration form. The number
is captured once, at profile completion, where `phoneNumber` is required —
`isProfileComplete` is `Boolean(fullName && collegeId && usn && phoneNumber)`
(see `user-model.js`). A second input on the form would be a divergence point
with nothing keeping the two in step.

The guarantee therefore rests on one question: **does every path that seats a
participant require a complete profile?**

## Audit result (2026-08-01)

| Entry point | Guard | Contact number guaranteed |
| --- | --- | --- |
| Solo registration | `loadRegisterableUser` (solo-registration-service) | Yes |
| Paid registration confirmation | seat already created under the solo/team guard | Yes |
| Team **create** (leader) | `loadRegisterableUser` (team-service:123) | Yes |
| Team **code join** (joiner) | `loadRegisterableUser` (team-service:231) | Yes |
| Contingent claim **accept** (attendee) | `loadRegisterableUser` (contingent-claim-service:208) | Yes |
| Team **email roster** (`POST /events/:eventId/registrations/team`) | `isBlocked` only | **NO — see below** |

Five of the six paths refuse an incomplete profile with `403
PROFILE_INCOMPLETE` before any seat, pass or entitlement exists. The team code
join in particular — the one the participant UI actually uses to add teammates —
was already closed; no change was needed there.

## The open gap: the email-roster path

`resolveMembers` (`helpers/team-roster-helpers.js`) calls
`findOrCreateUserByEmailAddress`, which **mints a placeholder user** for an
address that has never signed in, and checks only `isBlocked`. The caller then
runs `ensurePassAndEventEntitlement` for every member, so that placeholder ends
up holding a pass and a door entitlement with no phone number and possibly no
name.

Two partial mitigations already narrow it:

- For an **intraCollege** fest, `assertTeamCollege` rejects a member with no
  college, which incidentally catches most brand-new placeholders. The gap is
  therefore widest on **interCollege and public** fests.
- The participant UI does **not** use this endpoint — `RegistrationFormScreen`
  deliberately uses create-team plus an invite code instead. The exposure is via
  the API, not the shipped flow.

It is pinned by a test that asserts the CURRENT behaviour
(`tests/integration/pass-email.integration.test.js`, "the team ROSTER path is
the one gap"), so whichever option below is chosen, the change fails loudly here
and is made deliberately.

## Options — needs a product decision

**Option 1 — refuse incomplete members (strictest, matches the other five paths).**
Add to `resolveMembers`, next to the `isBlocked` check:

```js
if (!user.isProfileComplete) {
  throw new ApplicationError(
    403,
    ERROR_CODES.PROFILE_INCOMPLETE,
    "Every team member must complete their Dedal profile (including a contact number) before they can be added.",
    { incompleteMemberEmail: email }
  );
}
```

Cost: this **disables inviting a teammate who has no Dedal account yet** on that
endpoint — an intended, currently tested feature (`registration-team.integration.test.js`,
"registers a team, creates placeholders, and emails teammates"). Those tests
would need updating. Named teammates would have to sign in, complete their
profile, and join with the team code — which is exactly what the UI already does.
This was implemented and then reverted during this work precisely because it
changes product behaviour rather than fixing a defect: 17 existing tests failed.

**Option 2 — invite, but do not seat, until the profile is complete.**
Keep placeholder creation and the invitation email, but skip
`ensurePassAndEventEntitlement` for a member whose profile is incomplete, so no
one holds a pass without a contact number. Requires new machinery that issues
the pass later, when that member completes their profile — otherwise they stay
on the roster permanently passless.

**Recommendation: Option 1.** It makes the guarantee universal with a five-line
change, it matches every other entry point, and it removes a path the product
does not use. Option 2 is more forgiving but needs a backfill trigger that does
not exist today, which is a larger and more failure-prone build.
