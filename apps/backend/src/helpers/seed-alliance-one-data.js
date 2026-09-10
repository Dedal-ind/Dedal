/*
 * Static data for the Alliance ONE 2026 development seed. Pure data only — no DB
 * access, no side effects. The orchestrator (`seed-alliance-one.js`) consumes
 * these tables through the real services and models.
 *
 * Dates: events carry `startDay`/`endDay` as day OFFSETS into the fest window
 * (0 = fest day one). This preserves the real Alliance ONE schedule SHAPE while
 * the orchestrator anchors day-zero to "now" so the live registration/scan
 * services (which are gated to the current time) actually accept the seed data.
 * The real calendar is Feb 18(=0) / 19(=1) / 20(=2) / 21(=3) 2026.
 */
const {
  EVENT_CATEGORIES,
  EVENT_TYPES,
  EVENT_SCORING_FORMATS,
  FEE_TYPES,
} = require("../constants/event-constants");

// The five solo events that receive sample registrations are seeded FREE so the
// real solo-registration service creates passes + entitlements without a payment
// flow (the service has no fee override — paid/free is derived from the event).
// Their nominal per-person fee is noted inline; every other event keeps its fee.
const FREE_REGISTRATION_TARGETS = new Set([
  "mindspark",
  "powerlifting",
  "mun",
  "eafc25",
  "kalpachitram",
]);

const COLLEGES = [
  {
    key: "alliance",
    collegeName: "Alliance University",
    commonName: "Alliance University",
    aisheCode: "C-11566",
    city: "Bengaluru",
    state: "Karnataka",
    isVerified: true,
  },
  {
    key: "rvce",
    collegeName: "R V College of Engineering",
    commonName: "RVCE",
    aisheCode: "C-10001",
    city: "Bengaluru",
    state: "Karnataka",
    isVerified: true,
  },
  {
    key: "bmsce",
    collegeName: "B M S College of Engineering",
    commonName: "BMSCE",
    aisheCode: "C-10002",
    city: "Bengaluru",
    state: "Karnataka",
    isVerified: true,
  },
  {
    key: "christ",
    collegeName: "Christ University",
    commonName: "Christ University",
    aisheCode: "C-10003",
    city: "Bengaluru",
    state: "Karnataka",
    isVerified: true,
  },
];

const PLATFORM_ADMIN = {
  emailAddress: "admin@dedal.in",
  fullName: "Platform Admin",
  phoneNumber: "9000000000",
};

const COLLEGE_ADMIN = {
  emailAddress: "admin@alliance.edu.in",
  fullName: "Dr. Swetha N",
  phoneNumber: "9886710660",
  collegeKey: "alliance",
};

// Each coordinator owns a top-level container event (hierarchy-aware coverage
// means they control all of its descendants).
const COORDINATORS = [
  { fullName: "Dr. Shreenidhi H S", phoneNumber: "9611412672", parentKey: "shastra" },
  { fullName: "Dr. Shamik Chakravarty", phoneNumber: "9910219406", parentKey: "manthan" },
  { fullName: "Dr. Sruthy Chandrasekhar", phoneNumber: "9886062843", parentKey: "sanskriti" },
  { fullName: "Dr. Thounaojam Sushil Singh", phoneNumber: "8383077716", parentKey: "athlos" },
  { fullName: "Dr. Mithun Hanumesh", phoneNumber: "7880888055", parentKey: "citizen" },
  { fullName: "Prof. Nikhil Trinjingat", phoneNumber: "9591021093", parentKey: "nyaya" },
];

// Student coordinators (volunteers) each cover 2-3 leaf events across different
// parents, giving cross-parent access. allowedCheckpointTypes: [] = unrestricted.
const VOLUNTEERS = [
  {
    fullName: "Thirumurugan B",
    phoneNumber: "8610270830",
    eventKeys: ["mindspark", "volleyballMen"],
    allowedCheckpointTypes: ["gate", "eventEntry"],
  },
  {
    fullName: "Parth Singh",
    phoneNumber: "7000768630",
    eventKeys: ["codesangram", "finheritance", "mun"],
    allowedCheckpointTypes: ["gate", "eventEntry"],
  },
  {
    fullName: "Abhirami Pradeep",
    phoneNumber: "8301036535",
    eventKeys: ["valorant", "swanubhav"],
    allowedCheckpointTypes: ["foodCounter"],
  },
  {
    fullName: "Soumyajit Roy",
    phoneNumber: "6295990748",
    eventKeys: ["powerlifting", "terrabyte"],
    allowedCheckpointTypes: ["foodCounter"],
  },
  {
    fullName: "Aditya Nagendra",
    phoneNumber: "8792026732",
    eventKeys: ["agora", "basketballMen", "sustainableFashion"],
    allowedCheckpointTypes: [],
  },
  {
    fullName: "Bhavya Pai",
    phoneNumber: "7736211105",
    eventKeys: ["eafc25", "mootcourt", "citizenLive"],
    allowedCheckpointTypes: [],
  },
];

// Ten participants across four colleges. The first five receive sample
// registrations; `mindsparkScore` is their score in the score-based quiz.
const PARTICIPANTS = [
  { fullName: "Aarav Sharma", phoneNumber: "9800000001", collegeKey: "rvce", mindsparkScore: 85 },
  { fullName: "Diya Patel", phoneNumber: "9800000002", collegeKey: "bmsce", mindsparkScore: 72 },
  { fullName: "Rohan Mehta", phoneNumber: "9800000003", collegeKey: "christ", mindsparkScore: 91 },
  { fullName: "Ananya Rao", phoneNumber: "9800000004", collegeKey: "alliance", mindsparkScore: 68 },
  { fullName: "Karthik Nair", phoneNumber: "9800000005", collegeKey: "rvce", mindsparkScore: 79 },
  { fullName: "Sneha Reddy", phoneNumber: "9800000006", collegeKey: "bmsce" },
  { fullName: "Vikram Iyer", phoneNumber: "9800000007", collegeKey: "christ" },
  { fullName: "Ishita Gupta", phoneNumber: "9800000008", collegeKey: "alliance" },
  { fullName: "Arjun Menon", phoneNumber: "9800000009", collegeKey: "rvce" },
  { fullName: "Meera Krishnan", phoneNumber: "9800000010", collegeKey: "bmsce" },
];

// Which solo events each of the first five participants registers for. Every plan
// includes "mindspark" so the score-based leaderboard has five competitors.
const REGISTRATION_PLAN = [
  { participantPhone: "9800000001", eventKeys: ["mindspark", "powerlifting", "mun"], foodPreference: "veg", needsAccommodation: true },
  { participantPhone: "9800000002", eventKeys: ["mindspark", "mun", "eafc25"], foodPreference: "nonVeg", needsAccommodation: false },
  { participantPhone: "9800000003", eventKeys: ["mindspark", "eafc25", "kalpachitram"], foodPreference: "veg", needsAccommodation: true },
  { participantPhone: "9800000004", eventKeys: ["mindspark", "kalpachitram", "powerlifting"], foodPreference: "noMealNeeded", needsAccommodation: false },
  { participantPhone: "9800000005", eventKeys: ["mindspark", "powerlifting", "eafc25"], foodPreference: "nonVeg", needsAccommodation: true },
];

const SELF_DECLARED_ACHIEVEMENTS = [
  { participantPhone: "9800000001", title: "IEEE Best Paper Award 2025", description: "Best paper at the IEEE student conference." },
  { participantPhone: "9800000003", title: "College Cricket Captain 2024-25", description: "Captained the college cricket team for the 2024-25 season." },
];

const { SOLO, TEAM } = EVENT_TYPES;
const { PER_PERSON, PER_TEAM } = FEE_TYPES;

/*
 * The full hierarchical event tree, listed parents-before-children. `container:
 * true` events are grouping nodes: no category, no registration. Leaf events
 * carry a real category, fee and the day offsets described at the top of file.
 *
 * Note: three events specified as "team min 1 max N" (codesangram, terrabyte,
 * citizenLive) are seeded min 2 — the Event model rejects a team minimum below 2.
 */
const EVENT_TREE = [
  // ---- Manthan ----
  { key: "manthan", name: "Manthan", container: true },
  { key: "mindspark", name: "Mindspark Quiz", parent: "manthan", category: EVENT_CATEGORIES.LITERARY, type: SOLO, capacity: 60, feeType: PER_PERSON, feePaise: 25000, startDay: 2, endDay: 3, scoringFormat: EVENT_SCORING_FORMATS.SCORE_BASED },
  { key: "agora", name: "Agora Debate", parent: "manthan", category: EVENT_CATEGORIES.LITERARY, type: TEAM, min: 3, max: 4, capacity: 40, feeType: PER_TEAM, feePaise: 100000, startDay: 2, endDay: 3 },
  { key: "fifthPerspective", name: "Fifth Perspective", parent: "manthan", category: EVENT_CATEGORIES.CULTURAL, type: TEAM, min: 5, max: 5, capacity: 30, feeType: PER_TEAM, feePaise: 100000, startDay: 1, endDay: 3 },
  { key: "pitchOff", name: "Pitch-Off", parent: "manthan", category: EVENT_CATEGORIES.TECHNICAL, type: TEAM, min: 3, max: 5, capacity: 40, feeType: PER_TEAM, feePaise: 100000, startDay: 1, endDay: 3 },
  { key: "kalpachitram", name: "Kalpachitram", parent: "manthan", category: EVENT_CATEGORIES.CULTURAL, type: SOLO, capacity: 50, feeType: PER_PERSON, feePaise: 20000, startDay: 1, endDay: 3 },
  { key: "echoes", name: "Echoes of the Mind", parent: "manthan", category: EVENT_CATEGORIES.LITERARY, type: TEAM, min: 2, max: 5, capacity: 30, feeType: PER_TEAM, feePaise: 100000, startDay: 1, endDay: 3 },

  // ---- Athlos ----
  { key: "athlos", name: "Athlos", container: true },
  { key: "volleyballMen", name: "Volleyball Men", parent: "athlos", category: EVENT_CATEGORIES.SPORTS, type: TEAM, min: 6, max: 12, capacity: 16, feeType: PER_TEAM, feePaise: 150000, startDay: 0, endDay: 3 },
  { key: "volleyballWomen", name: "Volleyball Women", parent: "athlos", category: EVENT_CATEGORIES.SPORTS, type: TEAM, min: 6, max: 12, capacity: 16, feeType: PER_TEAM, feePaise: 100000, startDay: 0, endDay: 2 },
  { key: "kabaddiMen", name: "Kabaddi Men", parent: "athlos", category: EVENT_CATEGORIES.SPORTS, type: TEAM, min: 7, max: 12, capacity: 16, feeType: PER_TEAM, feePaise: 150000, startDay: 0, endDay: 2 },
  { key: "basketballMen", name: "Basketball Men", parent: "athlos", category: EVENT_CATEGORIES.SPORTS, type: TEAM, min: 5, max: 12, capacity: 16, feeType: PER_TEAM, feePaise: 200000, startDay: 1, endDay: 3 },
  { key: "basketballWomen", name: "Basketball Women", parent: "athlos", category: EVENT_CATEGORIES.SPORTS, type: TEAM, min: 5, max: 12, capacity: 16, feeType: PER_TEAM, feePaise: 200000, startDay: 1, endDay: 3 },
  { key: "footballMen", name: "Football Men", parent: "athlos", category: EVENT_CATEGORIES.SPORTS, type: TEAM, min: 11, max: 18, capacity: 16, feeType: PER_TEAM, feePaise: 200000, startDay: 1, endDay: 3 },
  { key: "cricketMen", name: "Cricket Men", parent: "athlos", category: EVENT_CATEGORIES.SPORTS, type: TEAM, min: 11, max: 15, capacity: 16, feeType: PER_TEAM, feePaise: 300000, startDay: 0, endDay: 3 },
  { key: "powerlifting", name: "PowerLifting", parent: "athlos", category: EVENT_CATEGORIES.SPORTS, type: SOLO, capacity: 50, feeType: PER_PERSON, feePaise: 50000, startDay: 2, endDay: 3 },
  { key: "chess", name: "Chess", parent: "athlos", category: EVENT_CATEGORIES.SPORTS, type: TEAM, min: 5, max: 5, capacity: 20, feeType: PER_TEAM, feePaise: 200000, startDay: 1, endDay: 2 },
  { key: "tableTennis", name: "Table Tennis", parent: "athlos", category: EVENT_CATEGORIES.SPORTS, type: TEAM, min: 4, max: 4, capacity: 16, feeType: PER_TEAM, feePaise: 200000, startDay: 1, endDay: 2 },
  { key: "tennis", name: "Tennis", parent: "athlos", category: EVENT_CATEGORIES.SPORTS, type: TEAM, min: 6, max: 6, capacity: 16, feeType: PER_TEAM, feePaise: 200000, startDay: 1, endDay: 3 },
  { key: "throwballMen", name: "Throwball Men", parent: "athlos", category: EVENT_CATEGORIES.SPORTS, type: TEAM, min: 7, max: 12, capacity: 16, feeType: PER_TEAM, feePaise: 100000, startDay: 0, endDay: 2 },

  // ---- Shastra ----
  { key: "shastra", name: "Shastra", container: true },
  { key: "codesangram", name: "CodeSangram", parent: "shastra", category: EVENT_CATEGORIES.TECHNICAL, type: TEAM, min: 2, max: 5, capacity: 100, feeType: PER_TEAM, feePaise: 350000, startDay: 1, endDay: 3 },
  { key: "ranshastra", name: "RanShastra", parent: "shastra", container: true },
  { key: "astracode", name: "AstraCode Gameathon", parent: "ranshastra", category: EVENT_CATEGORIES.GAMING, type: TEAM, min: 2, max: 5, capacity: 50, feeType: PER_TEAM, feePaise: 150000, startDay: 1, endDay: 3 },
  { key: "astraarena", name: "AstraArena ESports", parent: "ranshastra", container: true },
  { key: "valorant", name: "Valorant", parent: "astraarena", category: EVENT_CATEGORIES.GAMING, type: TEAM, min: 5, max: 5, capacity: 32, feeType: PER_TEAM, feePaise: 100000, startDay: 1, endDay: 3 },
  { key: "bgmi", name: "BGMI", parent: "astraarena", category: EVENT_CATEGORIES.GAMING, type: TEAM, min: 4, max: 4, capacity: 32, feeType: PER_TEAM, feePaise: 100000, startDay: 1, endDay: 3 },
  { key: "freefire", name: "Free Fire Max", parent: "astraarena", category: EVENT_CATEGORIES.GAMING, type: TEAM, min: 4, max: 4, capacity: 32, feeType: PER_TEAM, feePaise: 100000, startDay: 1, endDay: 3 },
  { key: "codm", name: "Call of Duty Mobile", parent: "astraarena", category: EVENT_CATEGORIES.GAMING, type: TEAM, min: 5, max: 5, capacity: 32, feeType: PER_TEAM, feePaise: 75000, startDay: 1, endDay: 3 },
  { key: "marvelrivals", name: "Marvel Rivals", parent: "astraarena", category: EVENT_CATEGORIES.GAMING, type: TEAM, min: 6, max: 6, capacity: 32, feeType: PER_TEAM, feePaise: 100000, startDay: 1, endDay: 3 },
  { key: "eafc25", name: "EAFC 25", parent: "astraarena", category: EVENT_CATEGORIES.GAMING, type: SOLO, capacity: 64, feeType: PER_PERSON, feePaise: 30000, startDay: 1, endDay: 3 },

  // ---- Sanskriti ----
  { key: "sanskriti", name: "Sanskriti", container: true },
  { key: "swanubhav", name: "Swanubhav Group Dance", parent: "sanskriti", category: EVENT_CATEGORIES.CULTURAL, type: TEAM, min: 4, max: 20, capacity: 30, feeType: PER_TEAM, feePaise: 250000, startDay: 2, endDay: 2 },
  { key: "surtarang", name: "Sur Tarang Music Band", parent: "sanskriti", category: EVENT_CATEGORIES.CULTURAL, type: TEAM, min: 4, max: 15, capacity: 30, feeType: PER_TEAM, feePaise: 250000, startDay: 3, endDay: 3 },
  { key: "actleague", name: "Act League Theatre", parent: "sanskriti", category: EVENT_CATEGORIES.CULTURAL, type: TEAM, min: 4, max: 20, capacity: 30, feeType: PER_TEAM, feePaise: 250000, startDay: 2, endDay: 2 },

  // ---- Chaturanga ----
  { key: "chaturanga", name: "Chaturanga", container: true },
  { key: "finheritance", name: "FinHeritance", parent: "chaturanga", category: EVENT_CATEGORIES.TECHNICAL, type: TEAM, min: 2, max: 2, capacity: 40, feeType: PER_TEAM, feePaise: 50000, startDay: 1, endDay: 3 },
  { key: "sherises", name: "SheRises HR", parent: "chaturanga", category: EVENT_CATEGORIES.TECHNICAL, type: TEAM, min: 2, max: 2, capacity: 40, feeType: PER_TEAM, feePaise: 50000, startDay: 1, endDay: 3 },
  { key: "shepreneur", name: "ShePreneur", parent: "chaturanga", category: EVENT_CATEGORIES.TECHNICAL, type: TEAM, min: 2, max: 2, capacity: 40, feeType: PER_TEAM, feePaise: 50000, startDay: 1, endDay: 3 },
  { key: "herinsight", name: "HerInsight Operations", parent: "chaturanga", category: EVENT_CATEGORIES.TECHNICAL, type: TEAM, min: 2, max: 2, capacity: 40, feeType: PER_TEAM, feePaise: 50000, startDay: 1, endDay: 3 },
  { key: "herroute", name: "HerRoute to Market", parent: "chaturanga", category: EVENT_CATEGORIES.TECHNICAL, type: TEAM, min: 2, max: 2, capacity: 40, feeType: PER_TEAM, feePaise: 50000, startDay: 1, endDay: 3 },

  // ---- Nyaya Samvada ----
  { key: "nyaya", name: "Nyaya Samvada", container: true },
  { key: "mun", name: "Alliance Global MUN 2026", parent: "nyaya", category: EVENT_CATEGORIES.LITERARY, type: SOLO, capacity: 200, feeType: PER_PERSON, feePaise: 45000, startDay: 1, endDay: 3 },
  { key: "mootcourt", name: "Moot Court Competition", parent: "nyaya", category: EVENT_CATEGORIES.LITERARY, type: TEAM, min: 2, max: 3, capacity: 40, feeType: PER_TEAM, feePaise: 300000, startDay: 3, endDay: 3 },

  // ---- Citi-Zen 2026 ----
  { key: "citizen", name: "Citi-Zen 2026", container: true },
  { key: "terrabyte", name: "Terrabyte Innovate", parent: "citizen", category: EVENT_CATEGORIES.TECHNICAL, type: TEAM, min: 2, max: 5, capacity: 50, feeType: PER_TEAM, feePaise: 150000, startDay: 1, endDay: 2 },
  { key: "retropolitan", name: "Retropolitan", parent: "citizen", category: EVENT_CATEGORIES.TECHNICAL, type: TEAM, min: 2, max: 5, capacity: 50, feeType: PER_TEAM, feePaise: 150000, startDay: 1, endDay: 2 },
  { key: "citizenLive", name: "Citi-Zen Live", parent: "citizen", category: EVENT_CATEGORIES.CULTURAL, type: TEAM, min: 2, max: 5, capacity: 50, feeType: PER_TEAM, feePaise: 150000, startDay: 1, endDay: 3 },

  // ---- Srijan ----
  { key: "srijan", name: "Srijan", container: true },
  { key: "sustainableFashion", name: "Sustainable Fashion", parent: "srijan", category: EVENT_CATEGORIES.CULTURAL, type: TEAM, min: 6, max: 15, capacity: 20, feeType: PER_TEAM, feePaise: 250000, startDay: 2, endDay: 2 },
];

module.exports = {
  FREE_REGISTRATION_TARGETS,
  COLLEGES,
  PLATFORM_ADMIN,
  COLLEGE_ADMIN,
  COORDINATORS,
  VOLUNTEERS,
  PARTICIPANTS,
  REGISTRATION_PLAN,
  SELF_DECLARED_ACHIEVEMENTS,
  EVENT_TREE,
};
