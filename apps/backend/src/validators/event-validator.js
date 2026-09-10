const { ERROR_CODES } = require("../constants/error-codes");
const { EVENT_FIELD_PARSERS } = require("../helpers/event-field-parsers");
const { normaliseCustomQuestions } = require("../helpers/custom-question-helpers");

const CREATE_REQUIRED_FIELDS = [
  "eventName",
  "description",
  "eventType",
  "venue",
  "startsAt",
  "endsAt",
  "registrationOpensAt",
  "registrationClosesAt",
];

function buildValidationFailure(details) {
  return {
    ok: false,
    error: {
      code: ERROR_CODES.VALIDATION_FAILED,
      message: "One or more fields are invalid.",
      details,
    },
  };
}

/*
 * Whitelist-only. A field outside EVENT_FIELD_PARSERS is dropped silently rather
 * than rejected, so a newer frontend sending an extra key keeps working against
 * an older backend — and so a client cannot set status, eventSlug or
 * registeredCount by sending them.
 */
function validatePayload(requestBody, requiredFields) {
  if (requestBody === null || typeof requestBody !== "object") {
    return buildValidationFailure({ body: "must be a JSON object" });
  }

  const details = {};
  const value = {};

  for (const fieldName of Object.keys(EVENT_FIELD_PARSERS)) {
    if (requestBody[fieldName] === undefined) {
      continue;
    }
    const parsed = EVENT_FIELD_PARSERS[fieldName](requestBody[fieldName]);
    if (parsed.reason) {
      details[fieldName] = parsed.reason;
    } else {
      value[fieldName] = parsed.value;
    }
  }

  for (const fieldName of requiredFields) {
    if (value[fieldName] === undefined && details[fieldName] === undefined) {
      details[fieldName] = "is required";
    }
  }

  if (Object.keys(details).length > 0) {
    return buildValidationFailure(details);
  }

  /*
   * Handled outside the parser loop, and outside EVENT_FIELD_PARSERS, because it
   * answers with a named cause (QUESTION_OPTIONS_REQUIRED and friends) rather
   * than a reason string folded into one VALIDATION_FAILED — an organiser fixing
   * a form needs to know which rule they broke. It throws, which the parsers
   * deliberately never do, so it cannot live among them.
   */
  if (requestBody.customQuestions !== undefined) {
    value.customQuestions = normaliseCustomQuestions(requestBody.customQuestions);
  }

  /*
   * FAQs are organiser-authored copy, so the only rules are that both halves are
   * present and non-empty — an FAQ with a question and no answer is worse than
   * no FAQ, because a participant reads it as an unanswered concern.
   */
  if (requestBody.faqs !== undefined) {
    if (!Array.isArray(requestBody.faqs)) {
      return buildValidationFailure({ faqs: "must be an array" });
    }
    const faqDetails = {};
    const cleanedFaqs = requestBody.faqs.map((entry, index) => {
      const question = typeof entry?.question === "string" ? entry.question.trim() : "";
      const answer = typeof entry?.answer === "string" ? entry.answer.trim() : "";
      if (question.length === 0) {
        faqDetails[`faqs[${index}].question`] = "is required";
      }
      if (answer.length === 0) {
        faqDetails[`faqs[${index}].answer`] = "is required";
      }
      return { question, answer };
    });
    if (Object.keys(faqDetails).length > 0) {
      return buildValidationFailure(faqDetails);
    }
    value.faqs = cleanedFaqs;
  }

  return { ok: true, value };
}

function validateCreateEventPayload(requestBody) {
  return validatePayload(requestBody, CREATE_REQUIRED_FIELDS);
}

/* Every field is optional on update; only what arrives is validated. */
function validateUpdateEventPayload(requestBody) {
  return validatePayload(requestBody, []);
}

module.exports = { validateCreateEventPayload, validateUpdateEventPayload };
