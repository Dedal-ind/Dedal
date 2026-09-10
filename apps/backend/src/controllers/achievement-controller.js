const achievementService = require("../services/achievement-service");
const { extractRequestContext } = require("../helpers/request-context");

/* The caller's own achievements — owner view, hidden self-declared rows included. */
async function getMyAchievements(request, response) {
  const { userId } = request.authenticatedUser;
  const achievements = await achievementService.getMyAchievements(userId, { isOwner: true });
  return response.status(200).json({ data: achievements });
}

/* Another user's public achievements — non-visible self-declared rows excluded. */
async function getUserAchievements(request, response) {
  const achievements = await achievementService.getMyAchievements(request.params.userId, {
    isOwner: false,
  });
  return response.status(200).json({ data: achievements });
}

async function postSelfDeclaredAchievement(request, response) {
  const { userId } = request.authenticatedUser;
  const created = await achievementService.addSelfDeclaredAchievement(userId, {
    title: request.body?.title,
    description: request.body?.description,
    achievedAt: request.body?.achievedAt,
  });
  return response.status(201).json({ data: created });
}

async function patchSelfDeclaredAchievement(request, response) {
  const { userId } = request.authenticatedUser;
  const updated = await achievementService.updateSelfDeclaredAchievement(
    userId,
    request.params.achievementId,
    {
      title: request.body?.title,
      description: request.body?.description,
      achievedAt: request.body?.achievedAt,
      isVisible: request.body?.isVisible,
    }
  );
  return response.status(200).json({ data: updated });
}

async function deleteSelfDeclaredAchievement(request, response) {
  const { userId } = request.authenticatedUser;
  const result = await achievementService.deleteSelfDeclaredAchievement(
    userId,
    request.params.achievementId
  );
  return response.status(200).json({ data: result });
}

/* Admin-only: award event results from an event's finalized bracket or scores. */
async function postAwardResults(request, response) {
  const { userId } = request.authenticatedUser;
  const result = await achievementService.awardEventResults(
    request.params.eventId,
    userId,
    extractRequestContext(request)
  );
  return response.status(200).json({ data: result });
}

module.exports = {
  getMyAchievements,
  getUserAchievements,
  postSelfDeclaredAchievement,
  patchSelfDeclaredAchievement,
  deleteSelfDeclaredAchievement,
  postAwardResults,
};
