const scanService = require("../services/scan-service");
const {
  validateQrScanPayload,
  validateBackupCodeScanPayload,
  validatePassScanPayload,
} = require("../validators/scan-validator");

async function postQrScan(request, response) {
  const validation = validateQrScanPayload(request.body);
  if (!validation.ok) {
    return response.status(400).json({ error: validation.error });
  }

  const { userId } = request.authenticatedUser;
  const result = await scanService.processQrScan(userId, validation.value);
  return response.status(200).json({ data: result });
}

async function postBackupCodeScan(request, response) {
  const validation = validateBackupCodeScanPayload(request.body);
  if (!validation.ok) {
    return response.status(400).json({ error: validation.error });
  }

  const { userId } = request.authenticatedUser;
  const result = await scanService.processBackupCodeScan(userId, validation.value);
  return response.status(200).json({ data: result });
}

async function postPassScan(request, response) {
  const validation = validatePassScanPayload(request.body);
  if (!validation.ok) {
    return response.status(400).json({ error: validation.error });
  }

  const { userId } = request.authenticatedUser;
  const result = await scanService.processPassLookupScan(userId, validation.value);
  return response.status(200).json({ data: result });
}

async function postScanPreview(request, response) {
  const result = await scanService.previewScan(request.authenticatedUser.userId, request.body ?? {});
  return response.status(200).json({ data: result });
}

module.exports = { postScanPreview, postQrScan, postBackupCodeScan, postPassScan };
