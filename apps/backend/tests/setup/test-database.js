import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

/*
 * An in-process MongoDB. Tests never reach the real festAppMvp database: the URI
 * comes from the memory server, not from DATABASE_URI, so a misconfigured
 * environment cannot silently point a test suite at real data.
 */
let memoryServer = null;

/*
 * The policy registry is seeded from the bundled legal text right after
 * connecting, and clearAllCollections leaves it alone — so any suite that
 * completes a profile has a real, hashed version to record consent against,
 * exactly as production must. A suite that needs an EMPTY registry (the
 * consent and backfill suites) calls resetPolicyRegistry in its beforeEach.
 */
const POLICY_REGISTRY_COLLECTION = "policyDocumentVersions";

export async function seedPolicyRegistry() {
  const { seedPolicyRegistryFromBundledText } = await import(
    "../../src/services/consent-service.js"
  );
  return seedPolicyRegistryFromBundledText();
}

export async function resetPolicyRegistry() {
  const collection = mongoose.connection.collections[POLICY_REGISTRY_COLLECTION];
  if (collection) {
    // Native driver delete: the model refuses deletion, and this is test teardown.
    await collection.deleteMany({});
  }
}

export async function setupTestDatabase() {
  memoryServer = await MongoMemoryServer.create();
  const databaseUri = memoryServer.getUri();
  await mongoose.connect(databaseUri);
  await seedPolicyRegistry();
  return databaseUri;
}

export async function teardownTestDatabase() {
  await mongoose.disconnect();
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
}

/*
 * Deletes documents, not collections: dropping a collection would discard its
 * indexes, and the unique-index behaviour is exactly what several suites assert.
 */
export async function clearAllCollections() {
  const { collections } = mongoose.connection;
  for (const collectionName of Object.keys(collections)) {
    if (collectionName === POLICY_REGISTRY_COLLECTION) {
      continue;
    }
    await collections[collectionName].deleteMany({});
  }
}
