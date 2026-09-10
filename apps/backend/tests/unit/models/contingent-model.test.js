import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import { setupTestDatabase, teardownTestDatabase } from "../../setup/test-database.js";
import { ContingentModel } from "../../../src/models/contingent-model.js";
import { ContingentClaimModel } from "../../../src/models/contingent-claim-model.js";

function objectId() {
  return new mongoose.Types.ObjectId();
}

function baseContingent(overrides = {}) {
  return new ContingentModel({
    festId: objectId(),
    parentEventId: objectId(),
    contingentName: "Management Contingent",
    includedEventIds: [objectId(), objectId()],
    pricePaise: 25000,
    individualTotalPaise: 30000,
    createdByUserId: objectId(),
    ...overrides,
  });
}

beforeAll(setupTestDatabase);
afterAll(teardownTestDatabase);

describe("contingent model validators", () => {
  it("accepts a valid two-event bundle and defaults to DRAFT with no bundle cap", () => {
    const contingent = baseContingent();
    expect(contingent.validateSync()).toBeUndefined();
    expect(contingent.status).toBe("draft");
    expect(contingent.maximumBundleClaims).toBeNull();
    expect(contingent.soldBundleCount).toBe(0);
  });

  it("rejects fewer than two included events — a contingent of one is a subscription", () => {
    const contingent = baseContingent({ includedEventIds: [objectId()] });
    expect(contingent.validateSync().errors.includedEventIds).toBeDefined();
  });

  it("rejects more than twelve included events — a data-entry mistake, not a bundle", () => {
    const contingent = baseContingent({
      includedEventIds: Array.from({ length: 13 }, () => objectId()),
    });
    expect(contingent.validateSync().errors.includedEventIds).toBeDefined();
  });

  it("rejects duplicate included events", () => {
    const duplicatedId = objectId();
    const contingent = baseContingent({ includedEventIds: [duplicatedId, duplicatedId] });
    expect(contingent.validateSync().errors.includedEventIds).toBeDefined();
  });

  it("rejects a negative price and an over-length name", () => {
    expect(baseContingent({ pricePaise: -1 }).validateSync().errors.pricePaise).toBeDefined();
    expect(
      baseContingent({ contingentName: "x".repeat(81) }).validateSync().errors.contingentName
    ).toBeDefined();
  });

  it("only knows the three lifecycle statuses", () => {
    expect(baseContingent({ status: "paused" }).validateSync().errors.status).toBeDefined();
  });
});

describe("contingent claim model", () => {
  it("defaults a fresh claim to INVITED with a pending payment and no registration", () => {
    const claim = new ContingentClaimModel({
      contingentId: objectId(),
      festId: objectId(),
      eventId: objectId(),
      contingentPurchaseGroupId: "abc123",
      buyerUserId: objectId(),
      attendeeUserId: objectId(),
      attendeeEmailAddress: "Attendee@Example.com",
      attendeeFullName: "Attendee Person",
      attendeePhoneNumber: "+911234567890",
    });
    expect(claim.validateSync()).toBeUndefined();
    expect(claim.claimStatus).toBe("invited");
    expect(claim.paymentStatus).toBe("pending");
    expect(claim.registrationId).toBeNull();
    // Lowercased by the schema, matching the users unique index behaviour.
    expect(claim.attendeeEmailAddress).toBe("attendee@example.com");
  });

  it("rejects an unknown claim status", () => {
    const claim = new ContingentClaimModel({
      contingentId: objectId(),
      festId: objectId(),
      eventId: objectId(),
      contingentPurchaseGroupId: "abc123",
      buyerUserId: objectId(),
      attendeeEmailAddress: "someone@example.com",
      attendeeFullName: "Someone",
      attendeePhoneNumber: "+911234567890",
      claimStatus: "ghosted",
    });
    expect(claim.validateSync().errors.claimStatus).toBeDefined();
  });
});
