/*
 * The registration surface, as it always was. The implementation moved into
 * ./registration/ — this path stays because every controller, test and sibling
 * service already knows it, and a decomposition that makes fifty callers change
 * their import has spent more than it saved.
 *
 * New work belongs in the file that owns the concern, not here:
 *   registration/solo-registration-service  — one person, one seat
 *   registration/team-registration-service  — a roster, and the seat compensator
 *   registration/cancellation-service       — who may cancel what, and giving seats back
 *   registration/read-service               — reading registrations back
 *
 * The rules the four share live in helpers/: registration-guards (who may
 * register), registration-seat-helpers (every registeredCount write, claims and
 * releases in one file so their symmetry stays visible), registration-serializers.
 */
const { registerParticipantSolo } = require("./registration/solo-registration-service");
const { registerParticipantTeam } = require("./registration/team-registration-service");
const {
  cancelRegistration,
  cancelMyRegistration,
  cancelMyPendingRegistration,
} = require("./registration/cancellation-service");
const {
  listMyRegistrations,
  getRegistrationDetail,
} = require("./registration/read-service");
const { confirmPayment } = require("./registration/payment-confirmation-service");

module.exports = {
  registerParticipantSolo,
  registerParticipantTeam,
  cancelMyRegistration,
  cancelMyPendingRegistration,
  cancelRegistration,
  listMyRegistrations,
  getRegistrationDetail,
  confirmPayment,
};
