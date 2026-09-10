import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { RegistrationModel } from "../../src/models/registration-model.js";
import { ScanModel } from "../../src/models/scan-model.js";
import { FestModel } from "../../src/models/fest-model.js";
import { CertificateModel } from "../../src/models/certificate-model.js";
import { installEmailServiceMock } from "../setup/test-email-service.js";
import { installRazorpayClientMock } from "../setup/test-razorpay-service.js";
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
  createTestPass,
  createTestEventCheckpoint,
  openRegistrationOverrides,
} from "../setup/create-test-fixtures.js";
import { migrateCertificateTemplateSimplify } from "../../src/helpers/migrate-certificate-template-simplify.js";
import { renderCertificatePdf } from "../../src/helpers/certificate-pdf.js";

installEmailServiceMock();
installRazorpayClientMock();
const { application } = await import("../../src/application.js");

let college;
let admin;
let fest;
let eventOne;
let eventTwo;
let participants;

function withToken(httpRequest, token) {
  return httpRequest.set("Authorization", `Bearer ${token}`);
}

/*
 * Fixture: two events; 3 confirmed registrations on event one, 2 on event two.
 * Participant 0 scans IN twice (one head) and OUT once at event one.
 */
async function seedFestData() {
  eventOne = await createTestEvent(
    fest,
    admin.user,
    openRegistrationOverrides({ eventSlug: "drill-one", eventName: "Finance" })
  );
  eventTwo = await createTestEvent(
    fest,
    admin.user,
    openRegistrationOverrides({ eventSlug: "drill-two", eventName: "Marketing" })
  );
  const checkpoint = await createTestEventCheckpoint(fest, eventOne._id, {
    directionMode: "inAndOut",
  });

  participants = [];
  for (let index = 0; index < 3; index += 1) {
    const participant = await createTestParticipant(college, {
      emailAddress: `drill${index}@example.com`,
      usn: `1DR00AA00${index}`,
    });
    await RegistrationModel.create({
      eventId: eventOne._id,
      userId: participant.user._id,
      status: "confirmed",
      feeAmountSnapshotPaise: 0,
      totalFeePaise: index === 0 ? 10000 : 0,
      paymentStatus: index === 0 ? "completed" : "notRequired",
      registeredAt: new Date(),
    });
    if (index < 2) {
      await RegistrationModel.create({
        eventId: eventTwo._id,
        userId: participant.user._id,
        status: "confirmed",
        feeAmountSnapshotPaise: 0,
        totalFeePaise: 0,
        paymentStatus: "notRequired",
        registeredAt: new Date(),
      });
    }
    participants.push(participant);
  }

  const pass = await createTestPass(fest, participants[0].user);
  for (const [scanIndex, direction] of [["a", "in"], ["b", "in"], ["c", "out"]]) {
    await ScanModel.create({
      clientScanId: `drill-scan-${scanIndex}`,
      passId: pass._id,
      checkpointId: checkpoint._id,
      scannedByUserId: admin.user._id,
      scanMethod: "qr",
      direction,
      result: "accepted",
      scannedAt: new Date(Date.now() + (scanIndex === "a" ? 0 : 1000)),
    });
  }
}

beforeAll(async () => {
  await setupTestDatabase();
  await RegistrationModel.createIndexes();
});

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, { status: "published" });
  await seedFestData();
});

afterAll(teardownTestDatabase);

describe("analytics summary — headline + eventId filter (sections A and C)", () => {
  it("reports headline counts and distinct-per-person check-ins/outs", async () => {
    const response = await withToken(
      request(application).get(`/api/v1/fests/${fest.id}/analytics/summary`),
      admin.authenticationToken
    );
    expect(response.status).toBe(200);
    // 3 + 2 confirmed rows; ONE person scanned in (twice = one head), one out.
    expect(response.body.data.headline).toMatchObject({
      totalRegistrationsCount: 5,
      totalCheckInsCount: 1,
      totalCheckOutsCount: 1,
      checkOutScanningObserved: true,
    });
    const eventOneScans = response.body.data.scansPerEvent.find(
      (row) => row.eventId === String(eventOne._id)
    );
    expect(eventOneScans).toMatchObject({ checkInsCount: 1, checkOutsCount: 1 });
  });

  it("?eventId= scopes EVERY count consistently, and per-event sums equal the fest total", async () => {
    const unfiltered = await withToken(
      request(application).get(`/api/v1/fests/${fest.id}/analytics/summary`),
      admin.authenticationToken
    );
    const filteredOne = await withToken(
      request(application).get(`/api/v1/fests/${fest.id}/analytics/summary?eventId=${eventOne.id}`),
      admin.authenticationToken
    );
    const filteredTwo = await withToken(
      request(application).get(`/api/v1/fests/${fest.id}/analytics/summary?eventId=${eventTwo.id}`),
      admin.authenticationToken
    );

    // The section-C proof: 3 + 2 filtered = 5 unfiltered.
    expect(filteredOne.body.data.headline.totalRegistrationsCount).toBe(3);
    expect(filteredTwo.body.data.headline.totalRegistrationsCount).toBe(2);
    expect(unfiltered.body.data.headline.totalRegistrationsCount).toBe(5);

    // Consistency: the filtered response's per-event arrays contain ONLY that
    // event, and revenue is scoped too (participant 0 paid on event one only).
    expect(filteredOne.body.data.funnel.perEvent).toHaveLength(1);
    expect(filteredOne.body.data.scansPerEvent).toHaveLength(1);
    expect(filteredOne.body.data.revenue.grossRevenuePaise).toBe(10000);
    expect(filteredTwo.body.data.revenue.grossRevenuePaise).toBe(0);
    expect(filteredTwo.body.data.headline.totalCheckInsCount).toBe(0);
  });
});

describe("scan drill-down roster + CSVs (section A)", () => {
  it("GET /scans?direction=IN returns one distinct row with the FIRST scan time", async () => {
    const response = await withToken(
      request(application).get(
        `/api/v1/fests/${fest.id}/events/${eventOne.id}/scans?direction=IN`
      ),
      admin.authenticationToken
    );
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1); // two IN scans, one person
    expect(response.body.data[0]).toMatchObject({
      emailAddress: "drill0@example.com",
      collegeName: "Alliance",
    });
    expect(response.body.data[0].firstScannedAt).toBeTruthy();

    const badDirection = await withToken(
      request(application).get(`/api/v1/fests/${fest.id}/events/${eventOne.id}/scans?direction=SIDEWAYS`),
      admin.authenticationToken
    );
    expect(badDirection.status).toBe(400);
  });

  it("check-ins.csv and check-outs.csv stream deduped rows with the spec filename", async () => {
    const checkIns = await withToken(
      request(application).get(
        `/api/v1/fests/${fest.id}/exports/events/${eventOne.id}/check-ins.csv`
      ),
      admin.authenticationToken
    );
    expect(checkIns.status).toBe(200);
    expect(checkIns.headers["content-type"]).toContain("text/csv");
    // {kind}-{eventSlug}-{yyyymmdd}.csv
    expect(checkIns.headers["content-disposition"]).toMatch(/check-ins-drill-one-\d{8}\.csv/);
    const checkInLines = checkIns.text.trim().split("\n");
    expect(checkInLines).toHaveLength(2); // header + ONE deduped row
    expect(checkInLines[1]).toContain("drill0@example.com");

    const checkOuts = await withToken(
      request(application).get(
        `/api/v1/fests/${fest.id}/exports/events/${eventOne.id}/check-outs.csv`
      ),
      admin.authenticationToken
    );
    expect(checkOuts.headers["content-disposition"]).toMatch(/check-outs-drill-one-\d{8}\.csv/);
    expect(checkOuts.text.trim().split("\n")).toHaveLength(2);
  });
});

describe("certificate simplification (section B.2)", () => {
  it("renders a PDF from documentTemplateUrl alone, with no signature layer", async () => {
    // An unreachable URL exercises the plain-render fallback; a null template the default.
    const pdfBuffer = await renderCertificatePdf({
      certificateType: "participation",
      metadata: {
        fullName: "Priya Rao",
        collegeName: "Alliance",
        usn: "1AL22CS042",
        festName: "Alliance ONE",
        festDates: "1–5 Mar 2027",
        eventName: "Finance",
      },
      verificationCode: "ABCD1234",
      verifyUrl: "https://example.com/verify/ABCD1234",
      template: { documentTemplateUrl: "http://127.0.0.1:9/never-resolves.png" },
    });
    expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
    expect(pdfBuffer.slice(0, 5).toString()).toBe("%PDF-");
  });

  it("migration folds backgroundImageUrl into documentTemplateUrl, idempotently", async () => {
    await FestModel.collection.updateOne(
      { _id: fest._id },
      {
        $set: {
          certificateTemplate: {
            backgroundImageUrl: "https://cdn.example.com/artwork.png",
            signatureImageUrl: "https://cdn.example.com/sig.png",
            signatoryName: "Dean Someone",
            signatoryTitle: "Dean",
          },
        },
      }
    );
    const firstRun = await migrateCertificateTemplateSimplify();
    expect(firstRun.convertedCount).toBe(1);
    const secondRun = await migrateCertificateTemplateSimplify();
    expect(secondRun.convertedCount).toBe(0);

    const migrated = await FestModel.findById(fest._id).lean();
    expect(migrated.certificateTemplate).toEqual({
      documentTemplateUrl: "https://cdn.example.com/artwork.png",
    });
  });

  it("push subset: generate + release with userIds touches exactly those participants", async () => {
    // Only completed/ongoing events are certifiable (CERTIFIABLE_EVENT_STATUSES).
    const { EventModel } = await import("../../src/models/event-model.js");
    await EventModel.updateOne({ _id: eventOne._id }, { $set: { status: "ongoing" } });
    const selected = [String(participants[0].user._id), String(participants[1].user._id)];
    const generateResponse = await withToken(
      request(application).post(`/api/v1/fests/${fest.id}/certificates/generate`),
      admin.authenticationToken
    ).send({ eventIds: [String(eventOne._id)], userIds: selected });
    expect(generateResponse.status).toBe(200);
    expect(generateResponse.body.data.generatedCount).toBe(2); // not 3

    const releaseResponse = await withToken(
      request(application).post(`/api/v1/fests/${fest.id}/certificates/release`),
      admin.authenticationToken
    ).send({ eventIds: [String(eventOne._id)], userIds: selected });
    expect(releaseResponse.status).toBe(200);

    const releasedCount = await CertificateModel.countDocuments({ status: "released" });
    const releasedUserIds = (await CertificateModel.find({ status: "released" }).select("userId").lean())
      .map((certificate) => String(certificate.userId))
      .sort();
    expect(releasedCount).toBe(2);
    expect(releasedUserIds).toEqual(selected.sort());
    // A subset release never stamps the fest-wide once-guard.
    expect((await FestModel.findById(fest._id)).certificatesReleasedAt).toBeNull();
  });
});
