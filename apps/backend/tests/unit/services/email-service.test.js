import { describe, it, expect, beforeEach, afterAll } from "vitest";

/*
 * This suite exercises the REAL email service, not the mock: the point is to
 * check the subjects and bodies it composes, that the sender is assembled
 * correctly, and that a dead provider is swallowed rather than thrown.
 *
 * Delivery is an HTTPS call to Resend, so global.fetch is replaced with a
 * recorder before the service is imported — no network, no provider account,
 * no API key beyond the fake one below. RESEND_API_KEY must be set BEFORE the
 * import, because application-config reads it at load and its presence is what
 * selects the transport.
 */
const sentMessages = [];

// null = deliver. "network" = the request itself fails (DNS, refused, abort).
// A number = the provider answered with that HTTP status.
let transportFailure = null;

process.env.RESEND_API_KEY = "re_test_key";

const originalFetch = global.fetch;
const fetchCalls = [];

global.fetch = async (requestUrl, requestOptions) => {
  fetchCalls.push({ requestUrl, requestOptions });

  if (transportFailure === "network") {
    throw new Error("connection refused");
  }

  const payload = JSON.parse(requestOptions.body);
  // Flattened to the shape the assertions read: Resend takes `to` as an array.
  sentMessages.push({
    from: payload.from,
    to: payload.to[0],
    subject: payload.subject,
    text: payload.text,
  });

  if (typeof transportFailure === "number") {
    return {
      ok: false,
      status: transportFailure,
      text: async () => '{"message":"the provider refused"}',
    };
  }
  return { ok: true, status: 200, text: async () => '{"id":"test-message-id"}' };
};

afterAll(() => {
  global.fetch = originalFetch;
});

const {
  sendOtpEmail,
  sendAssignmentInvitation,
  sendAssignmentRevocation,
  sendTeamInvitationEmail,
  getActiveEmailDriverName,
} = await import("../../../src/services/email-service.js");

const INVITATION = {
  emailAddress: "coordinator@example.com",
  role: "coordinator",
  festName: "Alliance ONE 2027",
};

beforeEach(() => {
  sentMessages.length = 0;
  fetchCalls.length = 0;
  transportFailure = null;
});

describe("transport", () => {
  it("selects the resend driver when an API key is configured", () => {
    expect(getActiveEmailDriverName()).toBe("resend");
  });

  it("posts to Resend with the key as a bearer token", async () => {
    await sendOtpEmail("person@example.com", "123456");

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].requestUrl).toBe("https://api.resend.com/emails");
    expect(fetchCalls[0].requestOptions.method).toBe("POST");
    expect(fetchCalls[0].requestOptions.headers.Authorization).toBe("Bearer re_test_key");
  });

  /*
   * The address in the test environment is bare, so the display name is folded
   * in. An address that already carries its own name must be left alone, or the
   * result is a malformed nested From.
   */
  it("sends the configured sender address", async () => {
    await sendOtpEmail("person@example.com", "123456");
    expect(sentMessages[0].from).toContain(process.env.EMAIL_FROM_ADDRESS);
  });

  it("resolves false when the provider rejects the send, without throwing", async () => {
    transportFailure = 403;
    expect(await sendOtpEmail("person@example.com", "123456")).toBe(false);
  });

  it("resolves false when the request itself fails, without throwing", async () => {
    transportFailure = "network";
    expect(await sendOtpEmail("person@example.com", "123456")).toBe(false);
  });
});

describe("sendAssignmentInvitation", () => {
  it("names the role and the fest in the subject", async () => {
    await sendAssignmentInvitation(INVITATION);

    expect(sentMessages[0].subject).toBe(
      "You've been assigned as coordinator for Alliance ONE 2027"
    );
    expect(sentMessages[0].to).toBe("coordinator@example.com");
  });

  it("puts the sign-in URL in the body", async () => {
    await sendAssignmentInvitation(INVITATION);

    expect(sentMessages[0].text).toContain(process.env.FRONTEND_BASE_URL);
    expect(sentMessages[0].text).toContain("assigned as coordinator for Alliance ONE 2027");
  });

  it("resolves true on delivery and false on a dead host, never throwing", async () => {
    expect(await sendAssignmentInvitation(INVITATION)).toBe(true);

    transportFailure = "network";
    expect(await sendAssignmentInvitation(INVITATION)).toBe(false);
  });
});

describe("sendAssignmentRevocation", () => {
  it("names the role and the fest in the subject", async () => {
    await sendAssignmentRevocation({ ...INVITATION, reason: null });

    expect(sentMessages[0].subject).toBe(
      "Your coordinator assignment for Alliance ONE 2027 has been revoked"
    );
  });

  it("mentions the reason when one is given", async () => {
    await sendAssignmentRevocation({ ...INVITATION, reason: "Left the college" });
    expect(sentMessages[0].text).toContain("Reason: Left the college");
  });

  it("omits the reason line entirely when none is given", async () => {
    await sendAssignmentRevocation({ ...INVITATION, reason: null });
    expect(sentMessages[0].text).not.toContain("Reason:");
  });

  it("resolves false on a dead host rather than throwing", async () => {
    transportFailure = "network";
    expect(await sendAssignmentRevocation({ ...INVITATION, reason: null })).toBe(false);
  });
});

describe("sendTeamInvitationEmail", () => {
  it("names the team and event, and addresses the member", async () => {
    await sendTeamInvitationEmail({
      memberEmail: "member@example.com",
      teamName: "Night Owls",
      eventName: "CodeSangram",
      festName: "Alliance ONE 2027",
      leaderName: "Asha",
      signInUrl: "https://example.test/sign-in",
    });

    expect(sentMessages[0].to).toBe("member@example.com");
    expect(sentMessages[0].subject).toBe('You\'re on team "Night Owls" for CodeSangram');
    expect(sentMessages[0].text).toContain("Asha");
    expect(sentMessages[0].text).toContain("https://example.test/sign-in");
  });
});

describe("sendOtpEmail", () => {
  /*
   * There is no development short-circuit any more — the driver decides — so
   * this must reach the transport like every other sender.
   */
  it("still composes its own subject and body after the shared-sender extraction", async () => {
    await sendOtpEmail("person@example.com", "123456");

    expect(sentMessages[0].subject).toBe("Your Dedal code");
    expect(sentMessages[0].text).toContain("123456");
  });

  it("resolves false on a dead host rather than throwing", async () => {
    transportFailure = "network";
    expect(await sendOtpEmail("person@example.com", "123456")).toBe(false);
  });
});
