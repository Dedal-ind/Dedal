const express = require("express");
const { asyncHandler } = require("../middleware/async-handler");

const publicMetricsRouter = express.Router();

/*
 * Public platform vanity metrics — the numbers safe to show on the login page.
 *
 * DELIBERATELY limited to four opaque counts: no names, no revenue, no
 * per-fest breakdown, no user emails — nothing an unauthenticated visitor
 * should not see. The query is cheap (four indexed countDocuments), cached
 * in-process for 5 minutes so a traffic spike on the login page cannot
 * DDoS the database through this endpoint.
 *
 * Mounted under /api/v1/public, so the existing publicRateLimiterMiddleware
 * covers it automatically — no per-route limiter needed.
 */

let cached = null;
let cachedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

publicMetricsRouter.get("/", asyncHandler(async (request, response) => {
  const now = Date.now();
  if (cached && now - cachedAt < CACHE_TTL_MS) {
    return response.status(200).json({ data: cached });
  }

  const { FestModel } = require("../models/fest-model");
  const { EventModel } = require("../models/event-model");
  const { CollegeModel } = require("../models/college-model");
  const { ScanModel } = require("../models/scan-model");
  const { UserModel } = require("../models/user-model");

  const [totalFests, totalEvents, totalColleges, totalScans, totalUsers] = await Promise.all([
    FestModel.countDocuments({}),
    EventModel.countDocuments({}),
    CollegeModel.countDocuments({}),
    ScanModel.countDocuments({ result: "accepted" }),
    UserModel.countDocuments({}),
  ]);

  cached = { totalFests, totalEvents, totalColleges, totalScans, totalUsers };
  cachedAt = now;

  return response.status(200).json({ data: cached });
}));

module.exports = { publicMetricsRouter };
