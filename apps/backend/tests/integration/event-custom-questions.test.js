import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { EventModel } from "../../src/models/event-model.js";
import { FestModel } from "../../src/models/fest-model.js";
import { UserModel } from "../../src/models/user-model.js";
import { RegistrationModel } from "../../src/models/registration-model.js";
import { StaffAssignmentModel } from "../../src/models/staff-assignment-model.js";
import { installEmailServiceMock } from "../setup/test-email-service.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../setup/test-database.js";
import {
  createTestCollege,
  createTestAdministrator,
  createTestOutsider,
  createTestFest,
  createTestEvent,
  createTestParticipant,
  createTestStaffMember,
  openRegistrationOverrides,
} from "../setup/create-test-fixtures.js";

installEmailServiceMock();
const { application } = await import("../../src/application.js");

const DIETARY_QUESTION = {
  questionText: "Dietary preference?",
  questionType: "singleChoice",
  options: ["Veg", "Non-veg"],
  isRequired: true,
};

let college;
let admin;
let fest;
let event;

function eventPath() {
  return `/api/v1/fests/${fest._id}/events/${event._id}`;
}

function patchEvent(token, body) {
  return request(application)
    .patch(eventPath())
    .set("Authorization", `Bearer ${token}`)
    .send(body);
}

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([
    EventModel.createIndexes(),
    FestModel.createIndexes(),
    UserModel.createIndexes(),
    RegistrationModel.createIndexes(),
    StaffAssignmentModel.createIndexes(),
  ]);
});

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, { status: "published" });
  event = await createTestEvent(fest, admin.user, openRegistrationOverrides());
});

afterAll(teardownTestDatabase);

describe("managing questions", () => {
  it("lets an administrator add a question, generating id and displayOrder", async () => {
    const response = await patchEvent(admin.authenticationToken, {
      customQuestions: [DIETARY_QUESTION],
    });

    expect(response.status).toBe(200);
    const [question] = response.body.data.customQuestions;
    expect(question.questionText).toBe("Dietary preference?");
    expect(question.options).toEqual(["Veg", "Non-veg"]);
    expect(question.displayOrder).toBe(1);
    // Server-generated: short, readable, and not an ObjectId.
    expect(question.questionId).toMatch(/^[a-z0-9]{8}$/);
  });

  it("lets an administrator edit a question while keeping its id", async () => {
    const created = await patchEvent(admin.authenticationToken, {
      customQuestions: [DIETARY_QUESTION],
    });
    const { questionId } = created.body.data.customQuestions[0];

    const updated = await patchEvent(admin.authenticationToken, {
      customQuestions: [
        {
          questionId,
          questionText: "Meal preference?",
          questionType: "singleChoice",
          options: ["Veg", "Non-veg", "Vegan"],
        },
      ],
    });

    expect(updated.status).toBe(200);
    const [question] = updated.body.data.customQuestions;
    expect(question.questionId).toBe(questionId);
    expect(question.questionText).toBe("Meal preference?");
    expect(question.options).toEqual(["Veg", "Non-veg", "Vegan"]);
  });

  it("lets a coordinator of the event manage questions", async () => {
    const coordinator = await createTestStaffMember(fest, "coordinator", {
      assignment: { eventIds: [event._id] },
    });

    const response = await patchEvent(coordinator.authenticationToken, {
      customQuestions: [DIETARY_QUESTION],
    });

    expect(response.status).toBe(200);
    expect(response.body.data.customQuestions).toHaveLength(1);
  });

  it("refuses a user with no assignment on this fest", async () => {
    const outsider = await createTestOutsider();

    const response = await patchEvent(outsider.authenticationToken, {
      customQuestions: [DIETARY_QUESTION],
    });

    expect(response.status).toBe(403);
    const reloaded = await EventModel.findById(event._id);
    expect(reloaded.customQuestions).toHaveLength(0);
  });
});

/*
 * Deleting a question removes it from the event only. The answers already given
 * to it are history and stay on their registrations, orphaned but intact —
 * rewriting them would destroy the record of what the participant actually said.
 */
describe("deleting a question", () => {
  it("drops it from the event but leaves existing answers untouched", async () => {
    const created = await patchEvent(admin.authenticationToken, {
      customQuestions: [DIETARY_QUESTION],
    });
    const { questionId } = created.body.data.customQuestions[0];

    const participant = await createTestParticipant(college);
    await request(application)
      .post(`/api/v1/events/${event._id}/registrations/solo`)
      .set("Authorization", `Bearer ${participant.authenticationToken}`)
      .send({ customResponses: [{ questionId, answerChoice: "Veg" }] })
      .expect(201);

    const deleted = await patchEvent(admin.authenticationToken, { customQuestions: [] });
    expect(deleted.status).toBe(200);
    expect(deleted.body.data.customQuestions).toEqual([]);

    const registration = await RegistrationModel.findOne({ userId: participant.user._id });
    expect(registration.customResponses).toHaveLength(1);
    expect(registration.customResponses[0]).toMatchObject({
      questionId,
      answerChoice: "Veg",
    });
  });
});

describe("question validation on write", () => {
  it("names the cause when text is missing", async () => {
    const response = await patchEvent(admin.authenticationToken, {
      customQuestions: [{ questionText: "   ", questionType: "yesNo" }],
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("QUESTION_TEXT_REQUIRED");
  });

  it("names the cause when the type is unknown", async () => {
    const response = await patchEvent(admin.authenticationToken, {
      customQuestions: [{ questionText: "Upload a resume", questionType: "fileUpload" }],
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("QUESTION_TYPE_INVALID");
  });

  it("names the cause when a singleChoice question has no options", async () => {
    const response = await patchEvent(admin.authenticationToken, {
      customQuestions: [
        { questionText: "Dietary preference?", questionType: "singleChoice", options: [] },
      ],
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("QUESTION_OPTIONS_REQUIRED");
  });

  it("names the cause when two questions share an id", async () => {
    const response = await patchEvent(admin.authenticationToken, {
      customQuestions: [
        { questionId: "samesame", questionText: "First", questionType: "yesNo" },
        { questionId: "samesame", questionText: "Second", questionType: "yesNo" },
      ],
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("QUESTION_DUPLICATE_ID");
    expect(response.body.error.details.questionId).toBe("samesame");
  });

  it("refuses options on a question that is not singleChoice", async () => {
    const response = await patchEvent(admin.authenticationToken, {
      customQuestions: [
        { questionText: "Do you have a laptop?", questionType: "yesNo", options: ["yes", "no"] },
      ],
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("QUESTION_INVALID");
  });
});
