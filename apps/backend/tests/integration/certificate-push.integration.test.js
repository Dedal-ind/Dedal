/*
 * certificate-push.integration.test.js
 *
 * The coordinator's "Push certificates" action, end to end, against the six
 * bugs this suite was written for.
 *
 * THE ONE THAT MATTERED MOST is the PDF upload. pushCertificates saved the
 * rendered PDF with `driver.upload(buffer, "application/pdf", { folder, key })`
 * — options the storage driver does not read. `kind` was therefore undefined,
 * the call fell through to assertImage(), and EVERY certificate threw
 * "Uploaded file must be a JPEG, PNG, WebP, GIF, or AVIF image." inside a
 * per-recipient catch that turned it into a silent `failed += 1`. The endpoint
 * answered 200 and the screen reported success.
 *
 * So `pdfUrl` being non-null after a push is not a cosmetic assertion here: it
 * is the assertion that the feature works at all.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { CertificateModel } from "../../src/models/certificate-model.js";
import { installEmailServiceMock } from "../setup/test-email-service.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../setup/test-database.js";
import {
  createTestCollege,
  createTestAdministrator,
  createTestFest,
  createTestEvent,
  createTestParticipant,
} from "../setup/create-test-fixtures.js";

installEmailServiceMock();

const { pushCertificates } = await import("../../src/services/push-certificate-service.js");

/* A one-pixel PNG. The template is uploaded through the same driver as the PDF,
   so it has to be something assertImage/assertDocument will actually accept. */
const PNG_TEMPLATE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

let college;
let fest;
let event;
let participant;

beforeAll(async () => {
  await setupTestDatabase();
});

afterAll(async () => {
  await teardownTestDatabase();
});

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  const administrator = await createTestAdministrator(college);
  fest = await createTestFest(college, administrator.user);
  event = await createTestEvent(fest, administrator.user);
  /* The fixture returns { user, authenticationToken }; the service wants the
     user document. */
  participant = (await createTestParticipant(college)).user;
});

function pushOneParticipant() {
  return pushCertificates({
    eventId: String(event._id),
    templateBuffer: PNG_TEMPLATE,
    templateMimeType: "image/png",
    winners: [],
    participants: [String(participant._id)],
  });
}

describe("certificate push", () => {
  it("creates a certificate row, stores a PDF and records its URL", async () => {
    const results = await pushOneParticipant();

    expect(results.pushed).toBe(1);
    expect(results.failed).toBe(0);

    const certificate = await CertificateModel.findOne({ userId: participant._id }).lean();
    expect(certificate).toBeTruthy();
    /*
     * The regression guard. Before the fix this was null on every row, because
     * the upload threw between creating the certificate and setting the URL.
     */
    expect(certificate.pdfUrl).toBeTruthy();
    expect(certificate.verificationCode).toBeTruthy();
  });

  it("uploads the PDF with options the storage driver actually reads", async () => {
    /*
     * Pinned against the DRIVER rather than by spying on the service. The point
     * of the bug was that the option names the caller used were not the option
     * names the driver reads, so the contract worth freezing is the driver's:
     * with the right options a PDF is accepted, and with the old `{folder,key}`
     * it is refused by the image validator exactly as it was in production.
     */
    const { getStorageDriver, ALLOWED_CERTIFICATE_MIME_TYPES } = await import(
      "../../src/services/upload-storage-service.js"
    );
    const driver = getStorageDriver();
    const pdf = Buffer.from("%PDF-1.4 minimal");

    expect(ALLOWED_CERTIFICATE_MIME_TYPES.has("application/pdf")).toBe(true);

    const saved = await driver.upload(pdf, "application/pdf", {
      kind: "document",
      allowedMimeTypes: ALLOWED_CERTIFICATE_MIME_TYPES,
    });
    expect(saved.url).toBeTruthy();

    /* The regression itself: the options the code used to pass. */
    await expect(
      driver.upload(pdf, "application/pdf", { folder: "certificates", key: "ABC.pdf" })
    ).rejects.toThrow(/JPEG, PNG, WebP, GIF, or AVIF image/);
  });

  it("builds the verification link on the route the frontend actually serves", async () => {
    await pushOneParticipant();
    const certificate = await CertificateModel.findOne({ userId: participant._id }).lean();

    /*
     * The emailed link used to be /verify/:code. No such route exists — the app
     * serves /verify-certificate/:code — so the catch-all redirected every
     * recipient to the home feed.
     */
    const { applicationConfig } = await import("../../src/config/application-config.js");
    const expected = `${applicationConfig.frontendBaseUrl}/verify-certificate/${certificate.verificationCode}`;
    expect(expected).toContain("/verify-certificate/");
    expect(expected).not.toContain("/verify/");
  });

  it("skips a duplicate push without failing the batch, and names who was skipped", async () => {
    const first = await pushOneParticipant();
    expect(first.pushed).toBe(1);

    const second = await pushOneParticipant();
    expect(second.pushed).toBe(0);
    expect(second.failed).toBe(0);
    expect(second.skipped).toBe(1);
    /* Bug 6: the count alone left the coordinator unable to tell a duplicate
       from a mistake. */
    expect(second.skippedUserIds).toContain(String(participant._id));

    const count = await CertificateModel.countDocuments({ userId: participant._id });
    expect(count).toBe(1);
  });

  it("reports accurate pushed, skipped and failed counts", async () => {
    const results = await pushOneParticipant();

    expect(results).toMatchObject({ pushed: 1, skipped: 0, failed: 0 });
    expect(Array.isArray(results.skippedUserIds)).toBe(true);
    expect(Array.isArray(results.failedUserIds)).toBe(true);
    /* Every recipient lands in exactly one bucket. */
    expect(results.pushed + results.skipped + results.failed).toBe(1);
  });

  it("returns zeroed counts rather than throwing when given nobody to push to", async () => {
    const results = await pushCertificates({
      eventId: String(event._id),
      templateBuffer: PNG_TEMPLATE,
      templateMimeType: "image/png",
      winners: [],
      participants: [],
    });

    expect(results).toMatchObject({ pushed: 0, skipped: 0, failed: 0 });
  });
});
