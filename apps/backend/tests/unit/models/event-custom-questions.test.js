import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { EventModel } from "../../../src/models/event-model.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../../setup/test-database.js";
import {
  createTestCollege,
  createTestAdministrator,
  createTestFest,
  buildEventAttributes,
} from "../../setup/create-test-fixtures.js";

let fest;
let admin;

function buildEvent(customQuestions) {
  return new EventModel({
    ...buildEventAttributes(),
    eventSlug: "questions-event",
    festId: fest._id,
    createdByUserId: admin.user._id,
    customQuestions,
  });
}

/* validate() rather than save(): the rules under test are the schema's own. */
async function expectValidationError(eventDocument, fieldPath) {
  await expect(eventDocument.validate()).rejects.toMatchObject({
    errors: { [fieldPath]: expect.anything() },
  });
}

beforeAll(async () => {
  await setupTestDatabase();
});

beforeEach(async () => {
  await clearAllCollections();
  const college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user);
});

afterAll(teardownTestDatabase);

describe("event customQuestions schema", () => {
  it("accepts a valid mix of question types", async () => {
    const event = buildEvent([
      {
        questionId: "aaaa1111",
        questionText: "Dietary preference?",
        questionType: "singleChoice",
        options: ["Veg", "Non-veg"],
        displayOrder: 1,
      },
      {
        questionId: "bbbb2222",
        questionText: "Do you have a laptop?",
        questionType: "yesNo",
        displayOrder: 2,
      },
      {
        questionId: "cccc3333",
        questionText: "Portfolio URL?",
        questionType: "shortText",
        isRequired: false,
        displayOrder: 3,
      },
      {
        questionId: "dddd4444",
        questionText: "Describe your prior experience.",
        questionType: "longText",
        displayOrder: 4,
      },
    ]);

    await expect(event.validate()).resolves.toBeUndefined();
    expect(event.customQuestions[0].options).toEqual(["Veg", "Non-veg"]);
    // isRequired defaults on: a question an organiser wrote is meant to be answered.
    expect(event.customQuestions[1].isRequired).toBe(true);
    expect(event.customQuestions[2].isRequired).toBe(false);
  });

  it("rejects a singleChoice question with no options", async () => {
    const event = buildEvent([
      {
        questionId: "aaaa1111",
        questionText: "Dietary preference?",
        questionType: "singleChoice",
        options: [],
        displayOrder: 1,
      },
    ]);

    await expectValidationError(event, "customQuestions.0.options");
  });

  it("rejects an unknown questionType", async () => {
    const event = buildEvent([
      {
        questionId: "aaaa1111",
        questionText: "Upload your resume",
        questionType: "fileUpload",
        displayOrder: 1,
      },
    ]);

    await expectValidationError(event, "customQuestions.0.questionType");
  });

  it("rejects a duplicate questionId within one event", async () => {
    const event = buildEvent([
      {
        questionId: "samesame",
        questionText: "First question",
        questionType: "yesNo",
        displayOrder: 1,
      },
      {
        questionId: "samesame",
        questionText: "Second question",
        questionType: "yesNo",
        displayOrder: 2,
      },
    ]);

    await expectValidationError(event, "customQuestions");
  });

  /* The same id on two different events is fine: the id is scoped to its event. */
  it("allows the same questionId on two different events", async () => {
    const first = buildEvent([
      { questionId: "shareded", questionText: "Q", questionType: "yesNo", displayOrder: 1 },
    ]);
    const second = buildEvent([
      { questionId: "shareded", questionText: "Q", questionType: "yesNo", displayOrder: 1 },
    ]);
    second.eventSlug = "questions-event-two";

    await expect(first.save()).resolves.toBeTruthy();
    await expect(second.save()).resolves.toBeTruthy();
  });

  it("rejects options on a question that is not singleChoice", async () => {
    const event = buildEvent([
      {
        questionId: "aaaa1111",
        questionText: "Do you have a laptop?",
        questionType: "yesNo",
        options: ["yes", "no", "maybe"],
        displayOrder: 1,
      },
    ]);

    await expectValidationError(event, "customQuestions.0.options");
  });

  it("requires questionText", async () => {
    const event = buildEvent([
      { questionId: "aaaa1111", questionType: "yesNo", displayOrder: 1 },
    ]);

    await expectValidationError(event, "customQuestions.0.questionText");
  });

  it("defaults customQuestions to an empty array", async () => {
    const event = buildEvent(undefined);
    await expect(event.validate()).resolves.toBeUndefined();
    expect(event.customQuestions).toEqual([]);
  });
});
