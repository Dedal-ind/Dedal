const crypto = require("crypto");
const { QUESTION_ID_LENGTH } = require("../constants/event-constants");

/*
 * A question's identity inside its event. Deliberately not an ObjectId: it is a
 * subdocument key that travels in URLs and in every registration's answers, so
 * it stays short and readable. Lowercase base36 — unlike an invite code nobody
 * reads this aloud, so the confusable characters are not worth excluding.
 *
 * Random rather than positional, so reordering or deleting a question never
 * renumbers another one and silently re-points existing answers at it.
 */
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function generateQuestionId() {
  const randomBytes = crypto.randomBytes(QUESTION_ID_LENGTH);
  let questionId = "";
  for (let index = 0; index < QUESTION_ID_LENGTH; index += 1) {
    questionId += ALPHABET[randomBytes[index] % ALPHABET.length];
  }
  return questionId;
}

module.exports = { generateQuestionId };
