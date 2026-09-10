/*
 * The single source of truth for the scan and checkpoint enums. The models, the
 * validator, and the scan service all read them from here.
 */
const SCAN_METHODS = {
  QR: "qr",
  BACKUP_CODE: "backupCode",
};

const SCAN_DIRECTIONS = {
  IN: "in",
  OUT: "out",
};

/*
 * The decision tree's every outcome. Every scan attempt lands on exactly one of
 * these and is recorded with it, so the enum is the append-only log's vocabulary.
 * manualOverride is reserved for the supervisor-override path built in a later
 * chunk; nothing writes it yet.
 */
const SCAN_RESULTS = {
  ACCEPTED: "accepted",
  REJECTED_PASS_NOT_FOUND: "rejectedPassNotFound",
  REJECTED_PASS_INACTIVE: "rejectedPassInactive",
  REJECTED_NO_ENTITLEMENT: "rejectedNoEntitlement",
  REJECTED_ALREADY_USED: "rejectedAlreadyUsed",
  REJECTED_EXPIRED: "rejectedExpired",
  REJECTED_WRONG_CHECKPOINT: "rejectedWrongCheckpoint",
  REJECTED_FEST_NOT_ONGOING: "rejectedFestNotOngoing",
  // A volunteer who has shifts but none active at this checkpoint right now.
  REJECTED_NO_ACTIVE_SHIFT: "rejectedNoActiveShift",
  /*
   * The pass is valid and entitled, but its holder has not passed the Main Gate
   * today. Campus entry is the precondition for everything inside the campus, so
   * an event door or an offer counter refuses until the gate has been crossed.
   *
   * Named REJECTED_MAIN_GATE_REQUIRED / "rejectedMainGateRequired" to match every
   * other member of this enum: scan.result is stored with these values, and a
   * bare "mainGateRequired" would be the one outcome in the append-only log that
   * did not read as a rejection.
   */
  REJECTED_MAIN_GATE_REQUIRED: "rejectedMainGateRequired",
  MANUAL_OVERRIDE: "manualOverride",
};

/*
 * The MVP uses gate and eventEntry only; the rest are enumerated so the model's
 * enum already accepts them when food, accommodation and prize desks arrive.
 */
const CHECKPOINT_TYPES = {
  GATE: "gate",
  EVENT_ENTRY: "eventEntry",
  FOOD_COUNTER: "foodCounter",
  ACCOMMODATION: "accommodation",
  PRIZE_DESK: "prizeDesk",
  // A counter materialised from a fest.offers entry (checkpoint.offerId names it).
  OFFER: "offer",
};

const CHECKPOINT_DIRECTION_MODES = {
  IN_ONLY: "inOnly",
  IN_AND_OUT: "inAndOut",
};

module.exports = {
  SCAN_METHODS,
  SCAN_DIRECTIONS,
  SCAN_RESULTS,
  CHECKPOINT_TYPES,
  CHECKPOINT_DIRECTION_MODES,
};
