/*
 * PODIUM wording, and the shared context every round message interpolates.
 *
 * The ADVANCEMENT and ELIMINATION wording used to live here too. It now lives in
 * constants/round-notification-templates.js, because the client supplies that
 * copy verbatim — emojis and all — and a file of exact literals they may hand us
 * again is a different kind of file from this one. Keeping both here would have
 * invited someone to "tidy" text that must not be touched.
 *
 * What remains is the podium (first/second/third), which is ours to word, and
 * the context builder both files share.
 *
 * A NOTE ON collegeName: it is the college HOSTING the fest, naming where the
 * event happened — not the recipient's own college, which would read as "you
 * won at your own college" to every visiting competitor.
 */

/* ", RV College" or "" — never ", null". */
function formatAtCollege(collegeName) {
  return collegeName ? `, ${collegeName}` : "";
}

const PODIUM_TEMPLATES = {
  winner1st: {
    subject: ({ eventName, festName }) => `Congratulations! You've won ${eventName} at ${festName}`,
    body: ({ eventName, festName, collegeName }) =>
      `Congratulations! 🎉\n\n` +
      `You have successfully won ${eventName} at ${festName}${formatAtCollege(collegeName)}.\n\n` +
      `Your achievement is truly commendable, and we are proud to have you as one of the winners.\n\n` +
      `We wish you continued success and hope to see you participate and achieve more in our future events.`,
    notificationTitle: ({ eventName }) => `Congratulations! You've won ${eventName}!`,
    notificationBody: ({ festName }) =>
      `You finished first at ${festName}. Your certificate follows once the fest releases them.`,
  },

  winner2nd: {
    subject: ({ eventName, festName }) => `2nd Place — ${eventName} at ${festName}`,
    body: ({ eventName, festName, collegeName }) =>
      `Congratulations! You have secured 2nd place in ${eventName} at ` +
      `${festName}${formatAtCollege(collegeName)}.\n\n` +
      `Your achievement is truly commendable. We wish you continued success and hope to see ` +
      `you compete again.`,
    notificationTitle: ({ eventName }) => `You've secured 2nd place in ${eventName}!`,
    notificationBody: ({ festName }) =>
      `You finished second at ${festName}. Your certificate follows once the fest releases them.`,
  },

  winner3rd: {
    subject: ({ eventName, festName }) => `3rd Place — ${eventName} at ${festName}`,
    body: ({ eventName, festName, collegeName }) =>
      `Congratulations! You have secured 3rd place in ${eventName} at ` +
      `${festName}${formatAtCollege(collegeName)}.\n\n` +
      `Your achievement is truly commendable. We wish you continued success and hope to see ` +
      `you compete again.`,
    notificationTitle: ({ eventName }) => `You've secured 3rd place in ${eventName}!`,
    notificationBody: ({ festName }) =>
      `You finished third at ${festName}. Your certificate follows once the fest releases them.`,
  },
};

const TEMPLATE_BY_PLACEMENT = { 1: "winner1st", 2: "winner2nd", 3: "winner3rd" };

/* Placement 1/2/3 pick a podium template; anything else is not a win. */
function selectPlacementTemplate(placement) {
  return PODIUM_TEMPLATES[TEMPLATE_BY_PLACEMENT[Number(placement)]] ?? null;
}

/*
 * The values every template interpolates, with each hole filled.
 *
 * A round result goes out in bulk at the end of a heat; one missing event name
 * must not put "advanced past undefined" in somebody's inbox. Each fallback is
 * chosen to still read as a sentence.
 */
function buildRoundCopyContext({ event, festName = null, hostCollegeName = null, lot = null }) {
  return {
    eventName: event?.eventName || "your event",
    festName: festName || "the fest",
    collegeName: hostCollegeName || null,
    lot: lot || null,
  };
}

module.exports = {
  PODIUM_TEMPLATES,
  selectPlacementTemplate,
  buildRoundCopyContext,
};
