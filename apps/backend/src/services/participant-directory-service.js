/*
 * The admin User Directory's data source: every unique person who holds (or held)
 * a registration in a fest, folded together across all of that fest's events into
 * one row per user. It exists because the per-event participant roster
 * (listEventParticipants) would force the directory to fan out one request per
 * event and dedupe on the client — 40 calls for Alliance ONE alone. One
 * aggregation here answers it in a single round trip.
 *
 * Administrator-gated: assertAdministratorOfFest re-checks authority at the service
 * layer, so the route cannot leak a college's participants to anyone else.
 *
 * Consumer-only surface: it reads registrations, events and users exactly as they
 * are, and fabricates nothing. A user with only cancelled rows still appears (they
 * did register once), with their most-recent status telling that story.
 */
const { EventModel } = require("../models/event-model");
const { RegistrationModel } = require("../models/registration-model");
const { assertAdministratorOfFest } = require("../helpers/assert-administrator-of-fest");

/*
 * phoneNumber is select:false on the user model, so it needs the leading + to come
 * back at all — a deliberate request, admin-gated, because the directory's CSV
 * export is a contact sheet. collegeId is populated to its common name so a row
 * renders the college without a second lookup.
 */
const PARTICIPANT_POPULATE = {
  path: "userId",
  select: "fullName emailAddress usn department participantId isBlocked collegeId +phoneNumber",
  populate: { path: "collegeId", select: "commonName", model: "College" },
};

async function listFestParticipants(userId, festId) {
  await assertAdministratorOfFest(userId, festId);

  const events = await EventModel.find({ festId }).select("_id eventName startsAt").lean();
  if (events.length === 0) {
    return [];
  }
  const eventById = new Map(events.map((event) => [String(event._id), event]));
  const eventIds = events.map((event) => event._id);

  // Newest first, so the first registration seen for a user is their most recent.
  const registrations = await RegistrationModel.find({ eventId: { $in: eventIds } })
    .sort({ registeredAt: -1 })
    .populate(PARTICIPANT_POPULATE)
    .lean();

  const participantsByUser = new Map();
  for (const registration of registrations) {
    const user = registration.userId;
    // A registration whose user was hard-deleted has nothing to show; skip it
    // rather than emit a row of nulls.
    if (!user) {
      continue;
    }
    const key = String(user._id);
    if (!participantsByUser.has(key)) {
      participantsByUser.set(key, {
        userId: key,
        fullName: user.fullName ?? null,
        emailAddress: user.emailAddress ?? null,
        usn: user.usn ?? null,
        department: user.department ?? null,
        phoneNumber: user.phoneNumber ?? null,
        participantId: user.participantId ?? null,
        collegeName: user.collegeId?.commonName ?? null,
        isBlocked: Boolean(user.isBlocked),
        registrations: [],
      });
    }
    const event = eventById.get(String(registration.eventId));
    participantsByUser.get(key).registrations.push({
      eventId: String(registration.eventId),
      eventName: event?.eventName ?? null,
      eventStartsAt: event?.startsAt ?? null,
      status: registration.status,
      registeredAt: registration.registeredAt,
      // Meals booked by this registration's owner (null when the fest offers no
      // food or a teammate booked for them) — the CSV export sums it per person.
      foodOrderCount: registration.foodOrderCount ?? null,
    });
  }

  return Array.from(participantsByUser.values()).map((participant) => ({
    ...participant,
    registrationCount: participant.registrations.length,
    // registrations are newest-first, so [0] is the most recent.
    mostRecentStatus: participant.registrations[0]?.status ?? null,
  }));
}

module.exports = { listFestParticipants };
