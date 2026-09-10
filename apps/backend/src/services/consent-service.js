const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const { PolicyDocumentVersionModel } = require("../models/policy-document-version-model");
const { ConsentRecordModel } = require("../models/consent-record-model");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { recordAuditLog } = require("./audit-log-service");
const { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } = require("../constants/audit-log-constants");
const {
  POLICY_DOCUMENT_KINDS,
  CONSENT_ACTIONS,
  CONSENT_SOURCES,
  LEGACY_POLICY_VERSION_LABEL,
} = require("../constants/consent-constants");

/*
 * Consent as a PROVABLE RECORD rather than a timestamp.
 *
 * Four things live here: publishing a version of a legal text into the
 * registry (text and hash in the same row), serving that text back as the
 * single source of what a participant sees, recording one person's
 * acceptance or withdrawal against the version in effect, and reading what a
 * person currently stands on. Every write is audited, per the platform rule
 * that every mutation is.
 */

const ALL_KINDS = Object.values(POLICY_DOCUMENT_KINDS);

/*
 * The canonical text of each document, checked into THIS repository under
 * backend/policies. The publish script defaults to these files, development
 * boot and the test bootstrap seed the registry from them, and the frontend
 * is meant to render whatever the registry serves — so there is one wording,
 * and it lives here.
 */
const BUNDLED_POLICY_DIRECTORY = path.join(__dirname, "..", "..", "policies");
const BUNDLED_POLICY_FILES = {
  [POLICY_DOCUMENT_KINDS.TERMS_OF_SERVICE]: "terms-of-service.md",
  [POLICY_DOCUMENT_KINDS.PRIVACY_POLICY]: "privacy-policy.md",
};

function bundledPolicyPath(kind) {
  return path.join(BUNDLED_POLICY_DIRECTORY, BUNDLED_POLICY_FILES[kind]);
}

/*
 * The hash a version is identified by: SHA-256 over the text with line
 * endings normalised and outer whitespace trimmed, so the same document saved
 * on Windows and on Linux hashes identically, while any change to a single
 * character of the wording does not.
 */
function normalisePolicyText(text) {
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new Error("The policy document text is required.");
  }
  return text.replace(/\r\n?/g, "\n").trim();
}

function hashPolicyText(text) {
  return crypto.createHash("sha256").update(normalisePolicyText(text), "utf8").digest("hex");
}

/* The public shape of one version: everything a client needs to render it
   and to check the hash against the text for itself. */
function toPolicyDocumentJson(version) {
  return {
    id: String(version._id),
    kind: version.kind,
    versionLabel: version.versionLabel,
    effectiveAt: version.effectiveAt,
    contentHash: version.contentHash,
    isEffective: version.isEffective,
    isLegacy: version.isLegacy,
    text: version.text,
  };
}

/* The version in effect for one kind, with its text. 404 if none. */
async function getEffectivePolicyDocument(kind) {
  const version = await getEffectivePolicyVersion(kind);
  if (!version) {
    throw new ApplicationError(
      404,
      ERROR_CODES.POLICY_VERSION_NOT_FOUND,
      "No effective version of this document is published."
    );
  }
  return toPolicyDocumentJson(version);
}

/* One specific version by id — a past acceptance shown back verbatim. */
async function getPolicyDocumentVersion(versionId) {
  const version = mongoose.Types.ObjectId.isValid(versionId)
    ? await PolicyDocumentVersionModel.findById(versionId)
    : null;
  if (!version) {
    throw new ApplicationError(404, ERROR_CODES.POLICY_VERSION_NOT_FOUND, "Policy version not found.");
  }
  return toPolicyDocumentJson(version);
}

function assertKind(kind) {
  if (!ALL_KINDS.includes(kind)) {
    throw new ApplicationError(400, ERROR_CODES.VALIDATION_FAILED, "Unknown policy document kind.", {
      kind: String(kind),
    });
  }
}

async function getEffectivePolicyVersion(kind) {
  assertKind(kind);
  return PolicyDocumentVersionModel.findOne({ kind, isEffective: true });
}

/*
 * The LEGACY placeholder for one kind: the row that stands for the text people
 * accepted before versioning existed. isLegacy, and NO content hash — we did
 * not hash what they saw, and inventing one would be inventing evidence.
 *
 * Created once per kind, by the backfill. It is HISTORY ONLY and is never the
 * effective version: a consent recorded against a hash-less row proves
 * nothing, so nothing new may ever be recorded against it. The model refuses
 * a legacy row that claims to be effective.
 */
async function ensureLegacyPolicyVersion(kind, effectiveAt = null) {
  assertKind(kind);
  const existing = await PolicyDocumentVersionModel.findOne({
    kind,
    versionLabel: LEGACY_POLICY_VERSION_LABEL,
  });
  if (existing) {
    return { version: existing, created: false };
  }
  const version = await PolicyDocumentVersionModel.create({
    kind,
    versionLabel: LEGACY_POLICY_VERSION_LABEL,
    effectiveAt: effectiveAt ?? new Date(),
    contentHash: null,
    text: null,
    isEffective: false,
    isLegacy: true,
    publishedByUserId: null,
  });
  return { version, created: true };
}

/*
 * The boot check. Every kind must have exactly one effective version, and it
 * must be a real one — hashed, with its text. Throws a plain Error whose
 * message names each missing kind and the command that fixes it, so a
 * forgotten publish stops the deploy with the remedy on screen.
 */
async function assertPolicyRegistryReady() {
  const effective = await PolicyDocumentVersionModel.find({ isEffective: true }).lean();
  const problems = [];
  for (const kind of ALL_KINDS) {
    const rows = effective.filter((row) => row.kind === kind);
    if (rows.length === 0) {
      problems.push(`${kind}: no effective version`);
    } else if (rows.length > 1) {
      problems.push(`${kind}: ${rows.length} effective versions`);
    } else if (rows[0].isLegacy || !rows[0].contentHash || !rows[0].text) {
      problems.push(`${kind}: the effective version has no hashed text`);
    }
  }
  if (problems.length === 0) {
    return;
  }
  const remedy = ALL_KINDS.map(
    (kind) =>
      `  npm run publish:policy-version -- --kind ${kind} --label <label> --file policies/${BUNDLED_POLICY_FILES[kind]}`
  ).join("\n");
  throw new Error(
    "Policy registry is not ready — refusing to start.\n" +
      problems.map((problem) => `  - ${problem}`).join("\n") +
      "\nPublish the effective text for each kind:\n" +
      remedy +
      "\nThen, for pre-versioning history, run: npm run migrate:consent-records"
  );
}

/*
 * Seeds any kind that lacks an effective version from the bundled text. Used
 * by development boot and the test bootstrap, never by production, where a
 * publish is a deliberate operator act. Returns the versions it published.
 */
async function seedPolicyRegistryFromBundledText() {
  const published = [];
  for (const kind of ALL_KINDS) {
    const current = await PolicyDocumentVersionModel.findOne({ kind, isEffective: true }).lean();
    if (current && !current.isLegacy) {
      continue;
    }
    const text = fs.readFileSync(bundledPolicyPath(kind), "utf8");
    const version = await publishPolicyVersion({
      kind,
      versionLabel: `bundled-${hashPolicyText(text).slice(0, 12)}`,
      text,
    });
    published.push(version);
  }
  return published;
}

/*
 * Publishes a new version and makes it the effective one for its kind.
 *
 * The previous effective version is superseded FIRST (its isEffective flips
 * to false — the only mutation the model permits), then the new row is
 * inserted as effective. The partial unique index would refuse the insert if
 * the flip had not happened, so two versions can never be effective at once
 * even under a race: the loser's insert fails and nothing is half-done.
 *
 * Takes the document TEXT and nothing else; the hash is always computed from
 * it here, so a row can never carry a hash that describes different wording
 * than the text beside it. The text is stored normalised exactly as it was
 * hashed.
 */
async function publishPolicyVersion(
  { kind, versionLabel, effectiveAt, text },
  { publishedByUserId = null, ...context } = {}
) {
  assertKind(kind);
  const normalisedText = normalisePolicyText(text);
  const hash = hashPolicyText(normalisedText);
  const label = String(versionLabel ?? "").trim();
  if (label.length === 0) {
    throw new ApplicationError(400, ERROR_CODES.VALIDATION_FAILED, "versionLabel is required.");
  }
  const effective = effectiveAt ? new Date(effectiveAt) : new Date();
  if (Number.isNaN(effective.getTime())) {
    throw new ApplicationError(400, ERROR_CODES.VALIDATION_FAILED, "effectiveAt is not a date.");
  }

  const previous = await PolicyDocumentVersionModel.findOne({ kind, isEffective: true });
  if (previous) {
    previous.isEffective = false;
    await previous.save();
  }

  const version = await PolicyDocumentVersionModel.create({
    kind,
    versionLabel: label,
    effectiveAt: effective,
    contentHash: hash,
    text: normalisedText,
    isEffective: true,
    isLegacy: false,
    publishedByUserId,
  });

  await recordAuditLog({
    actorUserId: publishedByUserId,
    action: AUDIT_ACTIONS.POLICY_VERSION_PUBLISHED,
    entityType: AUDIT_ENTITY_TYPES.POLICY_DOCUMENT_VERSION,
    entityId: version._id,
    beforeState: previous
      ? { versionId: String(previous._id), versionLabel: previous.versionLabel }
      : null,
    afterState: { kind, versionLabel: label, contentHash: hash, effectiveAt: effective },
    ...context,
  });

  return version;
}

/* The newest record a person has for one kind, or null. */
async function findLatestRecord(userId, kind) {
  return ConsentRecordModel.findOne({ userId, documentKind: kind })
    .sort({ consentedAt: -1, _id: -1 })
    .lean();
}

/*
 * Writes ONE record: this person, this kind, the version in effect right now,
 * its hash copied at this instant, the request's IP and user agent, and how
 * the act came about. Then audits it.
 *
 * THE VERSION IS AN ARGUMENT, NEVER RE-READ HERE. The caller has already
 * resolved — and for an acceptance, VERIFIED — which version the person acted
 * on, and the record copies that version's id and hash. Re-reading the
 * effective version at write time would make the record describe whatever
 * happened to be current when the write landed, not the text the person saw,
 * which is precisely the evidence the record exists to preserve.
 */
async function recordConsent(
  { userId, documentKind, version, action, source, consentedAt },
  context = {}
) {
  assertKind(documentKind);
  if (!Object.values(CONSENT_ACTIONS).includes(action)) {
    throw new Error(`Unknown consent action: ${action}`);
  }
  if (!Object.values(CONSENT_SOURCES).includes(source)) {
    throw new Error(`Unknown consent source: ${source}`);
  }
  if (!version || version.kind !== documentKind || version.isLegacy || !version.contentHash) {
    throw new ApplicationError(
      500,
      ERROR_CODES.POLICY_VERSION_MISSING,
      `No usable ${documentKind} policy version was resolved; consent cannot be recorded.`,
      { documentKind }
    );
  }

  const record = await ConsentRecordModel.create({
    userId: new mongoose.Types.ObjectId(String(userId)),
    documentKind,
    policyVersionId: version._id,
    contentHash: version.contentHash,
    action,
    source,
    consentedAt: consentedAt ?? new Date(),
    ipAddress: context.ipAddress ?? null,
    userAgent: context.userAgent ?? null,
    isLegacy: version.isLegacy === true && source === CONSENT_SOURCES.LEGACY_BACKFILL,
  });

  await recordAuditLog({
    actorUserId: userId,
    action:
      action === CONSENT_ACTIONS.WITHDRAWN
        ? AUDIT_ACTIONS.CONSENT_WITHDRAWN
        : AUDIT_ACTIONS.CONSENT_ACCEPTED,
    entityType: AUDIT_ENTITY_TYPES.CONSENT_RECORD,
    entityId: record._id,
    afterState: {
      documentKind,
      policyVersionId: String(version._id),
      versionLabel: version.versionLabel,
      contentHash: version.contentHash,
      source,
    },
    ipAddress: context.ipAddress ?? null,
    userAgent: context.userAgent ?? null,
  });

  return record;
}

/*
 * The version in effect for a kind, or the runtime hard error. Boot refuses to
 * start without one (assertPolicyRegistryReady), so this only fires if a
 * version was removed by hand at runtime — and then it FAILS rather than
 * recording a consent against nothing.
 */
async function requireEffectivePolicyVersion(documentKind) {
  const version = await getEffectivePolicyVersion(documentKind);
  if (!version || version.isLegacy || !version.contentHash) {
    throw new ApplicationError(
      500,
      ERROR_CODES.POLICY_VERSION_MISSING,
      `No effective ${documentKind} policy version is published; consent cannot be recorded. ` +
        "Run: npm run publish:policy-version",
      { documentKind }
    );
  }
  return version;
}

/*
 * Resolves the version a tick was made against and VERIFIES it is the one in
 * effect. Three refusals, in order:
 *   - no id, an unknown id, or an id for another kind → 400. The tick cannot
 *     say which text it accepted, so it is not an acceptance of anything.
 *   - the id names a real version of this kind that is no longer effective →
 *     409 POLICY_VERSION_STALE. The policy changed while the form was open.
 *     Expected, not exceptional: the details carry both versions so the client
 *     can show the new text and ask again. It is NEVER silently recorded
 *     against the current version — that is the failure this check exists to
 *     prevent.
 */
async function resolveSubmittedPolicyVersion(documentKind, submittedVersionId) {
  const submitted = mongoose.Types.ObjectId.isValid(submittedVersionId)
    ? await PolicyDocumentVersionModel.findById(submittedVersionId)
    : null;
  if (!submitted || submitted.kind !== documentKind) {
    throw new ApplicationError(
      400,
      ERROR_CODES.POLICY_VERSION_NOT_FOUND,
      `The ${documentKind} version this consent names does not exist.`,
      { documentKind, submittedVersionId: submittedVersionId ? String(submittedVersionId) : null }
    );
  }
  const effective = await requireEffectivePolicyVersion(documentKind);
  if (String(submitted._id) !== String(effective._id)) {
    throw new ApplicationError(
      409,
      ERROR_CODES.POLICY_VERSION_STALE,
      `The ${documentKind} changed while the form was open. Please read the new version and accept it again.`,
      {
        documentKind,
        submittedVersionId: String(submitted._id),
        submittedVersionLabel: submitted.versionLabel,
        effectiveVersionId: String(effective._id),
        effectiveVersionLabel: effective.versionLabel,
      }
    );
  }
  return submitted;
}

/*
 * Acceptance from a user-facing form, of the version the form DISPLAYED.
 * submittedVersionId is required and verified against the effective version
 * (see resolveSubmittedPolicyVersion); the record then copies the id and hash
 * of that submitted, verified version.
 *
 * Idempotent against re-submission: if the person already stands accepted on
 * this version, no new record is written — saving the profile form twice is
 * not consenting twice. If they stand on an OLDER version (or have withdrawn),
 * a fresh record is written and its source says why: first completion, or a
 * re-prompt after new text.
 */
async function recordAcceptance({ userId, documentKind, submittedVersionId }, context = {}) {
  assertKind(documentKind);
  const version = await resolveSubmittedPolicyVersion(documentKind, submittedVersionId);
  const latest = await findLatestRecord(userId, documentKind);
  if (
    latest &&
    latest.action === CONSENT_ACTIONS.ACCEPTED &&
    version &&
    String(latest.policyVersionId) === String(version._id)
  ) {
    return { record: latest, written: false };
  }
  const source = latest ? CONSENT_SOURCES.REPROMPT : CONSENT_SOURCES.PROFILE_COMPLETION;
  const record = await recordConsent(
    { userId, documentKind, version, action: CONSENT_ACTIONS.ACCEPTED, source },
    context
  );
  return { record, written: true };
}

/*
 * Withdrawal: a new record, as easy to write as an acceptance. It points at
 * the version in effect at the moment of withdrawal, which is the text the
 * person is withdrawing from.
 */
async function recordWithdrawal({ userId, documentKind }, context = {}) {
  assertKind(documentKind);
  const version = await requireEffectivePolicyVersion(documentKind);
  return recordConsent(
    {
      userId,
      documentKind,
      version,
      action: CONSENT_ACTIONS.WITHDRAWN,
      source: CONSENT_SOURCES.WITHDRAWAL,
    },
    context
  );
}

/*
 * What one person currently stands on, per document kind:
 *
 *   status            'accepted' | 'withdrawn' | 'none'
 *   policyVersionId   the version their latest record names (null for 'none')
 *   versionLabel      its label
 *   contentHash       the hash copied at acceptance (null if legacy)
 *   consentedAt       when the latest record was written
 *   effectiveVersionId the version in effect now
 *   isCurrentVersion  true only when status is 'accepted' AND the accepted
 *                     version is the effective one. This is the predicate a
 *                     re-prompt keys off: false means "ask again".
 */
async function getConsentStanding(userId) {
  const [effectiveVersions, latestRecords] = await Promise.all([
    PolicyDocumentVersionModel.find({ isEffective: true }).lean(),
    ConsentRecordModel.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(String(userId)) } },
      { $sort: { consentedAt: -1, _id: -1 } },
      { $group: { _id: "$documentKind", latest: { $first: "$$ROOT" } } },
    ]),
  ]);
  const effectiveByKind = new Map(effectiveVersions.map((row) => [row.kind, row]));
  const latestByKind = new Map(latestRecords.map((row) => [row._id, row.latest]));
  const versionIds = latestRecords
    .map((row) => row.latest.policyVersionId)
    .filter((id) => id);
  const namedVersions = await PolicyDocumentVersionModel.find({ _id: { $in: versionIds } })
    .select("versionLabel")
    .lean();
  const labelById = new Map(namedVersions.map((row) => [String(row._id), row.versionLabel]));

  const standing = {};
  for (const kind of ALL_KINDS) {
    const effective = effectiveByKind.get(kind) ?? null;
    const latest = latestByKind.get(kind) ?? null;
    const isAccepted = latest?.action === CONSENT_ACTIONS.ACCEPTED;
    standing[kind] = {
      status: latest ? latest.action : "none",
      policyVersionId: latest ? String(latest.policyVersionId) : null,
      versionLabel: latest ? (labelById.get(String(latest.policyVersionId)) ?? null) : null,
      contentHash: latest ? latest.contentHash : null,
      consentedAt: latest ? latest.consentedAt : null,
      effectiveVersionId: effective ? String(effective._id) : null,
      isCurrentVersion: Boolean(
        isAccepted && effective && String(latest.policyVersionId) === String(effective._id)
      ),
    };
  }
  return standing;
}

module.exports = {
  hashPolicyText,
  normalisePolicyText,
  bundledPolicyPath,
  getEffectivePolicyVersion,
  getEffectivePolicyDocument,
  getPolicyDocumentVersion,
  ensureLegacyPolicyVersion,
  assertPolicyRegistryReady,
  seedPolicyRegistryFromBundledText,
  publishPolicyVersion,
  recordConsent,
  recordAcceptance,
  recordWithdrawal,
  getConsentStanding,
};
