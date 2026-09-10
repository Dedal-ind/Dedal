const collegeService = require("../services/college-service");
const { validateRegisterCollegePayload } = require("../validators/college-validators");

async function getListMyAdminColleges(request, response) {
  const { userId } = request.authenticatedUser;
  const colleges = await collegeService.listCollegesUserAdministers(userId);
  return response.status(200).json({ data: { colleges } });
}

async function getListVerifiedColleges(request, response) {
  const city = typeof request.query.city === "string" ? request.query.city.trim() : undefined;
  const colleges = await collegeService.listVerifiedColleges(city);
  return response.status(200).json({ data: { colleges } });
}

// Self-signup: a signed-in user registers a college and becomes its (pending) admin.
async function postRegisterCollege(request, response) {
  const validation = validateRegisterCollegePayload(request.body);
  if (!validation.ok) {
    return response.status(400).json({ error: validation.error });
  }
  const { userId } = request.authenticatedUser;
  const college = await collegeService.registerCollege(userId, validation.value);
  return response.status(201).json({ data: { college } });
}

// Platform owner only (route-gated): the review queue of all colleges.
async function getListAllColleges(request, response) {
  const colleges = await collegeService.listAllColleges();
  return response.status(200).json({ data: { colleges } });
}

// Platform owner only: approve (verify) or un-verify a college.
async function postSetCollegeVerification(request, response) {
  const isVerified = request.body?.isVerified !== false; // default to verifying
  const college = await collegeService.setCollegeVerified(request.params.collegeId, isVerified);
  return response.status(200).json({ data: { college } });
}

module.exports = {
  getListMyAdminColleges,
  getListVerifiedColleges,
  postRegisterCollege,
  getListAllColleges,
  postSetCollegeVerification,
};
