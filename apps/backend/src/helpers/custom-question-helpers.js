const { ApplicationError } = require("./application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { generateQuestionId } = require("./generate-question-id");
const {
  QUESTION_TYPES,
  QUESTION_TEXT_MAX_LENGTH,
  QUESTION_OPTIONS_MAX,
  QUESTION_OPTION_MAX_LENGTH,
} = require("../constants/event-constants");

function throwQuestionError(errorCode, message, details) {
  throw new ApplicationError(400, errorCode, message, details);
}

function parseQuestionText(rawQuestion, index) {
  if (typeof rawQuestion.questionText !== "string" || rawQuestion.questionText.trim().length === 0) {
    throwQuestionError(ERROR_CODES.QUESTION_TEXT_REQUIRED, "A question needs text.", { index });
  }
  const questionText = rawQuestion.questionText.trim();
  if (questionText.length > QUESTION_TEXT_MAX_LENGTH) {
    throwQuestionError(
      ERROR_CODES.QUESTION_INVALID,
      `Question text may not exceed ${QUESTION_TEXT_MAX_LENGTH} characters.`,
      { index }
    );
  }
  return questionText;
}

/*
 * options is only meaningful on singleChoice. On any other type a non-empty
 * array is rejected rather than dropped, matching the schema: the caller thinks
 * the question offers choices, and that belief is the thing worth correcting.
 */
function parseOptions(rawQuestion, questionType, index) {
  const rawOptions = rawQuestion.options;
  const hasOptions = Array.isArray(rawOptions) && rawOptions.length > 0;

  if (questionType !== QUESTION_TYPES.SINGLE_CHOICE) {
    if (hasOptions) {
      throwQuestionError(
        ERROR_CODES.QUESTION_INVALID,
        `Only a ${QUESTION_TYPES.SINGLE_CHOICE} question may carry options.`,
        { index, questionType }
      );
    }
    return [];
  }

  if (!hasOptions) {
    throwQuestionError(
      ERROR_CODES.QUESTION_OPTIONS_REQUIRED,
      "A singleChoice question needs at least one option.",
      { index }
    );
  }
  if (rawOptions.length > QUESTION_OPTIONS_MAX) {
    throwQuestionError(
      ERROR_CODES.QUESTION_INVALID,
      `A question may not have more than ${QUESTION_OPTIONS_MAX} options.`,
      { index }
    );
  }

  return rawOptions.map((rawOption) => {
    if (typeof rawOption !== "string" || rawOption.trim().length === 0) {
      throwQuestionError(ERROR_CODES.QUESTION_INVALID, "An option must be a non-empty string.", {
        index,
      });
    }
    const option = rawOption.trim();
    if (option.length > QUESTION_OPTION_MAX_LENGTH) {
      throwQuestionError(
        ERROR_CODES.QUESTION_INVALID,
        `An option may not exceed ${QUESTION_OPTION_MAX_LENGTH} characters.`,
        { index }
      );
    }
    return option;
  });
}

/*
 * A caller may send a questionId to keep an existing question stable across an
 * edit; anything without one is new and gets a fresh id. displayOrder falls back
 * to array position, so an admin who just reorders the array gets what they meant.
 */
function normaliseCustomQuestion(rawQuestion, index) {
  if (rawQuestion === null || typeof rawQuestion !== "object" || Array.isArray(rawQuestion)) {
    throwQuestionError(ERROR_CODES.QUESTION_INVALID, "A question must be an object.", { index });
  }

  const questionType = rawQuestion.questionType;
  if (!Object.values(QUESTION_TYPES).includes(questionType)) {
    throwQuestionError(
      ERROR_CODES.QUESTION_TYPE_INVALID,
      `questionType must be one of: ${Object.values(QUESTION_TYPES).join(", ")}.`,
      { index, questionType: questionType === undefined ? null : questionType }
    );
  }

  return {
    questionId:
      typeof rawQuestion.questionId === "string" && rawQuestion.questionId.trim().length > 0
        ? rawQuestion.questionId.trim()
        : generateQuestionId(),
    questionText: parseQuestionText(rawQuestion, index),
    questionType,
    isRequired: typeof rawQuestion.isRequired === "boolean" ? rawQuestion.isRequired : true,
    options: parseOptions(rawQuestion, questionType, index),
    displayOrder: Number.isInteger(rawQuestion.displayOrder) ? rawQuestion.displayOrder : index + 1,
  };
}

/*
 * The whole array, validated and filled in. Rejecting a duplicate id here as well
 * as in the schema is deliberate: the schema guarantees the invariant, but only
 * this path can say which id collided.
 */
function normaliseCustomQuestions(rawQuestions) {
  if (!Array.isArray(rawQuestions)) {
    throwQuestionError(ERROR_CODES.QUESTION_INVALID, "customQuestions must be an array.");
  }

  const questions = rawQuestions.map(normaliseCustomQuestion);
  const seenIds = new Set();
  for (const question of questions) {
    if (seenIds.has(question.questionId)) {
      throwQuestionError(ERROR_CODES.QUESTION_DUPLICATE_ID, "Every questionId must be unique.", {
        questionId: question.questionId,
      });
    }
    seenIds.add(question.questionId);
  }

  return questions;
}

module.exports = { normaliseCustomQuestions };
