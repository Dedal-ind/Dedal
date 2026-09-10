const express = require("express");

const { asyncHandler } = require("../middleware/async-handler");
const { authenticationMiddleware } = require("../middleware/authentication-middleware");
const { getAuditLogs } = require("../controllers/audit-log-controller");

/*
 * The admin audit-trail query. Authentication is the HTTP gate; the service
 * further asserts the caller administers the fest named in the query, so one
 * fest's trail never leaks to an administrator of another.
 */
const auditLogRouter = express.Router();

auditLogRouter.get("/audit-logs", authenticationMiddleware, asyncHandler(getAuditLogs));

module.exports = { auditLogRouter };
