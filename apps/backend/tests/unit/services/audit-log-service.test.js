import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import mongoose from "mongoose";
import { AuditLogModel } from "../../../src/models/audit-log-model.js";
import auditLogService from "../../../src/services/audit-log-service.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../../setup/test-database.js";

function buildParams(overrides = {}) {
  return {
    actorUserId: new mongoose.Types.ObjectId(),
    festId: new mongoose.Types.ObjectId(),
    action: "fest.created",
    entityType: "fest",
    entityId: new mongoose.Types.ObjectId(),
    ...overrides,
  };
}

beforeAll(async () => {
  await setupTestDatabase();
  await AuditLogModel.createIndexes();
});
beforeEach(clearAllCollections);
afterAll(teardownTestDatabase);

describe("recordAuditLog", () => {
  it("appends a log row with the given action", async () => {
    await auditLogService.recordAuditLog(
      buildParams({ afterState: { festName: "Alliance ONE" }, ipAddress: "203.0.113.7" })
    );

    const logs = await AuditLogModel.find({});
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe("fest.created");
    expect(logs[0].afterState).toEqual({ festName: "Alliance ONE" });
    expect(logs[0].ipAddress).toBe("203.0.113.7");
  });

  it("defaults beforeState and afterState to null when omitted", async () => {
    await auditLogService.recordAuditLog(buildParams());
    const log = await AuditLogModel.findOne({});
    expect(log.beforeState).toBeNull();
    expect(log.afterState).toBeNull();
  });

  it("never throws when the insert fails, so the main flow is unbroken", async () => {
    const createSpy = vi.spyOn(AuditLogModel, "create").mockRejectedValueOnce(new Error("db down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(auditLogService.recordAuditLog(buildParams())).resolves.toBeUndefined();

    expect(await AuditLogModel.countDocuments()).toBe(0);
    createSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
