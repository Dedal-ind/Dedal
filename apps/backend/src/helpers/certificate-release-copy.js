const { CERTIFICATE_TYPES } = require("../constants/certificate-constants");

/*
 * WHAT A CERTIFICATE RELEASE SAYS, per kind of certificate.
 *
 * One winner and one participant do not want the same sentence. Before this,
 * every recipient got "You have received a certificate" — which is true of a
 * third-place finish and of turning up, and reads as a form letter to both.
 *
 * The copy lives HERE rather than inside the notify helper because the same
 * wording feeds two channels (email and the in-app notification) and three
 * release paths (the fest-wide release, the results-board push, the
 * coordinator's template push). One module means a change to the winner's
 * wording cannot land in the email and miss the notification.
 *
 * A NOTE ON collegeName: it is the college HOSTING the fest, not the
 * recipient's own. "You won Robowars at Techfest, RV College" names where the
 * event happened. The certificate's metadata snapshot carries the recipient's
 * college for the printed document, which is a different fact — using it here
 * would tell a visiting participant they won at their own college.
 */

/* ", RV College" or "" — never ", null". */
function formatAtCollege(collegeName) {
  return collegeName ? `, ${collegeName}` : "";
}

const CERTIFICATE_EMAIL_TEMPLATES = {
  winner: {
    subject: ({ eventName, festName }) =>
      `Congratulations! You've won ${eventName} at ${festName}`,
    body: ({ eventName, festName, collegeName }) =>
      `Congratulations! 🎉\n\n` +
      `You have successfully won ${eventName} at ${festName}${formatAtCollege(collegeName)}.\n\n` +
      `Your achievement is truly commendable, and we are proud to have you as one of the winners.\n\n` +
      `We wish you continued success and hope to see you participate and achieve more in our future events.\n\n` +
      `Log in to dedal to view and download your winner certificate.`,
    notificationTitle: ({ eventName }) => `You won ${eventName}`,
    notificationBody: ({ festName }) => `Your winner certificate from ${festName} is ready.`,
  },

  /*
   * NOTIFICATION COPY IS NOT EMAIL COPY, and the two live in this file side by
   * side so the difference has to be deliberate.
   *
   * An email is read once, in full, with room to be warm. A notification row is
   * scanned in a column of other rows and is clipped by the platform: the
   * practical ceilings are roughly 50 characters of title and 120 of body,
   * front-loaded, because the end of the sentence is the part that gets cut.
   *
   * So the notification strings drop two things the email keeps: the thanks,
   * and "Open My Certificates to view or download it." The second was the
   * expensive one — it is an instruction for an action the row already
   * performs when you tap it, and it consumed the whole body on a phone,
   * pushing the fest's name out of view. The subject/body pairs above and
   * below are untouched; only the notification* pairs are shortened.
   */
  participation: {
    subject: ({ eventName, festName }) =>
      `Thank you for participating in ${eventName} at ${festName}`,
    body: ({ eventName, festName, collegeName }) =>
      `Thank you for participating in ${eventName} at ${festName}${formatAtCollege(collegeName)}.\n\n` +
      `We truly appreciate your enthusiasm and participation. We wish you all the best for your ` +
      `future endeavours and look forward to welcoming you again next year to participate in the ` +
      `same event and make it even more memorable.\n\n` +
      `Log in to dedal to view and download your participation certificate.`,
    notificationTitle: () => "Your certificate is ready",
    notificationBody: ({ festName }) => `Participation certificate from ${festName}.`,
  },

  specialMention: {
    subject: ({ eventName, festName }) => `Special Mention – ${eventName} at ${festName}`,
    body: ({ eventName, festName, collegeName }) =>
      `Congratulations on receiving a Special Mention for ${eventName} at ` +
      `${festName}${formatAtCollege(collegeName)}.\n\n` +
      `Your performance stood out and we are proud to recognise your effort.\n\n` +
      `Log in to dedal to view and download your certificate.`,
    notificationTitle: ({ eventName }) => `Special mention for ${eventName}`,
    notificationBody: ({ festName }) => `Your certificate from ${festName} is ready.`,
  },

  staff: {
    subject: ({ festName }) => `You have received a certificate from ${festName}`,
    body: ({ eventName, festName, collegeName, role }) =>
      `Thank you for your contribution to ${eventName} at ${festName}${formatAtCollege(collegeName)}.\n\n` +
      `Your role as ${role} was invaluable to the success of the event.\n\n` +
      `Log in to dedal to view and download your certificate.`,
    notificationTitle: ({ festName }) => `Your certificate from ${festName} is ready`,
    notificationBody: ({ role }) => `${role} certificate.`,
  },
};

const STAFF_CERTIFICATE_TYPES = [
  CERTIFICATE_TYPES.COORDINATOR,
  CERTIFICATE_TYPES.VOLUNTEER,
  CERTIFICATE_TYPES.ADMINISTRATOR,
];

/* The label the staff message uses: "Your role as Coordinator was invaluable". */
const STAFF_ROLE_LABELS = {
  [CERTIFICATE_TYPES.COORDINATOR]: "Coordinator",
  [CERTIFICATE_TYPES.VOLUNTEER]: "Volunteer",
  [CERTIFICATE_TYPES.ADMINISTRATOR]: "Administrator",
};

/*
 * Matched on the "winner" PREFIX rather than against the three known winner
 * types: a winner4th added later must read as a win the day it is introduced,
 * not silently fall through to the participation wording.
 */
function selectCertificateEmailTemplate(certificateType) {
  const type = String(certificateType ?? "");
  if (type.startsWith("winner")) {
    return CERTIFICATE_EMAIL_TEMPLATES.winner;
  }
  if (type === CERTIFICATE_TYPES.SPECIAL_MENTION) {
    return CERTIFICATE_EMAIL_TEMPLATES.specialMention;
  }
  if (STAFF_CERTIFICATE_TYPES.includes(type)) {
    return CERTIFICATE_EMAIL_TEMPLATES.staff;
  }
  // Participation, and anything unrecognised. The fallback is deliberately the
  // gracious one: thanking someone who won is odd, congratulating someone who
  // did not is worse.
  return CERTIFICATE_EMAIL_TEMPLATES.participation;
}

/*
 * The values the templates interpolate, with every hole filled.
 *
 * A certificate is released at a closing ceremony, often in bulk; one row with a
 * missing event name must not produce "You have won undefined" in somebody's
 * inbox. Each fallback is chosen to still read as a sentence.
 */
function buildCertificateCopyContext(certificate, { hostCollegeName = null } = {}) {
  const metadata = certificate?.metadata ?? {};
  const certificateType = certificate?.certificateType ?? CERTIFICATE_TYPES.PARTICIPATION;
  return {
    eventName: metadata.eventName || "your event",
    festName: metadata.festName || "the fest",
    // Omitted from the sentence entirely when unknown — see formatAtCollege.
    collegeName: hostCollegeName || null,
    role:
      metadata.role ||
      STAFF_ROLE_LABELS[certificateType] ||
      "team member",
  };
}

module.exports = {
  CERTIFICATE_EMAIL_TEMPLATES,
  selectCertificateEmailTemplate,
  buildCertificateCopyContext,
  STAFF_ROLE_LABELS,
};
