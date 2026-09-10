import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import fs from "fs/promises";
import path from "path";
import {
  getStorageDriver,
  getActiveDriverName,
  getLocalUploadDir,
} from "../../../src/services/upload-storage-service.js";

// A minimal PNG signature — the drivers store bytes verbatim, so the exact
// content does not matter, only that a real Buffer round-trips.
const PNG_BYTES = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

const S3_ENV_KEYS = [
  "S3_BUCKET_NAME",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_UPLOAD_URL_EXPIRY_SECONDS",
];

function clearS3Env() {
  for (const key of S3_ENV_KEYS) {
    delete process.env[key];
  }
}

function setS3Env() {
  process.env.S3_BUCKET_NAME = "festpass-test-bucket";
  process.env.S3_ACCESS_KEY_ID = "AKIATESTKEY";
  process.env.S3_SECRET_ACCESS_KEY = "test-secret-access-key";
  process.env.AWS_REGION = "ap-south-1";
}

describe("upload-storage-service — driver detection", () => {
  afterEach(clearS3Env);

  it("selects the local driver when no S3 env is set", () => {
    clearS3Env();
    expect(getActiveDriverName()).toBe("local");
    expect(getStorageDriver().name).toBe("local");
  });

  it("stays on local while the S3 credentials are only partially set", () => {
    clearS3Env();
    process.env.S3_BUCKET_NAME = "festpass-test-bucket";
    expect(getActiveDriverName()).toBe("local"); // missing key id + secret
    process.env.S3_ACCESS_KEY_ID = "AKIATESTKEY";
    expect(getActiveDriverName()).toBe("local"); // still missing secret
  });

  it("selects the S3 driver only when all three credentials are present", () => {
    setS3Env();
    expect(getActiveDriverName()).toBe("s3");
    expect(getStorageDriver().name).toBe("s3");
  });
});

describe("upload-storage-service — local driver", () => {
  beforeEach(clearS3Env);

  it("writes the file to disk and returns a localhost URL", async () => {
    const driver = getStorageDriver();
    expect(driver.name).toBe("local");

    const { url, key } = await driver.upload(PNG_BYTES, "image/png", "poster.png");
    expect(url).toBe(`http://localhost:5000/uploads/${key}`);

    const filePath = path.join(getLocalUploadDir(), key);
    const stat = await fs.stat(filePath);
    expect(stat.isFile()).toBe(true);

    // delete() removes the file; a second delete of a missing file is a no-op.
    await driver.delete(key);
    await expect(fs.stat(filePath)).rejects.toThrow();
    await expect(driver.delete(key)).resolves.toBeUndefined();
  });

  it("rejects a non-image mime type with a 400", async () => {
    const driver = getStorageDriver();
    await expect(driver.upload(PNG_BYTES, "application/pdf", "x.pdf")).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});

describe("upload-storage-service — S3 driver", () => {
  const s3Mock = mockClient(S3Client);

  beforeEach(() => {
    s3Mock.reset();
    setS3Env();
  });
  afterEach(clearS3Env);

  it("uploads via PutObjectCommand and returns an https S3 URL under uploads/", async () => {
    s3Mock.on(PutObjectCommand).resolves({});

    const driver = getStorageDriver();
    expect(driver.name).toBe("s3");

    const { url, key } = await driver.upload(PNG_BYTES, "image/png", "poster.png");

    const putCalls = s3Mock.commandCalls(PutObjectCommand);
    expect(putCalls.length).toBe(1);
    const input = putCalls[0].args[0].input;
    expect(input.Bucket).toBe("festpass-test-bucket");
    expect(input.Key).toBe(key);
    expect(input.ContentType).toBe("image/png");
    expect(key.startsWith("uploads/")).toBe(true);
    expect(url).toBe(`https://festpass-test-bucket.s3.ap-south-1.amazonaws.com/${key}`);
  });
});
