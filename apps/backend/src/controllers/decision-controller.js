const { UserModel } = require("../models/user-model");
const decisionEngine = require("../services/decision-engine-service");

/*
 * GET /decisions?placement=<key>
 *
 * One authenticated read: which creative to show on this placement, with the
 * single-use token the delivery phase will require. Or a no-fill.
 *
 * EXPLICITLY NO CACHE. The old public promotion endpoint is cached at the
 * edge for five minutes because every visitor sees the same list; this one
 * is a per-participant decision minting a per-request token, and nothing
 * between here and the screen may ever store it.
 *
 * X-Session-Key: the SERVER-ESTABLISHED anonymous session key that keys the
 * frequency cap for a participant who is under eighteen or of unknown age,
 * in place of their identity (anonymous-session-model explains why, and why
 * it expires). The client never invents one. It echoes back whatever the
 * last response carried — in the X-Session-Key response header and as
 * `sessionKey` in the body — and the server keeps it if live or replaces it
 * if unknown or expired. An adult's response carries none.
 */
async function getDecision(request, response) {
  const { userId } = request.authenticatedUser;
  const user = await UserModel.findById(userId)
    .select("collegeId department yearOfStudy dateOfBirth")
    .lean();

  const result = await decisionEngine.decide({
    placementKey: request.query.placement,
    user,
    sessionKey: request.headers["x-session-key"],
  });

  response.setHeader("Cache-Control", "no-store, private");
  response.setHeader("Pragma", "no-cache");
  if (result.sessionKey) {
    response.setHeader("X-Session-Key", result.sessionKey);
  }
  return response.status(200).json({ data: result });
}

module.exports = { getDecision };
