const { UserModel } = require("../models/user-model");
const { FestModel } = require("../models/fest-model");
const { CollegeModel } = require("../models/college-model");
const { sendMailQuietly } = require("../services/email-service");
const { buildBrandedEmailBodies } = require("./email-template");
const { applicationConfig } = require("../config/application-config");
const {
  selectCertificateEmailTemplate,
  buildCertificateCopyContext,
} = require("./certificate-release-copy");

const MY_CERTIFICATES_PATH = "/my-certificates";
const VIEW_CERTIFICATE_LABEL = "View certificate";

/*
 * The single "a certificate just went live" notice, shared by every release
 * path (the admin/coordinator closing release, the results-board winner and
 * participation pushes, and the coordinator's template-PDF push) so the three
 * actions cannot drift into three different participant experiences again.
 *
 * THE MESSAGE IS PER CERTIFICATE, NOT PER RELEASE. A release is a mixed batch —
 * winners, participants and the crew who ran the event all become visible in the
 * same click — so the copy is chosen from each row's certificateType rather than
 * once for the batch. See certificate-release-copy.js for the wording.
 *
 * Sends BOTH channels — an email (so a participant who isn't in the app still
 * hears about it) and an in-app notification (so the bell badge and feed pick
 * it up). FIRE-AND-FORGET by contract: the release is already persisted, so
 * this never throws and is never awaited by the caller — a dead mail host or a
 * notification write failure must not fail or slow the release response.
 *
 * `certificates` are lean rows carrying userId, certificateType and the frozen
 * metadata snapshot (eventName/festName/role), captured BEFORE the status flip.
 * `festId` is passed separately since it's already known at every call site and
 * the in-app notification needs it as a real ObjectId for grouping/cleanup.
 */
function notifyCertificateRelease(certificates, { festId = null } = {}) {
  if (!Array.isArray(certificates) || certificates.length === 0) {
    return;
  }
  void (async () => {
    try {
      const userIds = [...new Set(certificates.map((certificate) => String(certificate.userId)))];
      const users = await UserModel.find({ _id: { $in: userIds } })
        .select("fullName emailAddress")
        .lean();
      const usersById = new Map(users.map((user) => [String(user._id), user]));

      const hostCollegeName = await resolveHostCollegeName(festId);
      const certificateUrl = `${applicationConfig.frontendBaseUrl}${MY_CERTIFICATES_PATH}`;

      const emailResults = await Promise.allSettled(
        certificates.map((certificate) => {
          const user = usersById.get(String(certificate.userId));
          if (!user?.emailAddress) {
            /*
             * No address is not a failure to report — a placeholder attendee may
             * legitimately have none yet. Resolving false keeps it out of the
             * failure count below, which exists to surface a broken mail host.
             */
            return Promise.resolve(false);
          }

          const template = selectCertificateEmailTemplate(certificate.certificateType);
          const context = buildCertificateCopyContext(certificate, { hostCollegeName });

          return sendMailQuietly({
            to: user.emailAddress,
            subject: template.subject(context),
            ...buildBrandedEmailBodies(template.body(context), {
              festName: context.festName,
              actionUrl: certificateUrl,
              actionLabel: VIEW_CERTIFICATE_LABEL,
            }),
          });
        })
      );
      const failedEmails = emailResults.filter(
        (result) => result.status === "rejected" || result.value === false
      ).length;
      if (failedEmails > 0) {
        console.error(`Certificate release emails: ${failedEmails}/${certificates.length} failed to send.`);
      }

      await sendInAppNotifications(certificates, { festId, hostCollegeName });
    } catch (error) {
      console.error(`Certificate release notifications failed entirely: ${error.message}`);
    }
  })();
}

/*
 * The college HOSTING the fest, for the "at <fest>, <college>" clause.
 *
 * Deliberately NOT the recipient's own college, which the certificate metadata
 * already carries for the printed document: telling a visiting participant they
 * won at their own college would be wrong on every inter-college fest.
 *
 * One lookup for the whole batch — every certificate in a release shares a fest.
 * Returns null on any miss, and the copy then omits the clause rather than
 * printing a gap.
 */
async function resolveHostCollegeName(festId) {
  if (!festId) {
    return null;
  }
  try {
    const fest = await FestModel.findById(festId).select("hostCollegeId").lean();
    if (!fest?.hostCollegeId) {
      return null;
    }
    const college = await CollegeModel.findById(fest.hostCollegeId)
      .select("commonName collegeName")
      .lean();
    return college?.commonName || college?.collegeName || null;
  } catch {
    // A name for one clause is not worth failing the whole notification over.
    return null;
  }
}

/*
 * In-app notifications, GROUPED BY WORDING rather than sent one per row.
 *
 * notifyUsers takes a list of user ids and one message, so a single call for the
 * whole batch would put the same title in front of a winner and a participant —
 * the exact flattening this change exists to remove. Grouping by the template
 * each certificate resolves to sends one call per distinct message instead,
 * which is a handful of calls rather than one per recipient.
 */
async function sendInAppNotifications(certificates, { festId, hostCollegeName }) {
  // Late require: notification-service requires the model, and this file is
  // required from services that load before it in the graph.
  const { notifyUsers, NOTIFICATION_TYPES } = require("../services/notification-service");

  const groups = new Map();
  for (const certificate of certificates) {
    const template = selectCertificateEmailTemplate(certificate.certificateType);
    const context = buildCertificateCopyContext(certificate, { hostCollegeName });
    const title = template.notificationTitle(context);
    const body = template.notificationBody(context);
    // Title AND body: two winners of different events need different titles.
    /* \u0000 as the separator: it cannot occur inside a title or body, so two
       different pairs can never collide into one group. Written as an escape,
       not a raw byte {a raw NUL made this file read as binary to grep}. */
    const groupKey = `${title}\u0000${body}`;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, { title, body, userIds: new Set() });
    }
    groups.get(groupKey).userIds.add(String(certificate.userId));
  }

  for (const group of groups.values()) {
    await notifyUsers({
      userIds: [...group.userIds],
      notificationType: NOTIFICATION_TYPES.CERTIFICATE_READY,
      title: group.title,
      body: group.body,
      linkPath: MY_CERTIFICATES_PATH,
      festId,
    });
  }
}

module.exports = { notifyCertificateRelease };
