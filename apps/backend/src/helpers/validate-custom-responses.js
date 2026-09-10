const { ApplicationError } = require("./application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const {
  QUESTION_TYPES,
  YES_NO_ANSWERS,
  ANSWER_MAX_LENGTH_BY_TYPE,
} = require("../constants/event-constants");

function throwAnswerError(errorCode, message, details) {
  throw new ApplicationError(400, errorCode, message, details);
}

function readAnswerText(response, question) {
  const rawAnswer = response.answerText;
  if (typeof rawAnswer !== "string" || rawAnswer.trim().length === 0) {
    throwAnswerError(ERROR_CODES.QUESTION_ANSWER_INVALID, "This question needs a text answer.", {
      questionId: question.questionId,
    });
  }

  const answerText = rawAnswer.trim();
  const maximumLength = ANSWER_MAX_LENGTH_BY_TYPE[question.questionType];
  if (answerText.length > maximumLength) {
    throwAnswerError(
      ERROR_CODES.QUESTION_ANSWER_TOO_LONG,
      `This answer may not exceed ${maximumLength} characters.`,
      { questionId: question.questionId, maximumLength }
    );
  }

  return { questionId: question.questionId, answerText, answerChoice: null };
}

/*
 * The chosen option must match one the question actually offers. For singleChoice
 * the compare is exact, not case-insensitive: the option string is admin-defined
 * and is what gets stored and later reported on, so "veg" and "Veg" must not both
 * become answers to the same option. yesNo is the exception — its vocabulary is a
 * fixed two values, so an auto-capitalised "Yes"/"NO" from a mobile keyboard is the
 * same answer; it is lowercased before the check and stored lowercased so reports
 * do not split "yes" and "Yes".
 */
function readAnswerChoice(response, question) {
  const isYesNo = question.questionType === QUESTION_TYPES.YES_NO;
  const allowedAnswers = isYesNo ? YES_NO_ANSWERS : question.options;
  const rawAnswer = response.answerChoice;
  const trimmedAnswer = typeof rawAnswer === "string" ? rawAnswer.trim() : rawAnswer;
  const answerChoice =
    isYesNo && typeof trimmedAnswer === "string" ? trimmedAnswer.toLowerCase() : trimmedAnswer;

  if (!allowedAnswers.includes(answerChoice)) {
    throwAnswerError(ERROR_CODES.QUESTION_ANSWER_INVALID, "This answer is not one of the choices.", {
      questionId: question.questionId,
      allowedAnswers: [...allowedAnswers],
    });
  }

  return { questionId: question.questionId, answerText: null, answerChoice };
}

function readAnswer(response, question) {
  if (
    question.questionType === QUESTION_TYPES.SINGLE_CHOICE ||
    question.questionType === QUESTION_TYPES.YES_NO
  ) {
    return readAnswerChoice(response, question);
  }
  return readAnswerText(response, question);
}

/*
 * The answers a registration may keep, checked against the event's questions.
 *
 * Order follows the event's displayOrder rather than the order the client sent,
 * so every registration for an event reads back the same way regardless of what
 * its form did. A response naming a question the event no longer has is dropped
 * rather than rejected: the client is holding a form from before the organiser
 * deleted it, which is stale, not wrong.
 */
function validateCustomResponses(customQuestions, rawResponses) {
  const questions = customQuestions || [];
  if (questions.length === 0) {
    return [];
  }

  const responsesByQuestionId = new Map(
    (Array.isArray(rawResponses) ? rawResponses : [])
      .filter((response) => response && typeof response === "object")
      .map((response) => [String(response.questionId), response])
  );

  const orderedQuestions = [...questions].sort(
    (left, right) => left.displayOrder - right.displayOrder
  );

  const validatedResponses = [];
  for (const question of orderedQuestions) {
    const response = responsesByQuestionId.get(String(question.questionId));

    if (!response) {
      if (question.isRequired) {
        throwAnswerError(
          ERROR_CODES.QUESTION_REQUIRED_MISSING,
          "This question must be answered.",
          { questionId: question.questionId, questionText: question.questionText }
        );
      }
      continue;
    }

    validatedResponses.push(readAnswer(response, question));
  }

  return validatedResponses;
}

/*
 * The read shape: each answer carries its own prompt so the frontend never joins
 * back to the event. A question deleted since the answer was given resolves to
 * null text and type, which is the signal to render a "question removed"
 * fallback — the answer itself is still history and is never dropped.
 */
function resolveCustomResponses(customQuestions, customResponses) {
  const questionsById = new Map(
    (customQuestions || []).map((question) => [String(question.questionId), question])
  );

  return (customResponses || []).map((response) => {
    const question = questionsById.get(String(response.questionId));
    return {
      questionId: response.questionId,
      questionText: question ? question.questionText : null,
      questionType: question ? question.questionType : null,
      answerText: response.answerText === undefined ? null : response.answerText,
      answerChoice: response.answerChoice === undefined ? null : response.answerChoice,
    };
  });
}

module.exports = { validateCustomResponses, resolveCustomResponses };
