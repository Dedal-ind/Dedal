import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { errorHandlerMiddleware } from "../../../src/middleware/error-handler-middleware.js";
import { ApplicationError } from "../../../src/helpers/application-error.js";

/*
 * The middleware is called directly rather than through a route: what is under
 * test is how it dresses an error for the client, and a real request would only
 * add ways for the error to be something other than the one we meant to send.
 */
function buildResponse() {
  const response = {
    statusCode: null,
    body: null,
    headers: {},
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return response;
}

const request = { method: "POST", originalUrl: "/api/v1/registrations" };

/* The handler logs every unexpected fault; the assertions below are about the wire. */
let errorLogSpy;

beforeEach(() => {
  errorLogSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterAll(() => {
  vi.restoreAllMocks();
});

function handle(error) {
  const response = buildResponse();
  errorHandlerMiddleware(error, request, response, () => {});
  return response;
}

describe("errors the application raised on purpose", () => {
  it("passes an ApplicationError's message through untouched", () => {
    const response = handle(
      new ApplicationError(409, "ALREADY_REGISTERED", "You're already registered for this event.")
    );

    expect(response.statusCode).toBe(409);
    expect(response.body.error.code).toBe("ALREADY_REGISTERED");
    expect(response.body.error.message).toBe("You're already registered for this event.");
  });

  /*
   * A 5xx someone chose is still a considered message. Only the ones nobody
   * chose get replaced.
   */
  it("keeps the message of a deliberate 5xx ApplicationError", () => {
    const response = handle(
      new ApplicationError(500, "CERTIFICATE_CODE_COLLISION", "Could not allocate a code.")
    );

    expect(response.statusCode).toBe(500);
    expect(response.body.error.message).toBe("Could not allocate a code.");
  });
});

describe("errors nobody expected", () => {
  /*
   * The case that matters. A driver error's message is written for whoever is
   * on call, not for a client: this one names a host, a port and a replica set,
   * and none of that is a caller's business.
   */
  it("replaces a raw driver message with a generic one", () => {
    const driverError = new Error(
      "connection <monitor> to 10.20.232.48:27017 closed; replica set rs0 has no primary"
    );
    driverError.name = "MongoNetworkError";

    const response = handle(driverError);

    expect(response.statusCode).toBe(500);
    expect(response.body.error.code).toBe("INTERNAL_ERROR");
    expect(response.body.error.message).toBe("Internal server error. Please try again.");
    expect(JSON.stringify(response.body)).not.toContain("10.20.232.48");
    expect(JSON.stringify(response.body)).not.toContain("rs0");
  });

  it("does not quote a duplicate key's index or value back to the caller", () => {
    const duplicateKeyError = new Error(
      'E11000 duplicate key error collection: fest.users index: index_users_emailAddress dup key: { emailAddress: "someone@example.com" }'
    );
    duplicateKeyError.code = 11000;

    const response = handle(duplicateKeyError);

    expect(response.body.error.message).toBe("Internal server error. Please try again.");
    expect(JSON.stringify(response.body)).not.toContain("someone@example.com");
    expect(JSON.stringify(response.body)).not.toContain("index_users_emailAddress");
  });

  /*
   * Sanitising the response would be a poor trade if it also hid the fault from
   * us: before this, an unexpected 500 was reported to the client and recorded
   * nowhere.
   */
  it("still records the real error on the server", () => {
    handle(new Error("connection to 10.20.232.48:27017 refused"));

    expect(errorLogSpy).toHaveBeenCalledOnce();
    expect(String(errorLogSpy.mock.calls[0])).toContain("10.20.232.48");
  });

  it("says nothing to the server log about an error it was told to expect", () => {
    handle(new ApplicationError(404, "EVENT_NOT_FOUND", "Event not found."));

    expect(errorLogSpy).not.toHaveBeenCalled();
  });
});

describe("a broken model invariant is a bad request, not a fault", () => {
  it("reports Mongoose validation per field and keeps its message", () => {
    const validationError = new Error("ignored");
    validationError.name = "ValidationError";
    validationError.errors = { endsOn: { message: "endsOn must be on or after startsOn." } };

    const response = handle(validationError);

    expect(response.statusCode).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
    expect(response.body.error.details.endsOn).toBe("endsOn must be on or after startsOn.");
    expect(errorLogSpy).not.toHaveBeenCalled();
  });
});
