/*
 * THE EXACT WORDING of a round result, supplied by the client.
 *
 * The bodies are verbatim and must stay that way — emojis, ellipses and all.
 * They are stored as plain string constants rather than assembled from parts so
 * that a future edit is a single visible change to one literal, and nothing
 * quietly reformats them on the way out.
 *
 * WHAT CHANGED WITH THESE: the lot used to be a group NAME appended to one
 * shared advancement message ("you are in Group B"). It now selects the WHOLE
 * message — three different tones for three tiers of advancing performance. So
 * a lot is no longer a seating arrangement; it is an editorial decision about
 * what this particular participant should read.
 *
 * Only the SUBJECT interpolates. The bodies carry no placeholders at all, which
 * is why they are constants and not functions of the event.
 */

const OUTSTANDING_BODY =
  "Well, well… looks like you decided to steal the spotlight! 🏅 Your performance truly stood " +
  "out, and you've earned your place in the next round. We're genuinely proud to see your " +
  "effort paying off. ⚡ Keep that confidence alive, because now the real challenge begins. " +
  "Bring the same energy, push even harder, and show everyone why you belong here! 🚀";

const STRONG_BODY =
  "Congratulations! 🎉 You've made it to the next round! Your performance was strong enough to " +
  "take you forward, and we're happy to have you continue this journey with us. 🫡 But hey… " +
  "don't start celebrating just yet! The next round is waiting, so bring more confidence, more " +
  "effort, and a little extra madness. 🧨 Show us what you've really got!";

const IMPROVING_BODY =
  "Guess what? You're through! 🚀 Your performance earned you another chance to compete, and " +
  "we're glad to see you moving forward with us. You've done well, but we know you can do even " +
  "better. 🪄 Keep improving, bring your best game, and let's see you climb higher in the next " +
  "round! 🏁";

const ELIMINATED_BODY =
  "Thank you for being a part of the competition! 🫶 Your energy, effort, and enthusiasm added " +
  "something special to our fest, and we truly appreciate it. Unfortunately, we regret to " +
  "inform you that you have not been selected for the next round this time. But hey, this is " +
  "just one chapter, not the whole story. 🛠️ Take the experience, keep the spirit alive, and " +
  "come back stronger for the next competition. We'll be waiting to see your comeback! 🌱";

/*
 * The in-app body is the SAME text as the email, per the brief. It is referenced
 * rather than duplicated so the two can never drift apart in a later edit.
 */
const ROUND_NOTIFICATION_TEMPLATES = {
  outstanding: {
    subject: ({ eventName }) => `🏆 Outstanding Performance — ${eventName}`,
    body: () => OUTSTANDING_BODY,
    notificationTitle: () => "🏆 Outstanding Performance",
    notificationBody: () => OUTSTANDING_BODY,
  },

  strong: {
    subject: ({ eventName }) => `🎯 Selected — Strong Performance — ${eventName}`,
    body: () => STRONG_BODY,
    notificationTitle: () => "🎯 Selected — Strong Performance",
    notificationBody: () => STRONG_BODY,
  },

  improving: {
    subject: ({ eventName }) => `📈 Selected — Keep Improving — ${eventName}`,
    body: () => IMPROVING_BODY,
    notificationTitle: () => "📈 Selected — Keep Improving",
    notificationBody: () => IMPROVING_BODY,
  },

  eliminated: {
    subject: ({ eventName }) => `🌱 Thank you for participating — ${eventName}`,
    body: () => ELIMINATED_BODY,
    notificationTitle: ({ eventName }) => `🌱 Round Result — ${eventName}`,
    notificationBody: () => ELIMINATED_BODY,
  },
};

/*
 * Lot → tier. Both the friendly key the UI now sends ("outstanding") and the
 * bare letter an older client may still send ("A") map to the same tier, so a
 * cached frontend cannot start sending the wrong message.
 */
const TIER_BY_LOT = {
  outstanding: "outstanding",
  a: "outstanding",
  strong: "strong",
  b: "strong",
  improving: "improving",
  c: "improving",
};

/*
 * Which message an ADVANCING participant reads.
 *
 * An unlabelled advancer falls back to "strong" — the neutral "you're through"
 * of the three. The endpoint has always allowed advancing without lots, and the
 * alternative fallbacks are both wrong: "outstanding" congratulates people the
 * coordinator never singled out, and "improving" tells them to do better when
 * nobody said so.
 */
function selectAdvancementTemplate(lot) {
  const tier = TIER_BY_LOT[String(lot ?? "").trim().toLowerCase()];
  return ROUND_NOTIFICATION_TEMPLATES[tier] ?? ROUND_NOTIFICATION_TEMPLATES.strong;
}

module.exports = {
  ROUND_NOTIFICATION_TEMPLATES,
  selectAdvancementTemplate,
  TIER_BY_LOT,
};
