import { describe, it, expect } from "vitest";
import {
  selectCertificateEmailTemplate,
  buildCertificateCopyContext,
} from "../../../src/helpers/certificate-release-copy.js";

/*
 * The wording rules, exercised directly. These are the assertions that would
 * have caught the original bug: every recipient getting the same sentence.
 */

function render(certificateType, { hostCollegeName = "RV College", metadata = {} } = {}) {
  const certificate = {
    certificateType,
    metadata: { eventName: "Robowars", festName: "Techfest", ...metadata },
  };
  const template = selectCertificateEmailTemplate(certificateType);
  const context = buildCertificateCopyContext(certificate, { hostCollegeName });
  return {
    subject: template.subject(context),
    body: template.body(context),
    notificationTitle: template.notificationTitle(context),
    notificationBody: template.notificationBody(context),
  };
}

describe("winner certificates", () => {
  it("congratulates, and names the event and host college", () => {
    const { subject, body } = render("winner1st");

    expect(subject).toBe("Congratulations! You've won Robowars at Techfest");
    expect(body).toContain("You have successfully won Robowars at Techfest, RV College.");
    expect(body).toContain("download your winner certificate");
  });

  it("uses the same wording for every placing", () => {
    for (const type of ["winner1st", "winner2nd", "winner3rd"]) {
      expect(render(type).subject).toContain("You've won");
    }
  });

  it("treats an unseen winner type as a win, not a participation", () => {
    // Matched on the "winner" prefix, so a winner4th added later does not
    // silently start thanking people for taking part.
    expect(render("winner4th").subject).toContain("You've won");
  });

  it("titles the in-app notification with the event", () => {
    expect(render("winner1st").notificationTitle).toBe("Congratulations! You've won Robowars!");
  });
});

describe("participation certificates", () => {
  it("thanks rather than congratulates", () => {
    const { subject, body, notificationTitle } = render("participation");

    expect(subject).toBe("Thank you for participating in Robowars at Techfest");
    expect(body).toContain("Thank you for participating in Robowars at Techfest, RV College.");
    expect(body).not.toContain("won");
    expect(notificationTitle).toBe("Your participation certificate is ready");
  });
});

describe("crew certificates", () => {
  it("names the role in the body", () => {
    const { subject, body } = render("coordinator");

    expect(subject).toBe("You have received a certificate from Techfest");
    expect(body).toContain("Your role as Coordinator was invaluable");
  });

  it("prefers the role recorded on the certificate over the type's label", () => {
    const { body } = render("volunteer", { metadata: { role: "Registration Desk Lead" } });
    expect(body).toContain("Your role as Registration Desk Lead was invaluable");
  });

  it("covers volunteer and administrator too", () => {
    expect(render("volunteer").body).toContain("Your role as Volunteer");
    expect(render("administrator").body).toContain("Your role as Administrator");
  });
});

describe("special mention", () => {
  it("has its own subject and opening", () => {
    const { subject, body } = render("specialMention");
    expect(subject).toBe("Special Mention – Robowars at Techfest");
    expect(body).toContain("Congratulations on receiving a Special Mention for Robowars");
  });
});

describe("missing data", () => {
  it("omits the college clause entirely rather than printing a gap", () => {
    const { body } = render("participation", { hostCollegeName: null });

    expect(body).toContain("Thank you for participating in Robowars at Techfest.");
    expect(body).not.toContain(", .");
    expect(body).not.toContain("null");
  });

  it("falls back to readable phrases for a missing event or fest", () => {
    const { subject, body } = render("participation", {
      metadata: { eventName: null, festName: null },
    });

    expect(subject).toBe("Thank you for participating in your event at the fest");
    expect(body).not.toContain("undefined");
    expect(body).not.toContain("null");
  });

  it("treats an unknown type as a participation, not a crash", () => {
    const { subject } = render("somethingNew");
    expect(subject).toContain("Thank you for participating");
  });

  it("survives a certificate with no metadata at all", () => {
    const template = selectCertificateEmailTemplate(undefined);
    const context = buildCertificateCopyContext({}, {});
    expect(() => template.body(context)).not.toThrow();
    expect(template.body(context)).not.toContain("undefined");
  });
});
