import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { CertificateModel } from "../../../src/models/certificate-model.js";
import { RegistrationModel } from "../../../src/models/registration-model.js";
import { EventModel } from "../../../src/models/event-model.js";
import { FestModel } from "../../../src/models/fest-model.js";
import { UserModel } from "../../../src/models/user-model.js";
import { CollegeModel } from "../../../src/models/college-model.js";
import { StaffAssignmentModel } from "../../../src/models/staff-assignment-model.js";
import {
  installEmailServiceMock,
  findRecordedEmailsOfKind,
  clearRecordedEmails,
} from "../../setup/test-email-service.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../../setup/test-database.js";
import {
  createTestCollege,
  createTestAdministrator,
  createTestFest,
  createTestEvent,
  createTestStaffMember,
} from "../../setup/create-test-fixtures.js";

installEmailServiceMock();
const certificateService = await import("../../../src/services/certificate-service.js");

let college;
let admin;
let fest;
let event;
let participantCounter = 0;

async function createConfirmedParticipant(overrides = {}) {
  participantCounter += 1;
  const user = await UserModel.create({
    emailAddress: `participant${participantCounter}@example.com`,
    fullName: `Participant ${participantCounter}`,
    collegeId: college._id,
    usn: `1AA00AA0${participantCounter.toString().padStart(2, "0")}`,
    isProfileComplete: true,
  });
  await RegistrationModel.create({
    eventId: event._id,
    userId: user._id,
    status: "confirmed",
    feeAmountSnapshotPaise: 0,
    ...overrides,
  });
  return user;
}

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([
    CertificateModel.createIndexes(),
    RegistrationModel.createIndexes(),
    EventModel.createIndexes(),
    FestModel.createIndexes(),
    UserModel.createIndexes(),
    CollegeModel.createIndexes(),
    StaffAssignmentModel.createIndexes(),
  ]);
});

beforeEach(async () => {
  await clearAllCollections();
  participantCounter = 0;
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, { status: "published" });
  event = await createTestEvent(fest, admin.user, { status: "completed" });
});

afterAll(teardownTestDatabase);

describe("generateCertificatesForFest", () => {
  it("creates one certificate per participant and staff member", async () => {
    await createConfirmedParticipant();
    await createConfirmedParticipant();
    await createConfirmedParticipant();
    await createTestStaffMember(fest, "coordinator");

    const result = await certificateService.generateCertificatesForFest(admin.user._id, fest.id);

    expect(result.generatedCount).toBe(4);
    expect(result.skippedCount).toBe(0);
    expect(await CertificateModel.countDocuments({ festId: fest._id })).toBe(4);
  });

  it("is idempotent — a second run skips existing certificates", async () => {
    await createConfirmedParticipant();
    await createConfirmedParticipant();
    await certificateService.generateCertificatesForFest(admin.user._id, fest.id);

    const secondRun = await certificateService.generateCertificatesForFest(admin.user._id, fest.id);

    expect(secondRun.generatedCount).toBe(0);
    expect(secondRun.skippedCount).toBe(2);
    expect(await CertificateModel.countDocuments({ festId: fest._id })).toBe(2);
  });

  it("assigns a winner certificate type for a winning registration", async () => {
    const winner = await createConfirmedParticipant({ status: "winner1st" });
    await certificateService.generateCertificatesForFest(admin.user._id, fest.id);

    const certificate = await CertificateModel.findOne({ userId: winner._id }).lean();
    expect(certificate.certificateType).toBe("winner1st");
    expect(certificate.metadata.position).toBe("1st");
  });

  it("assigns the coordinator certificate type for a coordinator", async () => {
    const coordinator = await createTestStaffMember(fest, "coordinator");
    await certificateService.generateCertificatesForFest(admin.user._id, fest.id);

    const certificate = await CertificateModel.findOne({ userId: coordinator.user._id }).lean();
    expect(certificate.certificateType).toBe("coordinator");
    expect(certificate.eventId).toBeNull();
    expect(certificate.metadata.role).toBe("coordinator");
  });

  it("freezes the metadata snapshot against a later profile edit", async () => {
    const participant = await createConfirmedParticipant();
    await certificateService.generateCertificatesForFest(admin.user._id, fest.id);

    await UserModel.updateOne({ _id: participant._id }, { $set: { fullName: "Renamed Later" } });

    const certificate = await CertificateModel.findOne({ userId: participant._id }).lean();
    expect(certificate.metadata.fullName).toBe("Participant 1");
    expect(certificate.metadata.usn).toBe("1AA00AA001");
    expect(certificate.metadata.collegeName).toBe("Alliance");
  });
});

describe("release and read", () => {
  it("flips every pending certificate to released and stamps the fest", async () => {
    await createConfirmedParticipant();
    await createConfirmedParticipant();
    await certificateService.generateCertificatesForFest(admin.user._id, fest.id);

    const result = await certificateService.releaseCertificatesForFest(admin.user._id, fest.id);

    expect(result.releasedCount).toBe(2);
    const released = await CertificateModel.find({ festId: fest._id }).lean();
    expect(released.every((certificate) => certificate.status === "released")).toBe(true);
    expect(released.every((certificate) => certificate.releasedAt !== null)).toBe(true);
    const reloadedFest = await FestModel.findById(fest._id).lean();
    expect(reloadedFest.certificatesReleasedAt).not.toBeNull();
  });

  it("sends winners and participants DIFFERENT emails on one release", async () => {
    clearRecordedEmails();
    const winner = await createConfirmedParticipant({ status: "winner1st" });
    const participant = await createConfirmedParticipant();
    await certificateService.generateCertificatesForFest(admin.user._id, fest.id);

    await certificateService.releaseCertificatesForFest(admin.user._id, fest.id);
    // The notice is fire-and-forget; let its microtasks drain.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const sent = findRecordedEmailsOfKind("generic");
    const toWinner = sent.find((email) => email.emailAddress === winner.emailAddress);
    const toParticipant = sent.find((email) => email.emailAddress === participant.emailAddress);

    expect(toWinner).toBeDefined();
    expect(toParticipant).toBeDefined();
    // The whole point: one release, two different messages.
    expect(toWinner.subject).toContain("You've won");
    expect(toParticipant.subject).toContain("Thank you for participating");
    expect(toWinner.subject).not.toBe(toParticipant.subject);
    expect(toWinner.text).toContain("winner certificate");
    expect(toParticipant.text).toContain("participation certificate");
  });

  it("refuses a second release", async () => {
    await createConfirmedParticipant();
    await certificateService.generateCertificatesForFest(admin.user._id, fest.id);
    await certificateService.releaseCertificatesForFest(admin.user._id, fest.id);

    await expect(
      certificateService.releaseCertificatesForFest(admin.user._id, fest.id)
    ).rejects.toMatchObject({ errorCode: "CERTIFICATES_ALREADY_RELEASED", statusCode: 409 });
  });

  it("lists only released certificates for the holder", async () => {
    const participant = await createConfirmedParticipant();
    await certificateService.generateCertificatesForFest(admin.user._id, fest.id);

    expect(await certificateService.listMyCertificates(participant._id)).toHaveLength(0);

    await certificateService.releaseCertificatesForFest(admin.user._id, fest.id);
    const mine = await certificateService.listMyCertificates(participant._id);
    expect(mine).toHaveLength(1);
  });
});

describe("getCertificateByVerificationCode", () => {
  async function generateReleaseAndReadCode(participant) {
    await certificateService.generateCertificatesForFest(admin.user._id, fest.id);
    const certificate = await CertificateModel.findOne({ userId: participant._id }).lean();
    return certificate.verificationCode;
  }

  it("returns the public snapshot for a released certificate", async () => {
    const participant = await createConfirmedParticipant();
    const code = await generateReleaseAndReadCode(participant);
    await certificateService.releaseCertificatesForFest(admin.user._id, fest.id);

    const verified = await certificateService.getCertificateByVerificationCode(code);

    expect(verified.isValid).toBe(true);
    expect(verified.fullName).toBe("Participant 1");
    expect(verified.festName).toBe("Alliance ONE 2027");
    expect(verified).not.toHaveProperty("userId");
  });

  it("hides an unreleased certificate as not found", async () => {
    const participant = await createConfirmedParticipant();
    const code = await generateReleaseAndReadCode(participant);

    await expect(
      certificateService.getCertificateByVerificationCode(code)
    ).rejects.toMatchObject({ errorCode: "CERTIFICATE_NOT_FOUND", statusCode: 404 });
  });

  it("rejects an unknown code", async () => {
    await expect(
      certificateService.getCertificateByVerificationCode("ZZZZZZZZZZZZZZZZ")
    ).rejects.toMatchObject({ errorCode: "CERTIFICATE_NOT_FOUND", statusCode: 404 });
  });
});

describe("generateCertificatePdf", () => {
  async function releasedCertificateFor(userId) {
    await certificateService.generateCertificatesForFest(admin.user._id, fest.id);
    await certificateService.releaseCertificatesForFest(admin.user._id, fest.id);
    return CertificateModel.findOne({ userId });
  }

  it("returns a buffer and caches the rendered pdf on disk for a second call", async () => {
    const participant = await createConfirmedParticipant();
    const certificate = await releasedCertificateFor(participant._id);

    const first = await certificateService.generateCertificatePdf(certificate._id, participant._id);
    expect(Buffer.isBuffer(first.buffer)).toBe(true);
    expect(first.buffer.length).toBeGreaterThan(0);
    expect(first.fileName).toBe(`${certificate.verificationCode}.pdf`);

    // The first call recorded the cache path; the second must read it back byte-for-byte.
    const reloaded = await CertificateModel.findById(certificate._id);
    expect(reloaded.pdfUrl).toBeTruthy();

    const second = await certificateService.generateCertificatePdf(certificate._id, participant._id);
    expect(second.fileName).toBe(first.fileName);
    expect(Buffer.isBuffer(second.buffer)).toBe(true);
    expect(second.buffer.equals(first.buffer)).toBe(true);
  });

  it("handles two concurrent calls for the same certificate without corruption", async () => {
    const participant = await createConfirmedParticipant();
    const certificate = await releasedCertificateFor(participant._id);

    const [first, second] = await Promise.all([
      certificateService.generateCertificatePdf(certificate._id, participant._id),
      certificateService.generateCertificatePdf(certificate._id, participant._id),
    ]);

    expect(first.fileName).toBe(`${certificate.verificationCode}.pdf`);
    expect(second.fileName).toBe(first.fileName);
    expect(first.buffer.length).toBeGreaterThan(0);
    expect(second.buffer.length).toBeGreaterThan(0);
  });
});

describe("template rendering and event-scoped access", () => {
  function coordinatorScope(assignment, requestedEventIds = null) {
    return { isAdministrator: false, staffAssignment: assignment, requestedEventIds };
  }

  it("renders a preview PDF with no template set (unchanged plain layout)", async () => {
    const buffer = await certificateService.previewCertificatePdf(admin.user._id, fest.id);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.slice(0, 5).toString()).toBe("%PDF-");
  });

  it("still renders a valid PDF when the background image is unreachable", async () => {
    await FestModel.updateOne(
      { _id: fest._id },
      {
        certificateTemplate: {
          backgroundImageUrl: "http://127.0.0.1:9/never-resolves.png",
          signatureImageUrl: null,
          signatoryName: "Dr. Sample Signer",
          signatoryTitle: "Fest Convener",
        },
      }
    );
    const buffer = await certificateService.previewCertificatePdf(admin.user._id, fest.id);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.slice(0, 5).toString()).toBe("%PDF-");
  });

  it("lets a coordinator generate for a covered event only, without staff certificates", async () => {
    await createConfirmedParticipant();
    const otherEvent = await createTestEvent(fest, admin.user, {
      status: "completed",
      eventSlug: "uncovered-event",
    });
    const originalEvent = event;
    event = otherEvent;
    await createConfirmedParticipant();
    event = originalEvent;
    const coordinator = await createTestStaffMember(fest, "coordinator", {
      assignment: { eventIds: [originalEvent._id] },
    });

    const result = await certificateService.generateCertificatesForFest(
      coordinator.user._id,
      fest.id,
      {},
      coordinatorScope(coordinator.staffAssignment)
    );

    // Only the covered event's participant; no staff, no other event.
    expect(result.generatedCount).toBe(1);
    const certificates = await CertificateModel.find({ festId: fest._id }).lean();
    expect(certificates).toHaveLength(1);
    expect(String(certificates[0].eventId)).toBe(String(originalEvent._id));
  });

  it("refuses a coordinator naming an event outside their coverage", async () => {
    const otherEvent = await createTestEvent(fest, admin.user, {
      status: "completed",
      eventSlug: "outside-event",
    });
    const coordinator = await createTestStaffMember(fest, "coordinator", {
      assignment: { eventIds: [event._id] },
    });

    await expect(
      certificateService.generateCertificatesForFest(
        coordinator.user._id,
        fest.id,
        {},
        coordinatorScope(coordinator.staffAssignment, [String(otherEvent._id)])
      )
    ).rejects.toMatchObject({ errorCode: "PERMISSION_DENIED" });
    expect(await CertificateModel.countDocuments({})).toBe(0);
  });

  it("an administrator scope with no eventIds stays fest-wide, staff included", async () => {
    await createConfirmedParticipant();
    await createTestStaffMember(fest, "volunteer");
    const result = await certificateService.generateCertificatesForFest(
      admin.user._id,
      fest.id,
      {},
      { isAdministrator: true, staffAssignment: null, requestedEventIds: null }
    );
    expect(result.generatedCount).toBe(2);
  });

  it("a scoped release flips only the scoped rows and never stamps the fest", async () => {
    await createConfirmedParticipant();
    await createTestStaffMember(fest, "coordinator", {
      emailAddress: "cert-coordinator@example.com",
      assignment: { eventIds: [event._id] },
    });
    await certificateService.generateCertificatesForFest(admin.user._id, fest.id);

    const coordinator = await StaffAssignmentModel.findOne({ role: "coordinator" }).lean();
    const releaseResult = await certificateService.releaseCertificatesForFest(
      coordinator.userId,
      fest.id,
      {},
      coordinatorScope(coordinator)
    );

    expect(releaseResult.releasedCount).toBe(1); // the participant row; staff row untouched
    const reloadedFest = await FestModel.findById(fest._id).lean();
    expect(reloadedFest.certificatesReleasedAt ?? null).toBe(null);

    // The admin's fest-wide release still works afterwards and stamps the fest.
    const finalRelease = await certificateService.releaseCertificatesForFest(admin.user._id, fest.id);
    expect(finalRelease.releasedCount).toBe(1); // the staff certificate
    expect((await FestModel.findById(fest._id).lean()).certificatesReleasedAt).not.toBe(null);
  });
});
