const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");

const { applicationConfig } = require("./config/application-config");
const { healthRouter } = require("./routes/health-routes");
const { authenticationRouter } = require("./routes/authentication-routes");
const { festRouter } = require("./routes/fest-routes");
const { eventRouter } = require("./routes/event-routes");
const { dashboardRouter } = require("./routes/dashboard-routes");
const {
  festCertificateRouter,
  certificateRouter,
} = require("./routes/certificate-routes");
const {
  festAnalyticsRouter,
  festExportsRouter,
  platformAnalyticsRouter,
} = require("./routes/analytics-routes");
const {
  festStaffAssignmentRouter,
  myStaffAssignmentRouter,
} = require("./routes/staff-assignment-routes");
const { festStaffRouter } = require("./routes/fest-staff-routes");
const { collegeRouter } = require("./routes/college-routes");
const {
  collegeApplicationRouter,
  adminCollegeApplicationRouter,
} = require("./routes/college-application-routes");
const { userRouter } = require("./routes/user-routes");
const { notificationRouter } = require("./routes/notification-routes");
const { userAchievementRouter } = require("./routes/achievement-routes");
const { publicFestRouter } = require("./routes/public-fest-routes");
const { publicMetricsRouter } = require("./routes/public-metrics-routes");
const { publicPolicyRouter } = require("./routes/public-policy-routes");
const {
  publicIndependentEventRouter,
  publicEventBySlugRouter,
} = require("./routes/public-independent-event-routes");
const {
  eventRegistrationRouter,
  myRegistrationRouter,
} = require("./routes/registration-routes");
const { teamRouter } = require("./routes/team-routes");
const { paymentRouter } = require("./routes/payment-routes");
const { asyncHandler } = require("./middleware/async-handler");
const {
  publicRateLimiterMiddleware,
} = require("./middleware/public-rate-limiter-middleware");
const { postWebhook } = require("./controllers/payment-controller");
const { passRouter } = require("./routes/pass-routes");
const { scanRouter } = require("./routes/scan-routes");
const { checkpointRouter, festCheckpointRouter } = require("./routes/checkpoint-routes");
const {
  festShiftRouter,
  festVolunteerRouter,
  myShiftRouter,
} = require("./routes/volunteer-shift-routes");
const { participantSearchRouter } = require("./routes/participant-search-routes");
const { auditLogRouter } = require("./routes/audit-log-routes");
const { uploadRouter } = require("./routes/upload-routes");
const { devRouter } = require("./routes/dev-routes");
const {
  festContingentRouter,
  publicContingentRouter,
  inviteCodeRouter,
  contingentClaimRouter,
  contingentPurchaseRouter,
} = require("./routes/contingent-routes");
const { publicEventStaffRouter } = require("./routes/public-event-staff-routes");
const { backstageRouter } = require("./routes/backstage-routes");
const { promotionRouter, publicPromotionRouter } = require("./routes/promotion-routes");
const { decisionRouter } = require("./routes/decision-routes");
const { deliveryRouter } = require("./routes/delivery-routes");
const { promoterRouter, creativeRouter } = require("./routes/promoter-routes");
const { campaignRouter } = require("./routes/campaign-routes");
const { targetingRouter } = require("./routes/targeting-routes");
const { deliveryReportingRouter } = require("./routes/delivery-reporting-routes");
const { festResultsBoardRouter } = require("./routes/results-board-routes");
const { festResultsRouter } = require("./routes/fest-results-routes");
const { independentEventRouter } = require("./routes/independent-event-routes");
const { clientErrorRouter } = require("./routes/client-error-routes");
const { eventFeedbackRouter } = require("./routes/event-feedback-routes");
const { getLocalUploadDir, getActiveDriverName } = require("./services/upload-storage-service");
const { notFoundHandlerMiddleware } = require("./middleware/not-found-handler-middleware");
const { errorHandlerMiddleware } = require("./middleware/error-handler-middleware");

const application = express();

/*
 * An integer hop count, never `true`. This value decides whether a proxied
 * deployment resolves request.ip to the real client address or to the proxy's,
 * which governs request logging and any future per-client-IP controls.
 */
application.set("trust proxy", applicationConfig.trustProxyHops);

/*
 * Helmet's defaults, with the two cross-origin isolation policies relaxed for the
 * Google Sign-In popup: it reports its result by postMessage on window.opener,
 * which COOP `same-origin` severs. `same-origin-allow-popups` still isolates this
 * origin from documents that did not open it.
 *
 * These headers travel on API responses, and the document that actually opens the
 * popup is served by the frontend — see the matching headers in vite.config.js,
 * which are the ones governing that window. Setting them in both places keeps the
 * policy identical whichever origin serves the app.
 */
application.use(
  helmet({
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
    crossOriginEmbedderPolicy: false,
  })
);
application.use(cors());

/*
 * The Razorpay webhook is mounted BEFORE the global JSON parser and takes the raw
 * body itself: signature verification hashes the exact bytes Razorpay sent, which
 * express.json() would consume and re-serialize differently. No auth — the
 * signature is the credential.
 */
application.post(
  "/api/v1/payments/webhook",
  express.raw({ type: "*/*" }),
  asyncHandler(postWebhook)
);

application.use(express.json());
application.use(express.urlencoded({ extended: true }));

if (applicationConfig.applicationEnvironment === "development") {
  application.use(morgan("dev"));
}

application.use("/api/v1/health", healthRouter);
application.use("/api/v1/authentication", authenticationRouter);
application.use("/api/v1/fests", festRouter);
application.use("/api/v1/fests/:festId/events", eventRouter);
application.use("/api/v1/fests/:festId/dashboard", dashboardRouter);
application.use("/api/v1/fests/:festId/certificates", festCertificateRouter);
application.use("/api/v1/fests/:festId/analytics", festAnalyticsRouter);
application.use("/api/v1/fests/:festId/exports", festExportsRouter);
application.use("/api/v1/analytics", platformAnalyticsRouter);
application.use("/api/v1/certificates", certificateRouter);
application.use("/api/v1/fests/:festId/staff-assignments", festStaffAssignmentRouter);
application.use("/api/v1/fests/:festId/staff", festStaffRouter);
application.use("/api/v1/staff-assignments", myStaffAssignmentRouter);
/*
 * Browser crash reports. Unauthenticated and outside the /public namespace:
 * it is a write, not a browse route, and carries its own tighter limiter.
 */
application.use("/api/v1/errors", clientErrorRouter);

/*
 * Every unauthenticated browse route sits behind one limiter, applied at the
 * namespace rather than per-router so a public route added later is covered by
 * default instead of by remembering.
 */
application.use("/api/v1/public", publicRateLimiterMiddleware);
application.use("/api/v1/public/metrics", publicMetricsRouter);
application.use("/api/v1/public/fests", publicFestRouter);
// The legal texts, served from the registry — the single source of truth.
application.use("/api/v1/public/policies", publicPolicyRouter);
// Literal path BEFORE the parameterised /public/events/:eventId/* mounts below,
// so "independent" is never read as an event id.
application.use("/api/v1/public/events/independent", publicIndependentEventRouter);
application.use("/api/v1/events", independentEventRouter);
application.use("/api/v1/events/:eventId/feedback", eventFeedbackRouter);
application.use("/api/v1/events/:eventId/registrations", eventRegistrationRouter);
application.use("/api/v1/registrations", myRegistrationRouter);
application.use("/api/v1/teams", teamRouter);
application.use("/api/v1/payments", paymentRouter);
application.use("/api/v1/passes", passRouter);
application.use("/api/v1/scans", scanRouter);
application.use("/api/v1/checkpoints", checkpointRouter);
application.use("/api/v1/fests/:festId/checkpoints", festCheckpointRouter);
application.use("/api/v1/fests/:festId/contingents", festContingentRouter);
application.use("/api/v1/public/events/:eventId/contingents", publicContingentRouter);
application.use("/api/v1/public/events/:eventId/staff-contacts", publicEventStaffRouter);
// The FLAT event-by-slug lookup, after the mounts above: /independent won the
// literal match earlier, and the sub-path mounts consume their own suffixes, so
// this single-segment param only ever sees bare GET /public/events/<slug>.
application.use("/api/v1/public/events", publicEventBySlugRouter);
application.use("/api/v1/backstage", backstageRouter);
application.use("/api/v1/promotions", promotionRouter);
application.use("/api/v1/public/promotions", publicPromotionRouter);
// The promotions decision engine (phase 3). Per-participant, never cached.
application.use("/api/v1/decisions", decisionRouter);
// Delivery tracking ingest (phase 4): what happened to a decision.
application.use("/api/v1/delivery", deliveryRouter);
// Promotions phase 5: promoter and creative management, platform-admin only.
application.use("/api/v1/promoters", promoterRouter);
application.use("/api/v1/creatives", creativeRouter);
application.use("/api/v1/campaigns", campaignRouter);
application.use("/api/v1/targeting", targetingRouter);
// Delivery reporting (phase 5): reads over rollups only, platform-admin only.
application.use("/api/v1/reports/delivery", deliveryReportingRouter);
application.use("/api/v1/fests/:festId/results-board", festResultsBoardRouter);
/* The hierarchical results board. Mounted alongside /results-board, not in place
   of it: the older flat list is still served on its own path. */
application.use("/api/v1/fests/:festId/results", festResultsRouter);
application.use("/api/v1/invite-codes", inviteCodeRouter);
application.use("/api/v1/contingent-claims", contingentClaimRouter);
application.use("/api/v1/contingent-purchases", contingentPurchaseRouter);
application.use("/api/v1/fests/:festId/shifts", festShiftRouter);
application.use("/api/v1/fests/:festId/volunteers", festVolunteerRouter);
application.use("/api/v1/shifts", myShiftRouter);
application.use("/api/v1/participants", participantSearchRouter);
application.use("/api/v1/admin", auditLogRouter);
application.use("/api/v1/admin", adminCollegeApplicationRouter);
application.use("/api/v1/colleges", collegeRouter);
application.use("/api/v1/college-applications", collegeApplicationRouter);
application.use("/api/v1/users", userRouter);
application.use("/api/v1/notifications", notificationRouter);
application.use("/api/v1/users", userAchievementRouter);
application.use("/api/v1/uploads", uploadRouter);
application.use("/api/v1/dev", devRouter);

/*
 * Serve locally-stored uploads back over HTTP. Only the local storage driver writes
 * files to disk (production pushes to S3 and serves from there), so this mount only
 * matters in development — but it is harmless when the folder is empty.
 */
if (getActiveDriverName() === "local") {
  application.use(
    "/uploads",
    /*
     * CROSS-ORIGIN RESOURCE POLICY, RELAXED FOR THIS MOUNT ONLY.
     *
     * helmet sets `Cross-Origin-Resource-Policy: same-origin` on every response,
     * which is right for the API and wrong for these files. In development the
     * frontend runs on a different origin from the backend (5173 vs 5000), and
     * CORP same-origin makes the browser REFUSE to paint an <img> whose source
     * is this mount — while `fetch()` of the very same URL succeeds, which is
     * what makes it so confusing to diagnose. The symptom is every locally
     * uploaded fest banner and event poster rendering as a broken image.
     *
     * `cross-origin` here says only "these bytes may be embedded by another
     * origin", which is exactly what a public poster is for. It is scoped to
     * the static mount, so the API keeps helmet's default.
     *
     * Production is unaffected either way: it serves uploads from S3, and this
     * branch does not even run.
     */
    (request, response, next) => {
      response.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      next();
    },
    express.static(getLocalUploadDir())
  );
}

application.use(notFoundHandlerMiddleware);
application.use(errorHandlerMiddleware);

module.exports = { application };
