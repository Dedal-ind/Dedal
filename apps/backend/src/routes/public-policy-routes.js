const express = require("express");

const { asyncHandler } = require("../middleware/async-handler");
const {
  getEffectivePolicyDocument,
  getPolicyDocumentVersion,
} = require("../controllers/public-policy-controller");

/*
 * GET /public/policies/versions/:versionId   one past version, verbatim
 * GET /public/policies/:kind/effective        the version in effect now
 *
 * "versions" is a literal segment and sits before "/:kind/..." so it is never
 * read as a document kind — the same ordering rule the event router follows
 * for "/reorder".
 */
const publicPolicyRouter = express.Router();

publicPolicyRouter.get("/versions/:versionId", asyncHandler(getPolicyDocumentVersion));
publicPolicyRouter.get("/:kind/effective", asyncHandler(getEffectivePolicyDocument));

module.exports = { publicPolicyRouter };
