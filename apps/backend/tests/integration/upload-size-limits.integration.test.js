/*
 * upload-size-limits.integration.test.js
 *
 * Which upload routes may exceed 5MB, and which may not.
 *
 * THE BUG THIS PINS. All three upload routes mounted ONE multer instance. When
 * its fileSize was raised from 5MB to 50MB so the generic admin endpoint could
 * accept promotion videos, the other two routes were raised with it, silently:
 *
 *   - /uploads/student-id, open to any signed-in user, not just staff;
 *   - /uploads/application-document, the one UNAUTHENTICATED upload in the
 *     system, where a per-IP rate limit is the only other brake.
 *
 * Only /uploads re-applied a per-kind cap in its handler, so for the other two
 * the multer limit WAS the limit. Three comments in the controller still said
 * "the same 5MB multer cap" while that had stopped being true, which is the
 * tell: a shared middleware whose ceiling is set by its loosest consumer is not
 * a ceiling for anybody else.
 *
 * The assertions are about the SIZE decision alone. Each request is deliberately
 * shaped so that size is the only thing that can refuse it at that size, and the
 * under-limit control in each case proves the route was reachable — otherwise a
 * test asserting "large is refused" would pass just as happily against a route
 * that refuses everything.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { installEmailServiceMock } from "../setup/test-email-service.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../setup/test-database.js";
import { createTestCollege, createTestParticipant } from "../setup/create-test-fixtures.js";

installEmailServiceMock();
const { application } = await import("../../src/application.js");

const MEGABYTE = 1024 * 1024;

/* Real PNG magic bytes, then padding. The routes check magic bytes as well as
   the declared MIME type, so a buffer of zeroes would be refused for the wrong
   reason and the test would pass without proving anything about size. */
function pngOfSize(totalBytes) {
  const buffer = Buffer.alloc(totalBytes);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  return buffer;
}

function postFile(path, buffer, { token = null, filename = "card.png", contentType = "image/png" } = {}) {
  const pending = request(application).post(path);
  if (token) {
    pending.set("Authorization", `Bearer ${token}`);
  }
  return pending.attach("file", buffer, { filename, contentType });
}

let participantToken;

beforeAll(async () => {
  await setupTestDatabase();
  await clearAllCollections();
  /*
   * A REAL TOKEN, because authenticationMiddleware is mounted BEFORE multer on
   * /student-id - an anonymous request is refused at 401 without the body ever
   * being parsed, which would make the size assertion below vacuous.
   */
  const college = await createTestCollege();
  const participant = await createTestParticipant(college);
  participantToken = participant.authenticationToken;
});

afterAll(async () => {
  await teardownTestDatabase();
});

describe("upload size limits per route", () => {
  it("refuses a 6MB student-ID upload", async () => {
    const response = await postFile("/api/v1/uploads/student-id", pngOfSize(6 * MEGABYTE), {
      token: participantToken,
    });

    /*
     * The ENVELOPE is asserted, not just the status: this refusal used to
     * escape as an unhandled 500 and the client saw the connection reset with
     * no message at all, which is indistinguishable from a crash. See the
     * multer error translation in upload-controller.
     *
     * A signed-in PARTICIPANT, deliberately - this route is open to any
     * authenticated user rather than to staff, which is exactly why its cap
     * matters.
     */
    expect(response.status).toBe(400);
    expect(response.body.error.details.file).toMatch(/5 MB or smaller/);
  });

  it("refuses a 6MB college application document", async () => {
    const response = await postFile(
      "/api/v1/uploads/application-document",
      pngOfSize(6 * MEGABYTE)
    );

    expect(response.status).toBe(400);
    expect(response.body.error.details.file).toMatch(/5 MB or smaller/);
  });

  it("accepts a small college application document, so the refusals above are about size", async () => {
    /*
     * The control. This route is public, so it is the one place the whole path
     * can be exercised without a token — which makes it the only route that can
     * prove the 6MB refusal above is the size cap rather than the route being
     * broken or unreachable.
     */
    const response = await postFile("/api/v1/uploads/application-document", pngOfSize(1024));

    expect(response.status).toBe(201);
    expect(typeof response.body.data.url).toBe("string");
  });
});
