// seed-my-certificates.js
// DEVELOPMENT FIXTURE. Gives one participant a certificate of every type, so
// the redesigned /my-certificates grid and /my-certificates/:id detail can be
// looked at against real content instead of an empty state.
//
// WHY EVERY TYPE, AND WHY ACROSS TWO FESTS.
//
// The list groups by fest and gives winners a wider tile than participation.
// Neither of those is visible with one certificate, and neither is visible with
// five certificates that are all the same type — the grid only proves it works
// when a full-width winner sits directly above a two-column pair, inside a fest
// section, with a second fest section under it. So the fixture deliberately
// spreads eight certificates across two fests and includes:
//
//   · all three winner ranks, because the badge reads from metadata.position
//     and a wrong rank is invisible until you see 1st/2nd/3rd side by side
//   · specialMention, which is in the server enum but which NO generation path
//     currently produces — the UI still has to render it, and this is the only
//     way to see that it does
//   · a fest-level staff certificate with eventId: null, which is the shape
//     that breaks a tile that assumes an event name exists
//   · a certificate whose metadata.usn is absent, because the details table
//     hides that row rather than printing an empty one
//
// Idempotent: the model has a unique compound index on
// { userId, festId, eventId }, so a rerun updates in place rather than
// duplicating. Codes are only generated for genuinely new rows, so a code you
// have already opened in a browser tab keeps working across reruns.

require("dotenv").config();
const mongoose = require("mongoose");

const { CertificateModel } = require("../src/models/certificate-model");
const { UserModel } = require("../src/models/user-model");
const { FestModel } = require("../src/models/fest-model");
const { EventModel } = require("../src/models/event-model");
const { generateVerificationCode } = require("../src/helpers/generate-verification-code");
const {
  CERTIFICATE_TYPES,
  CERTIFICATE_STATUSES,
} = require("../src/constants/certificate-constants");

const TARGET_EMAIL = process.argv[2] ?? "ashar050488@gmail.com";

/* Released, not pending: /certificates/mine filters on status and an unreleased
   certificate is invisible to the owner by design. A fixture that seeded the
   default status would look like the endpoint was broken. */
const RELEASED = CERTIFICATE_STATUSES.RELEASED ?? "released";

function connectLikeTheApp(uri) {
  const path = new URL(uri.replace(/^mongodb\+srv:/, "https:").replace(/^mongodb:/, "http:"))
    .pathname.replace(/^\//, "");
  return mongoose.connect(uri, path ? {} : { dbName: "Management" });
}

function istDateRange(startsOn, endsOn) {
  const format = (value) =>
    new Date(value).toLocaleDateString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  if (!startsOn) return "";
  return endsOn ? `${format(startsOn)} – ${format(endsOn)}` : format(startsOn);
}

async function seedMyCertificates() {
  if (!process.env.DATABASE_URI) {
    throw new Error("DATABASE_URI is not set.");
  }
  await connectLikeTheApp(process.env.DATABASE_URI);
  console.log(`Connected to database "${mongoose.connection.db.databaseName}".`);

  const user = await UserModel.findOne({ emailAddress: TARGET_EMAIL }).populate("collegeId");
  if (!user) {
    throw new Error(`No user with emailAddress "${TARGET_EMAIL}".`);
  }

  /* Two fests with events, most recent first — the grid needs two sections and
     the sections are ordered by fest start date. */
  const fests = await FestModel.find({}).sort({ startsOn: -1 }).limit(6).lean();
  const usable = [];
  for (const fest of fests) {
    const events = await EventModel.find({ festId: fest._id, category: { $ne: null } })
      .limit(4)
      .lean();
    if (events.length >= 3) {
      usable.push({ fest, events });
    }
    if (usable.length === 2) break;
  }
  if (usable.length < 2) {
    throw new Error(
      `Need two fests with at least three categorised events each; found ${usable.length}.`
    );
  }

  const collegeName = user.collegeId?.commonName ?? user.collegeId?.collegeName ?? "Acharya";

  /* [certificateType, which fest (0|1), which event index, or null for a
     fest-level staff certificate]. */
  const plan = [
    [CERTIFICATE_TYPES.WINNER_1ST, 0, 0],
    [CERTIFICATE_TYPES.PARTICIPATION, 0, 1],
    [CERTIFICATE_TYPES.SPECIAL_MENTION, 0, 2],
    [CERTIFICATE_TYPES.COORDINATOR, 0, null],
    [CERTIFICATE_TYPES.WINNER_2ND, 1, 0],
    [CERTIFICATE_TYPES.WINNER_3RD, 1, 1],
    [CERTIFICATE_TYPES.PARTICIPATION, 1, 2],
    [CERTIFICATE_TYPES.VOLUNTEER, 1, null],
  ];

  const POSITION_BY_TYPE = {
    [CERTIFICATE_TYPES.WINNER_1ST]: "1st",
    [CERTIFICATE_TYPES.WINNER_2ND]: "2nd",
    [CERTIFICATE_TYPES.WINNER_3RD]: "3rd",
  };
  const ROLE_BY_TYPE = {
    [CERTIFICATE_TYPES.COORDINATOR]: "Event Coordinator",
    [CERTIFICATE_TYPES.VOLUNTEER]: "Volunteer",
    [CERTIFICATE_TYPES.ADMINISTRATOR]: "Administrator",
  };

  let created = 0;
  let updated = 0;

  for (const [index, [certificateType, festIndex, eventIndex]] of plan.entries()) {
    const { fest, events } = usable[festIndex];
    const event = eventIndex === null ? null : events[eventIndex];

    const existing = await CertificateModel.findOne({
      userId: user._id,
      festId: fest._id,
      eventId: event ? event._id : null,
    });

    /* One certificate in the set deliberately has no USN, to prove the details
       table omits the row rather than printing a blank one. */
    const usn = index === 1 ? null : (user.usn ?? "1AY22CS001");

    const metadata = {
      fullName: user.fullName,
      collegeName,
      usn,
      eventName: event ? event.eventName : null,
      festName: fest.festName,
      festDates: istDateRange(fest.startsOn, fest.endsOn),
      position: POSITION_BY_TYPE[certificateType] ?? null,
      role: ROLE_BY_TYPE[certificateType] ?? null,
    };

    /* Issue dates walk backwards a day at a time so the within-group ordering
       is deterministic and a sort bug is visible rather than lucky. */
    const issuedAt = new Date(Date.now() - index * 24 * 60 * 60 * 1000);

    if (existing) {
      existing.certificateType = certificateType;
      existing.metadata = metadata;
      existing.status = RELEASED;
      existing.releasedAt = issuedAt;
      existing.generatedAt = issuedAt;
      await existing.save();
      updated += 1;
      console.log(
        `updated  ${certificateType.padEnd(15)} ${existing.verificationCode}  ` +
          `${fest.festName} / ${event ? event.eventName : "(fest-level)"}`
      );
      continue;
    }

    const certificate = await CertificateModel.create({
      userId: user._id,
      festId: fest._id,
      eventId: event ? event._id : null,
      certificateType,
      verificationCode: generateVerificationCode(),
      status: RELEASED,
      generatedAt: issuedAt,
      releasedAt: issuedAt,
      metadata,
    });
    created += 1;
    console.log(
      `created  ${certificateType.padEnd(15)} ${certificate.verificationCode}  ` +
        `${fest.festName} / ${event ? event.eventName : "(fest-level)"}`
    );
  }

  console.log(
    `\nDone. ${created} created, ${updated} updated for ${user.fullName} <${TARGET_EMAIL}>.`
  );
  console.log(
    "Verify any of the codes above at /verify-certificate/<code> — that page is public."
  );
}

seedMyCertificates()
  .catch((error) => {
    console.error("Certificate seeding failed:", error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
