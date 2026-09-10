const mongoose = require("mongoose");

const { UserModel } = require("../models/user-model");
const { CollegeModel } = require("../models/college-model");
const { FestModel } = require("../models/fest-model");
const decisionEngine = require("./decision-engine-service");
const { TARGETING_DIMENSIONS } = require("../constants/campaign-constants");

/*
 * Targeting support for the campaign editor (phase 5): what an admin may
 * choose from, how many people a predicate reaches, and what is wrong with a
 * predicate before it is saved.
 *
 * THE ESTIMATE SHARES THE ENGINE'S CODE PATH. Attributes come from
 * decision-engine-service.loadDeclaredAttributesForUsers and the match from
 * decision-engine-service.evaluateTargeting — the very functions the engine
 * runs for a participant. If the estimate and the engine could disagree the
 * estimate would be worthless, so there is deliberately no second copy of
 * the matching rules here.
 *
 * NOTHING IS CACHED. Colleges onboard, fests publish, participants complete
 * profiles; the options and the estimate are read fresh each time.
 */

const YEARS_OF_STUDY = [1, 2, 3, 4, 5, 6];
/* The population the engine serves: signed-up, not blocked. */
const PARTICIPANT_FILTER = { isBlocked: { $ne: true } };
const PARTICIPANT_SELECT = "collegeId department yearOfStudy dateOfBirth";

/* ------------------------------------------------------------- options */

/*
 * Closed dimensions are enumerated by the platform and an editor offers a
 * pick list only. Open dimensions are free text somewhere upstream (a
 * college's city, a participant's department), so the editor offers the
 * distinct values in use as suggestions PLUS a free-text entry — and the
 * response says which is which.
 */
async function getTargetingOptions() {
  const [colleges, cities, departments, fests] = await Promise.all([
    CollegeModel.find({}).select("collegeName commonName city").sort({ commonName: 1 }).lean(),
    CollegeModel.distinct("city"),
    UserModel.distinct("department", { ...PARTICIPANT_FILTER, department: { $nin: [null, ""] } }),
    FestModel.find({}).select("festName hostCollegeId status").sort({ festName: 1 }).lean(),
  ]);
  const collegeById = new Map(colleges.map((college) => [String(college._id), college]));

  /*
   * Open dimensions are matched case-insensitively by the engine, so two
   * spellings that differ only in case are ONE value. Deduped by the engine's
   * key, showing the first spelling seen, sorted for the editor.
   */
  const normaliseText = (values) => {
    const byKey = new Map();
    for (const raw of values) {
      const value = String(raw ?? "").trim();
      const key = value.toLowerCase();
      if (value && !byKey.has(key)) {
        byKey.set(key, value);
      }
    }
    return [...byKey.values()].sort((left, right) => left.localeCompare(right));
  };

  return {
    collegeIds: {
      closed: true,
      values: colleges.map((college) => ({
        id: String(college._id),
        name: college.commonName,
        fullName: college.collegeName,
        city: college.city,
      })),
    },
    cities: { closed: false, values: normaliseText(cities) },
    departments: { closed: false, values: normaliseText(departments) },
    yearsOfStudy: { closed: true, values: YEARS_OF_STUDY },
    festIds: {
      closed: true,
      values: fests.map((fest) => ({
        id: String(fest._id),
        name: fest.festName,
        status: fest.status,
        college: collegeById.get(String(fest.hostCollegeId))
          ? {
              id: String(fest.hostCollegeId),
              name: collegeById.get(String(fest.hostCollegeId)).commonName,
            }
          : null,
      })),
    },
  };
}

/* ------------------------------------------------------------- estimate */

function isTargetingEmpty(targeting) {
  return decisionEngine.isTargetingEmpty(targeting);
}

/*
 * How many participants satisfy the predicate RIGHT NOW. Every number here
 * is a snapshot of declared attributes at this moment, not a forecast of
 * who will open the app during a flight — and the response says so.
 *
 *   totalParticipants   everyone the engine could serve at all
 *   attributeMatches    participants whose declared attributes satisfy the
 *                       predicate, ignoring age
 *   eligibleReach       the honest figure: attributeMatches minus everyone
 *                       under eighteen or of unknown age, because those
 *                       participants are eligible ONLY for untargeted
 *                       campaigns. For an empty predicate this equals
 *                       totalParticipants — an untargeted campaign reaches
 *                       everyone.
 *   ageRestricted       how many were excluded on age grounds, so the gap is
 *                       visible rather than mysterious
 */
async function estimateReach(targeting) {
  const users = await UserModel.find(PARTICIPANT_FILTER).select(PARTICIPANT_SELECT).lean();
  const totalParticipants = users.length;
  const untargeted = isTargetingEmpty(targeting);

  const attributesByUser = await decisionEngine.loadDeclaredAttributesForUsers(users);
  let attributeMatches = 0;
  let eligibleReach = 0;
  let ageRestricted = 0;
  for (const user of users) {
    const restricted = decisionEngine.isAgeRestrictedUser(user);
    if (untargeted) {
      attributeMatches += 1;
      eligibleReach += 1;
      continue;
    }
    const matches = decisionEngine.evaluateTargeting(targeting, attributesByUser.get(String(user._id)));
    if (!matches) {
      continue;
    }
    attributeMatches += 1;
    if (restricted) {
      ageRestricted += 1;
    } else {
      eligibleReach += 1;
    }
  }

  return {
    kind: "snapshot",
    computedAt: new Date(),
    totalParticipants,
    attributeMatches,
    eligibleReach,
    ageRestricted,
    isUntargeted: untargeted,
    explanation: {
      totalParticipants: "Every participant the engine could serve at all, right now.",
      attributeMatches:
        "Participants whose declared attributes satisfy this predicate at this moment, before the age gate.",
      eligibleReach:
        "The reach a targeted campaign can actually have: attribute matches minus participants under eighteen or of unknown age, who are eligible only for untargeted campaigns.",
      ageRestricted: "Attribute matches excluded on age grounds.",
      note: "A snapshot of who matches now, not a forecast of who will be reached during the flight.",
    },
  };
}

/* ------------------------------------------------------------- validate */

/*
 * Findings, not a refusal. Errors are things that cannot be right (an id that
 * does not exist); warnings are contradictions that MAY be deliberate (a
 * value both included and excluded, an exclude set with nothing to exclude
 * from). The strict model subschema is what forbids unknown dimensions —
 * this reports a bad shape as an error rather than letting the save 500.
 */
async function validateTargeting(targeting) {
  const errors = [];
  const warnings = [];

  if (targeting === null || typeof targeting !== "object" || Array.isArray(targeting)) {
    return { ok: false, errors: [{ path: "targeting", message: "must be an object" }], warnings };
  }
  for (const half of Object.keys(targeting)) {
    if (half !== "include" && half !== "exclude") {
      errors.push({ path: `targeting.${half}`, message: "only include and exclude are allowed" });
    }
  }
  const include = targeting.include ?? {};
  const exclude = targeting.exclude ?? {};
  for (const [half, set] of [["include", include], ["exclude", exclude]]) {
    if (set === null || typeof set !== "object" || Array.isArray(set)) {
      errors.push({ path: `targeting.${half}`, message: "must be an object of dimension arrays" });
      continue;
    }
    for (const dimension of Object.keys(set)) {
      if (!TARGETING_DIMENSIONS.includes(dimension)) {
        errors.push({
          path: `targeting.${half}.${dimension}`,
          message: `not a targeting dimension; allowed: ${TARGETING_DIMENSIONS.join(", ")}`,
        });
      } else if (!Array.isArray(set[dimension])) {
        errors.push({ path: `targeting.${half}.${dimension}`, message: "must be an array" });
      }
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }

  const list = (set, dimension) => (Array.isArray(set[dimension]) ? set[dimension].map(String) : []);

  // Ids that do not exist.
  const [collegeIds, festIds] = [
    [...new Set([...list(include, "collegeIds"), ...list(exclude, "collegeIds")])],
    [...new Set([...list(include, "festIds"), ...list(exclude, "festIds")])],
  ];
  const malformed = (ids) => ids.filter((id) => !mongoose.Types.ObjectId.isValid(id));
  const [knownColleges, knownFests] = await Promise.all([
    CollegeModel.find({ _id: { $in: collegeIds.filter((id) => mongoose.Types.ObjectId.isValid(id)) } }).select("_id").lean(),
    FestModel.find({ _id: { $in: festIds.filter((id) => mongoose.Types.ObjectId.isValid(id)) } }).select("_id").lean(),
  ]);
  const knownCollegeIds = new Set(knownColleges.map((row) => String(row._id)));
  const knownFestIds = new Set(knownFests.map((row) => String(row._id)));
  for (const id of [...malformed(collegeIds), ...collegeIds.filter((id) => mongoose.Types.ObjectId.isValid(id) && !knownCollegeIds.has(id))]) {
    errors.push({ path: "collegeIds", message: `no college with id ${id}` });
  }
  for (const id of [...malformed(festIds), ...festIds.filter((id) => mongoose.Types.ObjectId.isValid(id) && !knownFestIds.has(id))]) {
    errors.push({ path: "festIds", message: `no fest with id ${id}` });
  }
  for (const year of [...list(include, "yearsOfStudy"), ...list(exclude, "yearsOfStudy")]) {
    if (!YEARS_OF_STUDY.includes(Number(year))) {
      errors.push({ path: "yearsOfStudy", message: `${year} is not a year of study (1–6)` });
    }
  }

  // Contradictions.
  const normalise = (dimension, value) =>
    dimension === "cities" || dimension === "departments" ? String(value).trim().toLowerCase() : String(value);
  for (const dimension of TARGETING_DIMENSIONS) {
    const included = list(include, dimension).map((value) => normalise(dimension, value));
    const excluded = new Set(list(exclude, dimension).map((value) => normalise(dimension, value)));
    const both = included.filter((value) => excluded.has(value));
    if (both.length > 0) {
      warnings.push({
        path: dimension,
        message: `included and excluded at once (${both.join(", ")}); the exclusion wins and these can never match`,
      });
    }
    if (included.length === 0 && excluded.size > 0 && Object.prototype.hasOwnProperty.call(include, dimension)) {
      warnings.push({
        path: dimension,
        message: "an empty include set means no constraint; only the exclusions apply",
      });
    }
    if (included.length > 0 && included.every((value) => excluded.has(value))) {
      warnings.push({ path: dimension, message: "every included value is also excluded; nobody can match" });
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

module.exports = { getTargetingOptions, estimateReach, validateTargeting, YEARS_OF_STUDY };
