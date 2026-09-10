import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { RegistrationModel } from "../../src/models/registration-model.js";
import { EventModel } from "../../src/models/event-model.js";
import { FestModel } from "../../src/models/fest-model.js";
import { UserModel } from "../../src/models/user-model.js";
import { installEmailServiceMock } from "../setup/test-email-service.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../setup/test-database.js";
import {
  createTestCollege,
  createTestAdministrator,
  createTestFest,
  createTestEvent,
  createTestParticipant,
  openRegistrationOverrides,
} from "../setup/create-test-fixtures.js";

installEmailServiceMock();
const { application } = await import("../../src/application.js");

const DIETARY_ID = "diet0001";
const NOTES_ID = "note0001";
const LAPTOP_ID = "lap00001";

const DIETARY_QUESTION = {
  questionId: DIETARY_ID,
  questionText: "Dietary preference?",
  questionType: "singleChoice",
  options: ["Veg", "Non-veg"],
  isRequired: true,
  displayOrder: 1,
};
const OPTIONAL_NOTES_QUESTION = {
  questionId: NOTES_ID,
  questionText: "Anything else we should know?",
  questionType: "shortText",
  isRequired: false,
  displayOrder: 2,
};
const LAPTOP_QUESTION = {
  questionId: LAPTOP_ID,
  questionText: "Do you have a laptop?",
  questionType: "yesNo",
  isRequired: true,
  displayOrder: 3,
};

let college;
let admin;
let fest;
let participant;

function soloPath(eventId) {
  return `/api/v1/events/${eventId}/registrations/solo`;
}

function registerSolo(event, body) {
  return request(application)
    .post(soloPath(event._id))
    .set("Authorization", `Bearer ${participant.authenticationToken}`)
    .send(body);
}

async function createEventWithQuestions(customQuestions, overrides = {}) {
  return createTestEvent(fest, admin.user, {
    ...openRegistrationOverrides(),
    customQuestions,
    ...overrides,
  });
}

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([
    RegistrationModel.createIndexes(),
    EventModel.createIndexes(),
    FestModel.createIndexes(),
    UserModel.createIndexes(),
  ]);
});

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, { status: "published" });
  participant = await createTestParticipant(college);
});

afterAll(teardownTestDatabase);

/* An event without questions must not start demanding a body. */
describe("events without custom questions", () => {
  it("registers with no body at all", async () => {
    const event = await createEventWithQuestions([]);
    const response = await registerSolo(event, {});

    expect(response.status).toBe(201);
    expect(response.body.data.registration.customResponses).toEqual([]);
  });

  it("ignores customResponses sent to an event that has no questions", async () => {
    const event = await createEventWithQuestions([]);
    const response = await registerSolo(event, {
      customResponses: [{ questionId: "ghost001", answerText: "unasked" }],
    });

    expect(response.status).toBe(201);
    expect(response.body.data.registration.customResponses).toEqual([]);
  });
});

describe("answer validation", () => {
  it("refuses a missing required answer and names the question", async () => {
    const event = await createEventWithQuestions([DIETARY_QUESTION]);
    const response = await registerSolo(event, { customResponses: [] });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("QUESTION_REQUIRED_MISSING");
    expect(response.body.error.details.questionId).toBe(DIETARY_ID);
    expect(await RegistrationModel.countDocuments({})).toBe(0);
  });

  it("refuses a singleChoice answer outside the offered options", async () => {
    const event = await createEventWithQuestions([DIETARY_QUESTION]);
    const response = await registerSolo(event, {
      customResponses: [{ questionId: DIETARY_ID, answerChoice: "Vegan" }],
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("QUESTION_ANSWER_INVALID");
    expect(response.body.error.details.questionId).toBe(DIETARY_ID);
  });

  it("refuses a yesNo answer that is not yes or no", async () => {
    const event = await createEventWithQuestions([LAPTOP_QUESTION]);
    const response = await registerSolo(event, {
      customResponses: [{ questionId: LAPTOP_ID, answerChoice: "maybe" }],
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("QUESTION_ANSWER_INVALID");
  });

  it("accepts a case-varied 'Yes' on a yesNo question and stores it lowercased", async () => {
    const event = await createEventWithQuestions([LAPTOP_QUESTION]);
    const response = await registerSolo(event, {
      customResponses: [{ questionId: LAPTOP_ID, answerChoice: "Yes" }],
    });

    expect(response.status).toBe(201);
    const stored = await RegistrationModel.findOne({ eventId: event._id });
    const laptop = stored.customResponses.find((answer) => answer.questionId === LAPTOP_ID);
    expect(laptop.answerChoice).toBe("yes");
  });

  it("accepts a case-varied 'NO' on a yesNo question and stores it lowercased", async () => {
    const event = await createEventWithQuestions([LAPTOP_QUESTION]);
    const response = await registerSolo(event, {
      customResponses: [{ questionId: LAPTOP_ID, answerChoice: "NO" }],
    });

    expect(response.status).toBe(201);
    const stored = await RegistrationModel.findOne({ eventId: event._id });
    const laptop = stored.customResponses.find((answer) => answer.questionId === LAPTOP_ID);
    expect(laptop.answerChoice).toBe("no");
  });

  it("still refuses a lowercase singleChoice answer, keeping singleChoice case-exact", async () => {
    // The yesNo loosening must not leak into singleChoice: its options are
    // admin-defined and stored verbatim, so "veg" is not "Veg".
    const event = await createEventWithQuestions([DIETARY_QUESTION]);
    const response = await registerSolo(event, {
      customResponses: [{ questionId: DIETARY_ID, answerChoice: "veg" }],
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("QUESTION_ANSWER_INVALID");
  });

  it("refuses a shortText answer over 300 characters", async () => {
    const event = await createEventWithQuestions([
      { ...OPTIONAL_NOTES_QUESTION, isRequired: true },
    ]);
    const response = await registerSolo(event, {
      customResponses: [{ questionId: NOTES_ID, answerText: "x".repeat(301) }],
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("QUESTION_ANSWER_TOO_LONG");
    expect(response.body.error.details.maximumLength).toBe(300);
  });

  it("accepts a shortText answer at exactly 300 characters", async () => {
    const event = await createEventWithQuestions([
      { ...OPTIONAL_NOTES_QUESTION, isRequired: true },
    ]);
    const response = await registerSolo(event, {
      customResponses: [{ questionId: NOTES_ID, answerText: "x".repeat(300) }],
    });

    expect(response.status).toBe(201);
  });

  /* A rejected answer must not cost a seat on the way out. */
  it("does not consume a seat when an answer is refused", async () => {
    const event = await createEventWithQuestions([DIETARY_QUESTION], { capacity: 1 });
    await registerSolo(event, {
      customResponses: [{ questionId: DIETARY_ID, answerChoice: "Vegan" }],
    });

    const reloaded = await EventModel.findById(event._id);
    expect(reloaded.registeredCount).toBe(0);
  });
});

describe("successful answers", () => {
  it("registers when every required question is answered", async () => {
    const event = await createEventWithQuestions([DIETARY_QUESTION, LAPTOP_QUESTION]);
    const response = await registerSolo(event, {
      customResponses: [
        { questionId: LAPTOP_ID, answerChoice: "yes" },
        { questionId: DIETARY_ID, answerChoice: "Veg" },
      ],
    });

    expect(response.status).toBe(201);

    // Stored in the event's displayOrder, not the order the client happened to send.
    const stored = await RegistrationModel.findOne({ userId: participant.user._id });
    expect(stored.customResponses.map((response) => response.questionId)).toEqual([
      DIETARY_ID,
      LAPTOP_ID,
    ]);
    expect(stored.customResponses[0].answerChoice).toBe("Veg");
    expect(stored.customResponses[0].answerText).toBeNull();
  });

  it("allows an optional question to be answered or skipped", async () => {
    const event = await createEventWithQuestions([DIETARY_QUESTION, OPTIONAL_NOTES_QUESTION]);

    const skipped = await registerSolo(event, {
      customResponses: [{ questionId: DIETARY_ID, answerChoice: "Veg" }],
    });
    expect(skipped.status).toBe(201);
    expect(skipped.body.data.registration.customResponses).toHaveLength(1);

    await RegistrationModel.deleteMany({});
    const answered = await registerSolo(event, {
      customResponses: [
        { questionId: DIETARY_ID, answerChoice: "Non-veg" },
        { questionId: NOTES_ID, answerText: "  Allergic to peanuts  " },
      ],
    });
    expect(answered.status).toBe(201);

    const stored = await RegistrationModel.findOne({ userId: participant.user._id });
    expect(stored.customResponses).toHaveLength(2);
    expect(stored.customResponses[1].answerText).toBe("Allergic to peanuts");
  });

  /* The client is holding a form from before the organiser deleted the question. */
  it("silently drops an answer to a question the event no longer has", async () => {
    const event = await createEventWithQuestions([DIETARY_QUESTION]);
    const response = await registerSolo(event, {
      customResponses: [
        { questionId: DIETARY_ID, answerChoice: "Veg" },
        { questionId: "deleted1", answerText: "answer to a removed question" },
      ],
    });

    expect(response.status).toBe(201);
    const stored = await RegistrationModel.findOne({ userId: participant.user._id });
    expect(stored.customResponses).toHaveLength(1);
    expect(stored.customResponses[0].questionId).toBe(DIETARY_ID);
  });
});

describe("reading a registration back", () => {
  it("resolves questionText and questionType onto each response", async () => {
    const event = await createEventWithQuestions([DIETARY_QUESTION]);
    await registerSolo(event, {
      customResponses: [{ questionId: DIETARY_ID, answerChoice: "Veg" }],
    });

    const response = await request(application)
      .get("/api/v1/registrations/mine")
      .set("Authorization", `Bearer ${participant.authenticationToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data[0].customResponses[0]).toEqual({
      questionId: DIETARY_ID,
      questionText: "Dietary preference?",
      questionType: "singleChoice",
      answerText: null,
      answerChoice: "Veg",
    });
  });

  /*
   * The organiser deleted the question after this answer was given. The answer is
   * history and stays; the null prompt is the frontend's cue to say so.
   */
  it("reports a deleted question's answer with null text and type", async () => {
    const event = await createEventWithQuestions([DIETARY_QUESTION]);
    await registerSolo(event, {
      customResponses: [{ questionId: DIETARY_ID, answerChoice: "Veg" }],
    });

    await EventModel.updateOne({ _id: event._id }, { $set: { customQuestions: [] } });

    const response = await request(application)
      .get("/api/v1/registrations/mine")
      .set("Authorization", `Bearer ${participant.authenticationToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data[0].customResponses[0]).toMatchObject({
      questionId: DIETARY_ID,
      questionText: null,
      questionType: null,
      answerChoice: "Veg",
    });
  });
});
