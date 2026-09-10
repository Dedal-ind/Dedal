import { describe, it, expect } from "vitest";
import {
  selectPlacementTemplate,
  buildRoundCopyContext,
} from "../../../src/helpers/round-notification-copy.js";
import {
  ROUND_NOTIFICATION_TEMPLATES,
  selectAdvancementTemplate,
} from "../../../src/constants/round-notification-templates.js";

function contextFor(overrides = {}) {
  return buildRoundCopyContext({
    event: { eventName: "Robowars" },
    festName: "Techfest",
    hostCollegeName: "RV College",
    ...overrides,
  });
}

/*
 * The four round messages are supplied VERBATIM by the client. These assertions
 * pin the exact opening and closing of each body, so a later "tidy-up" that
 * strips an emoji or an ellipsis fails here rather than in somebody's inbox.
 */
describe("exact client copy", () => {
  it("keeps the Outstanding message word for word", () => {
    const template = ROUND_NOTIFICATION_TEMPLATES.outstanding;
    const body = template.body(contextFor());

    expect(template.subject(contextFor())).toBe("🏆 Outstanding Performance — Robowars");
    expect(template.notificationTitle(contextFor())).toBe("🏆 Outstanding Performance");
    expect(body).toBe(
      "Well, well… looks like you decided to steal the spotlight! 🏅 Your performance truly " +
        "stood out, and you've earned your place in the next round. We're genuinely proud to see " +
        "your effort paying off. ⚡ Keep that confidence alive, because now the real challenge " +
        "begins. Bring the same energy, push even harder, and show everyone why you belong here! 🚀",
    );
  });

  it("keeps the Strong message word for word", () => {
    const template = ROUND_NOTIFICATION_TEMPLATES.strong;

    expect(template.subject(contextFor())).toBe("🎯 Selected — Strong Performance — Robowars");
    expect(template.notificationTitle(contextFor())).toBe("🎯 Selected — Strong Performance");
    expect(template.body(contextFor())).toBe(
      "Congratulations! 🎉 You've made it to the next round! Your performance was strong enough " +
        "to take you forward, and we're happy to have you continue this journey with us. 🫡 But " +
        "hey… don't start celebrating just yet! The next round is waiting, so bring more " +
        "confidence, more effort, and a little extra madness. 🧨 Show us what you've really got!",
    );
  });

  it("keeps the Keep Improving message word for word", () => {
    const template = ROUND_NOTIFICATION_TEMPLATES.improving;

    expect(template.subject(contextFor())).toBe("📈 Selected — Keep Improving — Robowars");
    expect(template.notificationTitle(contextFor())).toBe("📈 Selected — Keep Improving");
    expect(template.body(contextFor())).toBe(
      "Guess what? You're through! 🚀 Your performance earned you another chance to compete, and " +
        "we're glad to see you moving forward with us. You've done well, but we know you can do " +
        "even better. 🪄 Keep improving, bring your best game, and let's see you climb higher in " +
        "the next round! 🏁",
    );
  });

  it("keeps the elimination message word for word", () => {
    const template = ROUND_NOTIFICATION_TEMPLATES.eliminated;

    expect(template.subject(contextFor())).toBe("🌱 Thank you for participating — Robowars");
    expect(template.notificationTitle(contextFor())).toBe("🌱 Round Result — Robowars");
    expect(template.body(contextFor())).toBe(
      "Thank you for being a part of the competition! 🫶 Your energy, effort, and enthusiasm " +
        "added something special to our fest, and we truly appreciate it. Unfortunately, we " +
        "regret to inform you that you have not been selected for the next round this time. But " +
        "hey, this is just one chapter, not the whole story. 🛠️ Take the experience, keep the " +
        "spirit alive, and come back stronger for the next competition. We'll be waiting to see " +
        "your comeback! 🌱",
    );
  });

  it("sends the SAME text to the inbox as to the mailbox", () => {
    for (const key of ["outstanding", "strong", "improving", "eliminated"]) {
      const template = ROUND_NOTIFICATION_TEMPLATES[key];
      expect(template.notificationBody(contextFor())).toBe(template.body(contextFor()));
    }
  });

  it("interpolates the real event name into every subject", () => {
    const context = contextFor({ event: { eventName: "Battle of Bands" } });
    for (const key of ["outstanding", "strong", "improving", "eliminated"]) {
      const subject = ROUND_NOTIFICATION_TEMPLATES[key].subject(context);
      expect(subject).toContain("Battle of Bands");
      expect(subject).not.toContain("[eventName]");
    }
  });
});

describe("lot selects the tier", () => {
  it("maps the friendly keys the UI sends", () => {
    expect(selectAdvancementTemplate("outstanding").notificationTitle({})).toBe(
      "🏆 Outstanding Performance",
    );
    expect(selectAdvancementTemplate("strong").notificationTitle({})).toBe(
      "🎯 Selected — Strong Performance",
    );
    expect(selectAdvancementTemplate("improving").notificationTitle({})).toBe(
      "📈 Selected — Keep Improving",
    );
  });

  it("still honours bare A/B/C from an older client", () => {
    // A cached frontend must not start sending the wrong tier's message.
    expect(selectAdvancementTemplate("A").notificationTitle({})).toBe("🏆 Outstanding Performance");
    expect(selectAdvancementTemplate("b").notificationTitle({})).toBe(
      "🎯 Selected — Strong Performance",
    );
    expect(selectAdvancementTemplate("C").notificationTitle({})).toBe(
      "📈 Selected — Keep Improving",
    );
  });

  it("falls back to Strong for an unlabelled advancer", () => {
    /*
     * The neutral "you're through". Outstanding would congratulate someone the
     * coordinator never singled out; Improving would tell them to do better when
     * nobody said so.
     */
    expect(selectAdvancementTemplate(null).notificationTitle({})).toBe(
      "🎯 Selected — Strong Performance",
    );
    expect(selectAdvancementTemplate("nonsense").notificationTitle({})).toBe(
      "🎯 Selected — Strong Performance",
    );
  });
});

describe("podium", () => {
  it("gives each placement its own subject and title", () => {
    expect(selectPlacementTemplate(1).subject(contextFor())).toBe(
      "Congratulations! You've won Robowars at Techfest",
    );
    expect(selectPlacementTemplate(2).subject(contextFor())).toBe("2nd Place — Robowars at Techfest");
    expect(selectPlacementTemplate(3).subject(contextFor())).toBe("3rd Place — Robowars at Techfest");
  });

  it("distinguishes winning from merely advancing", () => {
    // A winner told to "await the next round" is the failure this guards.
    const winnerBody = selectPlacementTemplate(1).body(contextFor());
    expect(winnerBody).toContain("successfully won");
    expect(winnerBody).not.toContain("next round");
  });

  it("treats anything off the podium as not a placement", () => {
    expect(selectPlacementTemplate(4)).toBeNull();
    expect(selectPlacementTemplate(undefined)).toBeNull();
  });

  it("omits the college clause rather than printing a gap", () => {
    const body = selectPlacementTemplate(1).body(contextFor({ hostCollegeName: null }));
    expect(body).not.toContain(", .");
    expect(body).not.toContain("null");
  });
});
