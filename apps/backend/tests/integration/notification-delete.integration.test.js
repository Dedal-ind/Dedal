/*
 * DELETE /notifications/mine/:notificationId — the endpoint behind the
 * notifications screen's swipe-to-delete.
 *
 * The only thing worth asserting here is the scoping. The delete takes an id
 * from the URL and the user from the token, and if it ever stopped combining
 * the two, anyone could remove anyone else's notifications by guessing an
 * ObjectId. A non-owner therefore gets a 404 — the same answer as an id that
 * never existed, so the endpoint cannot be used to probe for real ones — and
 * the row is still there afterwards.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { application } from "../../src/application.js";
import { NotificationModel } from "../../src/models/notification-model.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../setup/test-database.js";
import { createTestCollege, createTestParticipant } from "../setup/create-test-fixtures.js";

const MISSING_ID = "000000000000000000000000";

let owner;
let otherUser;
let notification;

beforeAll(async () => {
  await setupTestDatabase();
});

afterAll(async () => {
  await teardownTestDatabase();
});

beforeEach(async () => {
  await clearAllCollections();
  const college = await createTestCollege();
  owner = await createTestParticipant(college);
  otherUser = await createTestParticipant(college, {
    emailAddress: "other-participant@example.com",
  });
  notification = await NotificationModel.create({
    userId: owner.user._id,
    notificationType: "broadcast",
    title: "Gates open at 9am.",
  });
});

describe("DELETE /api/v1/notifications/mine/:notificationId", () => {
  it("deletes the caller's own notification", async () => {
    const response = await request(application)
      .delete(`/api/v1/notifications/mine/${notification.id}`)
      .set("Authorization", `Bearer ${owner.authenticationToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.deletedId).toBe(notification.id);
    expect(await NotificationModel.countDocuments({ _id: notification._id })).toBe(0);
  });

  it("answers 404 for somebody else's notification and leaves the row alone", async () => {
    const response = await request(application)
      .delete(`/api/v1/notifications/mine/${notification.id}`)
      .set("Authorization", `Bearer ${otherUser.authenticationToken}`);

    expect(response.status).toBe(404);
    expect(await NotificationModel.countDocuments({ _id: notification._id })).toBe(1);
  });

  it("answers 404 for an id that does not exist", async () => {
    const response = await request(application)
      .delete(`/api/v1/notifications/mine/${MISSING_ID}`)
      .set("Authorization", `Bearer ${owner.authenticationToken}`);

    expect(response.status).toBe(404);
  });
});
