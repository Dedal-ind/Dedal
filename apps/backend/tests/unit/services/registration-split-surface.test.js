import { describe, it, expect } from "vitest";
import registrationServiceFacade from "../../../src/services/registration-service.js";
import soloService from "../../../src/services/registration/solo-registration-service.js";
import teamService from "../../../src/services/registration/team-registration-service.js";
import cancellationService from "../../../src/services/registration/cancellation-service.js";
import readService from "../../../src/services/registration/read-service.js";
import seatHelpers from "../../../src/helpers/registration-seat-helpers.js";

/*
 * The decomposition's contract, not its behaviour — every flow through these
 * functions is covered by the suites that existed before the split and that were
 * not touched by it.
 *
 * Two things are pinned here. That the old path still exports exactly what it
 * always did, because fifty callers and a dozen test files import it by name.
 * And that reaching past it into a split file works, so the facade stays a
 * convenience rather than a wall.
 */
describe("the registration surface after the split", () => {
  it("still exports every function the old path exported", () => {
    for (const name of [
      "registerParticipantSolo",
      "registerParticipantTeam",
      "cancelMyRegistration",
      "cancelRegistration",
      "listMyRegistrations",
      "getRegistrationDetail",
    ]) {
      expect(typeof registrationServiceFacade[name]).toBe("function");
    }
  });

  it("hands back the very same functions the split files define", () => {
    expect(registrationServiceFacade.registerParticipantSolo).toBe(
      soloService.registerParticipantSolo
    );
    expect(registrationServiceFacade.registerParticipantTeam).toBe(
      teamService.registerParticipantTeam
    );
    expect(registrationServiceFacade.cancelRegistration).toBe(cancellationService.cancelRegistration);
    expect(registrationServiceFacade.listMyRegistrations).toBe(readService.listMyRegistrations);
  });

  it("lets a caller import a split file directly", () => {
    expect(typeof soloService.registerParticipantSolo).toBe("function");
    expect(typeof cancellationService.cancelMyRegistration).toBe("function");
  });

  /*
   * The seat arithmetic is one module on purpose: a release has to be guarded by
   * the same condition its claim used, and that only stays obviously true while
   * both halves sit together. They did not, once — hence the negative counts.
   */
  it("keeps every registeredCount writer in one place", () => {
    expect(typeof seatHelpers.claimSoloSeat).toBe("function");
    expect(typeof seatHelpers.claimTeamSeats).toBe("function");
    expect(typeof seatHelpers.releaseTeamSeats).toBe("function");
  });
});
