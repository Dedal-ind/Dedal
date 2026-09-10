const teamService = require("../services/team-service");
const { validateCreateTeamPayload } = require("../validators/team-validator");
const { extractRequestContext } = require("../helpers/request-context");

async function postCreateTeam(request, response) {
  const validation = validateCreateTeamPayload(request.body);
  if (!validation.ok) {
    return response.status(400).json({ error: validation.error });
  }
  const { userId } = request.authenticatedUser;
  const result = await teamService.createTeam(userId, validation.value, extractRequestContext(request));
  return response.status(201).json({ data: result });
}

async function getMyTeams(request, response) {
  const { userId } = request.authenticatedUser;
  const teams = await teamService.listMyTeams(userId);
  return response.status(200).json({ data: teams });
}

async function postLockTeam(request, response) {
  const { userId } = request.authenticatedUser;
  const team = await teamService.lockTeam(
    userId,
    request.params.teamId,
    extractRequestContext(request)
  );
  return response.status(200).json({ data: team });
}

async function postClaimCaptain(request, response) {
  const { userId } = request.authenticatedUser;
  const team = await teamService.claimTeamCaptain(
    userId,
    request.params.teamId,
    extractRequestContext(request)
  );
  return response.status(200).json({ data: team });
}

async function deleteClaimCaptain(request, response) {
  const { userId } = request.authenticatedUser;
  const team = await teamService.resignTeamCaptain(
    userId,
    request.params.teamId,
    extractRequestContext(request)
  );
  return response.status(200).json({ data: team });
}

module.exports = {
  postCreateTeam,
  getMyTeams,
  postLockTeam,
  postClaimCaptain,
  deleteClaimCaptain,
};
