const collegeApplicationService = require("../services/college-application-service");
const {
  validateSubmitApplicationPayload,
} = require("../validators/college-application-validators");
const { extractRequestContext } = require("../helpers/request-context");

// Public: a college representative applies to bring their college onto Dedal.
async function postSubmitApplication(request, response) {
  const validation = validateSubmitApplicationPayload(request.body);
  if (!validation.ok) {
    return response.status(400).json({ error: validation.error });
  }

  const { ipAddress } = extractRequestContext(request);
  const responseData = await collegeApplicationService.submitApplication(
    validation.value,
    ipAddress
  );
  return response.status(201).json({ data: responseData });
}

// Public: poll an application's progress. Projected — never returns applicant PII.
async function getApplicationStatus(request, response) {
  const application = await collegeApplicationService.getApplicationStatus(
    request.params.applicationId
  );
  return response.status(200).json({ data: { application } });
}

// Platform owner only (route-gated): the review queue.
async function getListApplications(request, response) {
  const status = typeof request.query.status === "string" ? request.query.status.trim() : undefined;
  const applications = await collegeApplicationService.listApplications({ status });
  return response.status(200).json({ data: { applications } });
}

async function getApplicationById(request, response) {
  const application = await collegeApplicationService.getApplicationById(
    request.params.applicationId
  );
  return response.status(200).json({ data: { application } });
}

async function postApproveApplication(request, response) {
  const { userId } = request.authenticatedUser;
  const responseData = await collegeApplicationService.approveApplication(
    request.params.applicationId,
    userId
  );
  return response.status(200).json({ data: responseData });
}

async function postRejectApplication(request, response) {
  const { userId } = request.authenticatedUser;
  const responseData = await collegeApplicationService.rejectApplication(
    request.params.applicationId,
    userId,
    request.body?.reason
  );
  return response.status(200).json({ data: responseData });
}

module.exports = {
  postSubmitApplication,
  getApplicationStatus,
  getListApplications,
  getApplicationById,
  postApproveApplication,
  postRejectApplication,
};
