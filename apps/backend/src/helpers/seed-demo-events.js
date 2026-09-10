/*
 * Dev-only seed: wipes existing event data and reseeds 50 detailed demo events
 * across the 10 demo fests (5 each), so Discover / fest / event pages have rich,
 * varied content to test against.
 *
 * "Clean up event data" here means: delete every event AND everything that hangs
 * off an event (registrations, teams, matches) plus the participant artefacts they
 * produce (passes, entitlements, scans, certificates), so the database is left
 * consistent rather than full of rows pointing at events that no longer exist.
 * Users, colleges, fests, staff assignments and checkpoints are kept.
 *
 * Idempotent: safe to re-run — it always clears first, then reseeds. NOT for
 * production (hard-gated on APPLICATION_ENVIRONMENT=development).
 *
 * Run `npm run db:seed:test` (college + admin) first. Fests are created here if
 * the demo set is missing.
 */
require("dotenv").config();

const mongoose = require("mongoose");
const { applicationConfig } = require("../config/application-config");
const { connectToDatabase } = require("../database/database-connection");
const { CollegeModel } = require("../models/college-model");
const { UserModel } = require("../models/user-model");
const { FestModel } = require("../models/fest-model");
const { EventModel } = require("../models/event-model");
const { RegistrationModel } = require("../models/registration-model");
const { TeamModel } = require("../models/team-model");
const { MatchModel } = require("../models/match-model");
const { PassModel } = require("../models/pass-model");
const { EntitlementModel } = require("../models/entitlement-model");
const { ScanModel } = require("../models/scan-model");
const { CertificateModel } = require("../models/certificate-model");
const { FEST_VISIBILITIES, FEST_STATUSES } = require("../constants/fest-constants");
const {
  EVENT_CATEGORIES,
  EVENT_TYPES,
  EVENT_SCORING_FORMATS,
  EVENT_STATUSES,
  QUESTION_TYPES,
} = require("../constants/event-constants");

const HOUR_MS = 60 * 60 * 1000;
const RUPEE = 100; // paise per rupee

/*
 * Related demo imagery: curated, category-matched Unsplash photos (verified to
 * resolve). Two per category so a fest and its neighbour don't repeat; `lock`
 * picks deterministically so the gallery is stable across refreshes. Real banners
 * uploaded through the admin later simply override these.
 */
const CATEGORY_IMAGE_IDS = {
  [EVENT_CATEGORIES.CULTURAL]: ["1459749411175-04bf5292ceea", "1470229722913-7c0e2dbbafd3"],
  [EVENT_CATEGORIES.GAMING]: ["1542751371-adc38448a05e", "1511512578047-dfb367046420"],
  [EVENT_CATEGORIES.TECHNICAL]: ["1518770660439-4636190af475", "1461749280684-dccba630e2f6"],
  [EVENT_CATEGORIES.SPORTS]: ["1461896836934-ffe607ba8211", "1517649763962-0c623066013b"],
  [EVENT_CATEGORIES.WORKSHOP]: ["1503676260728-1c00da094a0b", "1531403009284-440f080d1e12"],
  [EVENT_CATEGORIES.LITERARY]: ["1507842217343-583bb7270b66", "1521587760476-6c12a4b040da"],
  [EVENT_CATEGORIES.OTHER]: ["1533174072545-7a4b6ad7a6c3", "1492684223066-81342ee5ff30"],
};
function relatedImage(category, lock, width = 1280, height = 720) {
  const ids = CATEGORY_IMAGE_IDS[category] || CATEGORY_IMAGE_IDS[EVENT_CATEGORIES.OTHER];
  const id = ids[lock % ids.length];
  return `https://images.unsplash.com/photo-${id}?w=${width}&h=${height}&fit=crop&auto=format&q=70`;
}

function utcMidnightDaysFromNow(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}
function utcEndOfDayDaysFromNow(days) {
  const date = utcMidnightDaysFromNow(days);
  date.setUTCHours(23, 59, 59, 999);
  return date;
}
function addHours(base, hours) {
  return new Date(base.getTime() + hours * HOUR_MS);
}

// The 10 demo fests (same set seed-demo-fests uses), created here if absent.
const FEST_BLUEPRINTS = [
  { name: "Rhythm & Roots", slug: "rhythm-and-roots", startOffset: -1, span: 3, category: EVENT_CATEGORIES.CULTURAL },
  { name: "Neon Nights", slug: "neon-nights", startOffset: 0, span: 2, category: EVENT_CATEGORIES.GAMING },
  { name: "Cerebro Tech Fest", slug: "cerebro-tech-fest", startOffset: 2, span: 3, category: EVENT_CATEGORIES.TECHNICAL },
  { name: "Sportiva", slug: "sportiva", startOffset: 4, span: 2, category: EVENT_CATEGORIES.SPORTS },
  { name: "Canvas & Code", slug: "canvas-and-code", startOffset: 6, span: 2, category: EVENT_CATEGORIES.WORKSHOP },
  { name: "Aurora Cultural Meet", slug: "aurora-cultural-meet", startOffset: 9, span: 3, category: EVENT_CATEGORIES.CULTURAL },
  { name: "Quantum Hack", slug: "quantum-hack", startOffset: 12, span: 2, category: EVENT_CATEGORIES.TECHNICAL },
  { name: "Verve Dance Fest", slug: "verve-dance-fest", startOffset: 16, span: 2, category: EVENT_CATEGORIES.CULTURAL },
  { name: "Litmus Literary Fest", slug: "litmus-literary-fest", startOffset: 20, span: 2, category: EVENT_CATEGORIES.LITERARY },
  { name: "Odyssey 2027", slug: "odyssey-2027", startOffset: 25, span: 4, category: EVENT_CATEGORIES.OTHER },
];

const { BRACKET_SINGLE_ELIMINATION, SCORE_BASED, TIME_TRIAL, JUDGED, NONE } = EVENT_SCORING_FORMATS;
const { SOLO, TEAM } = EVENT_TYPES;

// A couple of reusable custom-question blocks.
const Q_EXPERIENCE = {
  questionText: "How would you describe your experience level?",
  questionType: QUESTION_TYPES.SINGLE_CHOICE,
  isRequired: true,
  options: ["Beginner", "Intermediate", "Advanced"],
};
const Q_TSHIRT = {
  questionText: "T-shirt size",
  questionType: QUESTION_TYPES.SINGLE_CHOICE,
  isRequired: false,
  options: ["S", "M", "L", "XL"],
};
const Q_HANDLE = {
  questionText: "In-game name / handle",
  questionType: QUESTION_TYPES.SHORT_TEXT,
  isRequired: true,
  options: [],
};
const Q_PORTFOLIO = {
  questionText: "Link to your portfolio or previous work (optional)",
  questionType: QUESTION_TYPES.SHORT_TEXT,
  isRequired: false,
  options: [],
};

/*
 * 50 detailed events, five per fest. Each is a real fest event with its own
 * description, rules, format, venue, capacity, fee, prize pool and — where it
 * fits — custom questions and a medical declaration. Everything downstream
 * (schedule, registration window, slug, status) is filled in by seeding.
 */
const EVENT_TEMPLATES = {
  "rhythm-and-roots": [
    { name: "Battle of the Bands", category: EVENT_CATEGORIES.CULTURAL, type: TEAM, min: 3, max: 6, scoring: JUDGED, venue: "Open-Air Amphitheatre", capacity: 12, fee: 500 * RUPEE, prize: "₹30,000 pool — Winner ₹18k, Runner-up ₹9k, People's Choice ₹3k", rules: "Original + one cover, 12 min max.\nBring your own instruments; drum kit provided.\nJudged on musicality, stage presence and originality.", questions: [Q_EXPERIENCE], desc: "The headline showdown — live bands battle across genres for the Rhythm & Roots crown." },
    { name: "Solo Vocals (Indian)", category: EVENT_CATEGORIES.CULTURAL, type: SOLO, scoring: JUDGED, venue: "Recital Hall", capacity: 40, fee: 100 * RUPEE, prize: "₹8,000 — Winner ₹5k, Runner-up ₹3k", rules: "One song, 5 min max.\nKaraoke track allowed; submit 24h prior.\nClassical, semi-classical or film.", desc: "A stage for the purest voices — Hindustani, Carnatic or film, your pick." },
    { name: "Classical Fusion", category: EVENT_CATEGORIES.CULTURAL, type: TEAM, min: 2, max: 5, scoring: JUDGED, venue: "Recital Hall", capacity: 16, fee: 300 * RUPEE, prize: "₹15,000 pool", rules: "8 min max including setup.\nAt least one classical instrument required.", desc: "Blend the classical with the contemporary in a single, seamless set." },
    { name: "Street Dance Face-Off", category: EVENT_CATEGORIES.CULTURAL, type: TEAM, min: 4, max: 10, scoring: JUDGED, venue: "Central Quad", capacity: 20, fee: 400 * RUPEE, prize: "₹25,000 pool", rules: "Bracketed 1v1 crew battles.\nNo props, no vulgarity.\n90 seconds per round.", desc: "Crews go head-to-head in a knockout street-dance battle judged live by the crowd and a panel." },
    { name: "Open Mic Night", category: EVENT_CATEGORIES.CULTURAL, type: SOLO, scoring: NONE, venue: "Café Lawn", capacity: null, fee: 0, prize: "Featured set at the closing ceremony", rules: "Any act, 4 min max.\nKeep it clean.\nSign-ups close 30 min before.", desc: "No judges, no pressure — poetry, comedy, music, whatever moves you. Everyone gets the stage." },
  ],
  "neon-nights": [
    { name: "Valorant 5v5 Championship", category: EVENT_CATEGORIES.GAMING, type: TEAM, min: 5, max: 6, scoring: BRACKET_SINGLE_ELIMINATION, venue: "Esports Arena — Bay 1", capacity: 16, fee: 750 * RUPEE, prize: "₹40,000 pool — 20k / 12k / 8k", rules: "Single elimination, Bo1 until finals (Bo3).\nOne substitute allowed.\nCheating = instant DQ.", questions: [Q_HANDLE], desc: "Sixteen squads, one bracket. Standard competitive rules, LAN where possible." },
    { name: "BGMI Squad Scrims", category: EVENT_CATEGORIES.GAMING, type: TEAM, min: 4, max: 4, scoring: SCORE_BASED, venue: "Esports Arena — Bay 2", capacity: 25, fee: 400 * RUPEE, prize: "₹20,000 pool + placement points", rules: "3 matches, points = placement + kills.\nEmulators barred.\nBring your own device, chargers provided.", questions: [Q_HANDLE], desc: "Points-based battle royale across three maps — consistency beats one lucky drop." },
    { name: "FIFA 1v1 Knockout", category: EVENT_CATEGORIES.GAMING, type: SOLO, scoring: BRACKET_SINGLE_ELIMINATION, venue: "Console Corner", capacity: 32, fee: 200 * RUPEE, prize: "₹10,000 — Winner ₹7k, Runner-up ₹3k", rules: "6-minute halves.\nNo custom tactics editing mid-match.\nRandom-draw bracket.", desc: "Classic knockout on the latest FIFA — controllers provided, bring your A-game." },
    { name: "Chess Blitz Arena", category: EVENT_CATEGORIES.GAMING, type: SOLO, scoring: BRACKET_SINGLE_ELIMINATION, venue: "Strategy Room", capacity: 32, fee: 100 * RUPEE, prize: "₹8,000 pool", rules: "5+0 blitz, single elimination.\nTouch-move enforced.\nArbiter's decision is final.", desc: "Fast, brutal, decisive — five-minute blitz chess in a single-elimination bracket." },
    { name: "Retro Arcade Challenge", category: EVENT_CATEGORIES.GAMING, type: SOLO, scoring: TIME_TRIAL, venue: "Neon Lounge", capacity: 48, fee: 0, prize: "Retro console hamper for the top score", rules: "Highest score across three retro titles.\nOne attempt each.\nLeaderboard decides.", desc: "Pac-Man, Tetris, Street Fighter — chase the high score across three arcade classics." },
  ],
  "cerebro-tech-fest": [
    { name: "Cerebro Hackathon (24h)", category: EVENT_CATEGORIES.TECHNICAL, type: TEAM, min: 2, max: 4, scoring: JUDGED, venue: "Innovation Lab", capacity: 30, fee: 0, prize: "₹1,00,000 pool + incubation interviews", rules: "24 hours, build from scratch.\nOpen theme with tracks.\nJudged on impact, tech and demo.", questions: [Q_EXPERIENCE, Q_PORTFOLIO, Q_TSHIRT], desc: "Twenty-four hours, a blank repo, and a problem worth solving. Mentors, meals and hardware on site." },
    { name: "RoboWars", category: EVENT_CATEGORIES.TECHNICAL, type: TEAM, min: 2, max: 5, scoring: BRACKET_SINGLE_ELIMINATION, venue: "Arena Pit", capacity: 16, fee: 1000 * RUPEE, prize: "₹50,000 pool", rules: "≤15 kg combat bots.\nNo untethered projectiles or fire.\nSafety inspection mandatory.", medical: true, questions: [Q_EXPERIENCE], desc: "Armoured bots enter, one drives out. Single-elimination combat in a shielded pit." },
    { name: "Line Follower Sprint", category: EVENT_CATEGORIES.TECHNICAL, type: TEAM, min: 2, max: 3, scoring: TIME_TRIAL, venue: "Robotics Bay", capacity: 24, fee: 300 * RUPEE, prize: "₹15,000 pool", rules: "Autonomous only.\nFastest clean lap wins.\nTwo runs, best time counts.", desc: "Build a bot that hugs the line and flies. Fastest autonomous lap takes it." },
    { name: "CodeSprint", category: EVENT_CATEGORIES.TECHNICAL, type: SOLO, scoring: SCORE_BASED, venue: "Computer Centre", capacity: 100, fee: 100 * RUPEE, prize: "₹20,000 pool + internship shortlists", rules: "3-hour competitive programming.\n6 problems, partial scoring.\nAny language on the judge.", questions: [Q_EXPERIENCE], desc: "Six problems, three hours, one leaderboard. Classic ICPC-style competitive programming." },
    { name: "Capture The Flag (CTF)", category: EVENT_CATEGORIES.TECHNICAL, type: TEAM, min: 2, max: 4, scoring: SCORE_BASED, venue: "Security Lab", capacity: 40, fee: 200 * RUPEE, prize: "₹25,000 pool", rules: "Jeopardy-style, 6 hours.\nNo attacking infra outside scope.\nFlag format: cerebro{...}.", questions: [Q_HANDLE], desc: "Web, crypto, forensics and pwn challenges — grab the flags, top the scoreboard." },
  ],
  "sportiva": [
    { name: "5-a-side Football", category: EVENT_CATEGORIES.SPORTS, type: TEAM, min: 5, max: 8, scoring: BRACKET_SINGLE_ELIMINATION, venue: "Turf Ground", capacity: 16, fee: 800 * RUPEE, prize: "₹35,000 pool", rules: "Two 12-min halves.\nRolling subs.\nStuds allowed on turf only.", medical: true, questions: [Q_TSHIRT], desc: "Fast, tight, knockout football on the turf. Sixteen teams, one champion." },
    { name: "3x3 Basketball", category: EVENT_CATEGORIES.SPORTS, type: TEAM, min: 3, max: 4, scoring: BRACKET_SINGLE_ELIMINATION, venue: "Outdoor Court", capacity: 16, fee: 500 * RUPEE, prize: "₹20,000 pool", rules: "First to 21 or 10 min.\nMake-it-take-it.\nHalf-court, single hoop.", medical: true, desc: "Half-court, three-on-three, non-stop. Bracketed to a single winner." },
    { name: "Table Tennis Singles", category: EVENT_CATEGORIES.SPORTS, type: SOLO, scoring: BRACKET_SINGLE_ELIMINATION, venue: "Indoor Hall", capacity: 32, fee: 150 * RUPEE, prize: "₹10,000 pool", rules: "Best of 5 games to 11.\nOwn paddle allowed.\nSingle elimination.", desc: "Reflexes and spin — knockout singles across the indoor tables." },
    { name: "Arm Wrestling Open", category: EVENT_CATEGORIES.SPORTS, type: SOLO, scoring: BRACKET_SINGLE_ELIMINATION, venue: "Strength Zone", capacity: 24, fee: 100 * RUPEE, prize: "₹8,000 pool + trophy", rules: "Weight-classed brackets.\nNo slipping/fouls; two fouls = loss.\nReferee's call is final.", medical: true, desc: "Raw strength, single table. Weight-classed brackets to crown the strongest arm." },
    { name: "100m Sprint", category: EVENT_CATEGORIES.SPORTS, type: SOLO, scoring: TIME_TRIAL, venue: "Athletics Track", capacity: 48, fee: 0, prize: "Medals + ₹5,000 for the fastest", rules: "Heats then final.\nSpikes optional.\nFalse start = warning, second = DQ.", medical: true, desc: "Ten seconds of everything you've got. Timed heats into a live final." },
  ],
  "canvas-and-code": [
    { name: "UI/UX Design Sprint", category: EVENT_CATEGORIES.WORKSHOP, type: SOLO, scoring: JUDGED, venue: "Design Studio", capacity: 40, fee: 200 * RUPEE, prize: "Design tablet for the winner + goodies", rules: "4-hour brief revealed on the spot.\nFigma or paper.\nJudged on clarity and craft.", questions: [Q_PORTFOLIO], desc: "One brief, four hours, one screen flow. A guided sprint that ends in a judged showcase." },
    { name: "Intro to Machine Learning", category: EVENT_CATEGORIES.WORKSHOP, type: SOLO, scoring: NONE, venue: "Seminar Hall A", capacity: 120, fee: 150 * RUPEE, prize: "Certificate of participation", rules: "Bring a laptop with Python.\nDatasets provided.\nHands-on, no prior ML needed.", questions: [Q_EXPERIENCE], desc: "From zero to a working classifier in one afternoon. Hands-on, laptop required." },
    { name: "Watercolour Basics", category: EVENT_CATEGORIES.WORKSHOP, type: SOLO, scoring: NONE, venue: "Fine Arts Room", capacity: 30, fee: 250 * RUPEE, prize: "Take home your artwork + starter kit", rules: "Materials provided.\nAll levels welcome.\n2 hours.", desc: "Loosen up with washes, blooms and gradients — a calm, guided intro to watercolour." },
    { name: "Photography Walk", category: EVENT_CATEGORIES.WORKSHOP, type: SOLO, scoring: JUDGED, venue: "Meet at Main Gate", capacity: 25, fee: 100 * RUPEE, prize: "Best-shot print + feature on the fest wall", rules: "Phone or camera.\nOne theme, revealed at the start.\nSubmit three frames.", questions: [Q_PORTFOLIO], desc: "A guided golden-hour walk; shoot to a theme and submit your three best frames for critique." },
    { name: "3D Printing Lab", category: EVENT_CATEGORIES.WORKSHOP, type: TEAM, min: 2, max: 3, scoring: NONE, venue: "Maker Space", capacity: 18, fee: 300 * RUPEE, prize: "Print a keepsake to take home", rules: "Design or bring an STL.\nPrint time capped at 30 min.\nSafety brief mandatory.", desc: "Model it, slice it, print it. Walk out with something you designed today." },
  ],
  "aurora-cultural-meet": [
    { name: "Fashion Walk", category: EVENT_CATEGORIES.CULTURAL, type: TEAM, min: 6, max: 15, scoring: JUDGED, venue: "Grand Stage", capacity: 12, fee: 1000 * RUPEE, prize: "₹40,000 pool — Best Team, Best Theme, Best Walk", rules: "6 min on ramp.\nTheme-based, own music.\nNo offensive content.", questions: [Q_EXPERIENCE], desc: "Themes, choreography and attitude on the ramp — the marquee showcase of Aurora." },
    { name: "Duet Dance", category: EVENT_CATEGORIES.CULTURAL, type: TEAM, min: 2, max: 2, scoring: JUDGED, venue: "Grand Stage", capacity: 20, fee: 300 * RUPEE, prize: "₹12,000 pool", rules: "4 min max.\nAny style.\nProps you can carry on in 30s.", desc: "Two dancers, one story. Any style, judged on sync and expression." },
    { name: "Nukkad Natak", category: EVENT_CATEGORIES.CULTURAL, type: TEAM, min: 6, max: 20, scoring: JUDGED, venue: "Amphitheatre Steps", capacity: 10, fee: 500 * RUPEE, prize: "₹20,000 pool + social-impact feature", rules: "Street play, 10 min.\nSocial theme required.\nNo mics — project.", desc: "Raw, loud, and purposeful — street theatre on a social theme, performed in the round." },
    { name: "Mehendi Art", category: EVENT_CATEGORIES.CULTURAL, type: SOLO, scoring: JUDGED, venue: "Craft Pavilion", capacity: 30, fee: 150 * RUPEE, prize: "₹6,000 + featured design", rules: "90 minutes.\nBring your own cones.\nOne hand, single design.", desc: "Intricate henna against the clock — judged on detail, symmetry and finish." },
    { name: "Beatboxing Battle", category: EVENT_CATEGORIES.CULTURAL, type: SOLO, scoring: BRACKET_SINGLE_ELIMINATION, venue: "Sound Stage", capacity: 16, fee: 200 * RUPEE, prize: "₹10,000 pool", rules: "1v1 rounds, 60s each.\nNo pre-recorded loops.\nCrowd + judge decide.", desc: "Mouth, mic, and momentum — one-on-one beatbox rounds in a knockout bracket." },
  ],
  "quantum-hack": [
    { name: "AI Prompt Battle", category: EVENT_CATEGORIES.TECHNICAL, type: SOLO, scoring: JUDGED, venue: "AI Lab", capacity: 50, fee: 100 * RUPEE, prize: "₹15,000 pool + API credits", rules: "Live prompt challenges.\nSame model for all.\nJudged on output quality + creativity.", questions: [Q_EXPERIENCE], desc: "Same model, same brief — whoever prompts it best wins. Rounds of live challenges." },
    { name: "Blockchain Build-Off", category: EVENT_CATEGORIES.TECHNICAL, type: TEAM, min: 2, max: 4, scoring: JUDGED, venue: "Innovation Lab", capacity: 24, fee: 0, prize: "₹30,000 pool", rules: "8-hour build.\nTestnet only.\nDemo a working contract + UI.", questions: [Q_PORTFOLIO], desc: "Ship a working dApp on testnet in eight hours — contracts, UI, the lot." },
    { name: "IoT Showcase", category: EVENT_CATEGORIES.TECHNICAL, type: TEAM, min: 2, max: 4, scoring: JUDGED, venue: "Hardware Bay", capacity: 20, fee: 200 * RUPEE, prize: "₹18,000 pool", rules: "Bring a working prototype.\n5-min demo + Q&A.\nSafety-checked before display.", desc: "Sensors, boards and a real prototype — pitch your connected build to the judges." },
    { name: "Data Viz Challenge", category: EVENT_CATEGORIES.TECHNICAL, type: SOLO, scoring: JUDGED, venue: "Computer Centre", capacity: 40, fee: 100 * RUPEE, prize: "₹12,000 pool", rules: "Dataset given on the day.\n3 hours to a dashboard.\nAny tool.", questions: [Q_PORTFOLIO], desc: "One messy dataset, three hours, one clear story. Turn numbers into insight." },
    { name: "Bug Bounty Blitz", category: EVENT_CATEGORIES.TECHNICAL, type: SOLO, scoring: SCORE_BASED, venue: "Security Lab", capacity: 30, fee: 150 * RUPEE, prize: "₹20,000 pool", rules: "Find bugs in a staged app.\nSeverity-weighted points.\nResponsible disclosure only.", questions: [Q_HANDLE], desc: "Hunt vulnerabilities in a deliberately broken app — points scale with severity." },
  ],
  "verve-dance-fest": [
    { name: "Solo Classical", category: EVENT_CATEGORIES.CULTURAL, type: SOLO, scoring: JUDGED, venue: "Proscenium Theatre", capacity: 40, fee: 200 * RUPEE, prize: "₹12,000 pool", rules: "6 min max.\nBharatanatyam, Kathak, Odissi and more.\nRecorded music, submit prior.", desc: "The grammar and grace of Indian classical dance, performed solo." },
    { name: "Group Hip-Hop", category: EVENT_CATEGORIES.CULTURAL, type: TEAM, min: 4, max: 12, scoring: JUDGED, venue: "Main Stage", capacity: 16, fee: 600 * RUPEE, prize: "₹30,000 pool", rules: "5 min max.\nFormations encouraged.\nClean lyrics only.", questions: [Q_EXPERIENCE], desc: "Crews bring the energy — formations, drops and attitude on the main stage." },
    { name: "Contemporary Duet", category: EVENT_CATEGORIES.CULTURAL, type: TEAM, min: 2, max: 2, scoring: JUDGED, venue: "Studio Theatre", capacity: 20, fee: 250 * RUPEE, prize: "₹10,000 pool", rules: "4 min.\nLifts allowed with a spotter noted.\nOwn track.", desc: "Story-driven movement for two — judged on emotion, control and chemistry." },
    { name: "Folk Dance", category: EVENT_CATEGORIES.CULTURAL, type: TEAM, min: 4, max: 16, scoring: JUDGED, venue: "Open-Air Stage", capacity: 14, fee: 400 * RUPEE, prize: "₹20,000 pool", rules: "6 min.\nAuthentic costume encouraged.\nLive or recorded music.", desc: "Bhangra, Garba, Lavani and beyond — regional folk in full colour." },
    { name: "Freestyle Dance-Off", category: EVENT_CATEGORIES.CULTURAL, type: SOLO, scoring: BRACKET_SINGLE_ELIMINATION, venue: "Cypher Circle", capacity: 24, fee: 150 * RUPEE, prize: "₹8,000 pool", rules: "1v1 to DJ's track.\n45s per round.\nNo choreography credit — pure freestyle.", desc: "No routine, no track list — react to the DJ and out-dance your opponent, round by round." },
  ],
  "litmus-literary-fest": [
    { name: "Parliamentary Debate", category: EVENT_CATEGORIES.LITERARY, type: TEAM, min: 2, max: 2, scoring: JUDGED, venue: "Moot Court", capacity: 24, fee: 200 * RUPEE, prize: "₹15,000 pool", rules: "British Parliamentary.\nMotions revealed 15 min prior.\n7-min speeches.", questions: [Q_EXPERIENCE], desc: "Sharp arguments under pressure — BP format, motions on the day." },
    { name: "Creative Writing", category: EVENT_CATEGORIES.LITERARY, type: SOLO, scoring: JUDGED, venue: "Library Reading Room", capacity: 60, fee: 50 * RUPEE, prize: "₹8,000 + publication in the fest zine", rules: "Prompt given on the spot.\n90 minutes, ≤1000 words.\nHandwritten or typed.", desc: "One prompt, ninety minutes, a thousand words. Fiction, memoir or something in between." },
    { name: "Poetry Slam", category: EVENT_CATEGORIES.LITERARY, type: SOLO, scoring: JUDGED, venue: "Black Box", capacity: 30, fee: 100 * RUPEE, prize: "₹6,000 + featured reading", rules: "Original work, 3 min.\nNo props or instruments.\nScored by five random judges.", desc: "Spoken word, live and unflinching — three minutes to move the room." },
    { name: "Quiz Masters", category: EVENT_CATEGORIES.LITERARY, type: TEAM, min: 2, max: 3, scoring: SCORE_BASED, venue: "Auditorium", capacity: 40, fee: 150 * RUPEE, prize: "₹20,000 pool", rules: "Written prelims → stage finals.\nNo phones.\nQuizmaster's word is final.", desc: "Prelims on paper, finals on stage — general, sci-tech and pop-culture rounds." },
    { name: "JAM — Just A Minute", category: EVENT_CATEGORIES.LITERARY, type: SOLO, scoring: BRACKET_SINGLE_ELIMINATION, venue: "Seminar Hall B", capacity: 24, fee: 50 * RUPEE, prize: "₹5,000 + trophy", rules: "Speak 60s, no repetition/hesitation/deviation.\nTopics on the spot.\nKnockout rounds.", desc: "Sixty seconds, one topic, no stumbling — the classic speak-off in a knockout format." },
  ],
  "odyssey-2027": [
    { name: "Campus Treasure Hunt", category: EVENT_CATEGORIES.OTHER, type: TEAM, min: 3, max: 5, scoring: TIME_TRIAL, venue: "Starts at the Clock Tower", capacity: 30, fee: 300 * RUPEE, prize: "₹25,000 pool", rules: "Clue-to-clue across campus.\nNo vehicles.\nFirst team to the final clue wins.", questions: [Q_TSHIRT], desc: "Cryptic clues, a sprawling campus, and a clock ticking. Solve, run, repeat." },
    { name: "Escape Room", category: EVENT_CATEGORIES.OTHER, type: TEAM, min: 2, max: 5, scoring: TIME_TRIAL, venue: "Puzzle Wing", capacity: 24, fee: 400 * RUPEE, prize: "Fastest team hamper + bragging rights", rules: "45-minute limit.\nThree hints allowed (time penalty).\nNo phones inside.", desc: "Locked in with a story and a stack of puzzles — get out before the clock does." },
    { name: "Startup Pitch", category: EVENT_CATEGORIES.OTHER, type: TEAM, min: 2, max: 4, scoring: JUDGED, venue: "Business Incubator", capacity: 20, fee: 0, prize: "₹50,000 seed grant + mentor intros", rules: "5-min pitch + 3-min Q&A.\nDeck due 24h prior.\nJudged on problem, market and team.", questions: [Q_PORTFOLIO], desc: "Five minutes to sell a real idea to a panel of founders and investors." },
    { name: "Cosplay Contest", category: EVENT_CATEGORIES.OTHER, type: SOLO, scoring: JUDGED, venue: "Expo Hall", capacity: 40, fee: 150 * RUPEE, prize: "₹15,000 pool — Best Craft, Best Performance", rules: "Own or made costume.\n2-min stage time.\nNo real weapons.", questions: [Q_EXPERIENCE], desc: "Bring your character to life — judged on craft, accuracy and stage presence." },
    { name: "Gaming Marathon", category: EVENT_CATEGORIES.OTHER, type: SOLO, scoring: SCORE_BASED, venue: "Neon Lounge", capacity: null, fee: 200 * RUPEE, prize: "Endurance trophy + gaming gear", rules: "Rotating titles through the night.\nCumulative points.\nBreaks scheduled hourly.", questions: [Q_HANDLE], desc: "An all-nighter across a rotating lineup of games — stamina and skill, points stack up." },
  ],
};

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function buildCustomQuestions(templates) {
  return (templates || []).map((question, index) => ({
    questionId: `q${index + 1}`,
    questionText: question.questionText,
    questionType: question.questionType,
    isRequired: question.isRequired,
    options: question.options,
    displayOrder: index + 1,
  }));
}

// Events are staggered through the fest, each a few hours after the last, so the
// schedule reads as a real programme. The registration window opens now and closes
// just before the event, so every event is registerable for testing.
function scheduleFor(fest, index, now) {
  const base = new Date(Math.max(fest.startsOn.getTime(), now.getTime() + 3 * HOUR_MS));
  const startsAt = addHours(base, index * 6 + 1);
  const boundedStart = new Date(Math.min(startsAt.getTime(), fest.endsOn.getTime() - 2 * HOUR_MS));
  const endsAt = new Date(Math.min(addHours(boundedStart, 3).getTime(), fest.endsOn.getTime()));
  const twelveHoursBefore = addHours(boundedStart, -12).getTime();
  const registrationClosesAt = new Date(
    Math.min(boundedStart.getTime(), Math.max(twelveHoursBefore, now.getTime() + HOUR_MS))
  );
  return { startsAt: boundedStart, endsAt, registrationOpensAt: now, registrationClosesAt };
}

async function ensureFest(blueprint, college, admin, lock) {
  const bannerImageUrl = relatedImage(blueprint.category, lock);
  let fest = await FestModel.findOne({ festSlug: blueprint.slug, hostCollegeId: college._id });
  if (!fest) {
    fest = await FestModel.create({
      festName: blueprint.name,
      festSlug: blueprint.slug,
      hostCollegeId: college._id,
      description: `${blueprint.name} — a demo fest seeded for testing. Explore events, register, and collect your pass.`,
      startsOn: utcMidnightDaysFromNow(blueprint.startOffset),
      endsOn: utcEndOfDayDaysFromNow(blueprint.startOffset + blueprint.span),
      visibility: FEST_VISIBILITIES.PUBLIC,
      allowedCollegeIds: [],
      contactEmail: admin.emailAddress,
      bannerImageUrl,
      status: FEST_STATUSES.PUBLISHED,
      createdByUserId: admin._id,
    });
    console.log(`Created fest: ${fest.festName} (${fest.id})`);
  } else if (fest.bannerImageUrl !== bannerImageUrl) {
    // Give existing demo fests a related banner too (they were seeded before images).
    fest.bannerImageUrl = bannerImageUrl;
    await fest.save();
  }
  return fest;
}

async function cleanupEventData() {
  const results = await Promise.all([
    MatchModel.deleteMany({}),
    RegistrationModel.deleteMany({}),
    TeamModel.deleteMany({}),
    EntitlementModel.deleteMany({}),
    PassModel.deleteMany({}),
    ScanModel.deleteMany({}),
    CertificateModel.deleteMany({}),
    EventModel.deleteMany({}),
  ]);
  const [matches, registrations, teams, entitlements, passes, scans, certificates, events] = results.map(
    (r) => r.deletedCount
  );
  console.log("--- Cleanup (event data + dependents) ---");
  console.log(`Events:        ${events}`);
  console.log(`Registrations: ${registrations}`);
  console.log(`Teams:         ${teams}`);
  console.log(`Matches:       ${matches}`);
  console.log(`Passes:        ${passes}`);
  console.log(`Entitlements:  ${entitlements}`);
  console.log(`Scans:         ${scans}`);
  console.log(`Certificates:  ${certificates}`);
}

async function main() {
  let exitCode = 0;
  try {
    if (!applicationConfig.isDevelopment) {
      throw new Error("Refusing to seed: APPLICATION_ENVIRONMENT must be 'development'.");
    }
    await connectToDatabase();

    const college = await CollegeModel.findOne({ aisheCode: "U-0576" });
    const admin = await UserModel.findOne({ emailAddress: applicationConfig.seedAdminEmail });
    if (!college || !admin) {
      throw new Error("College/admin not found. Run `npm run db:seed:test` first.");
    }

    await cleanupEventData();

    const now = new Date();
    let createdEvents = 0;
    for (let festIndex = 0; festIndex < FEST_BLUEPRINTS.length; festIndex += 1) {
      const blueprint = FEST_BLUEPRINTS[festIndex];
      const fest = await ensureFest(blueprint, college, admin, festIndex);
      const templates = EVENT_TEMPLATES[blueprint.slug] || [];
      for (let index = 0; index < templates.length; index += 1) {
        const template = templates[index];
        const schedule = scheduleFor(fest, index, now);
        await EventModel.create({
          festId: fest._id,
          createdByUserId: admin._id,
          posterImageUrl: relatedImage(template.category, festIndex * 10 + index, 900, 1200),
          eventName: template.name,
          eventSlug: slugify(template.name),
          description: template.desc,
          rules: template.rules || null,
          category: template.category,
          eventType: template.type,
          minimumTeamSize: template.type === TEAM ? template.min : 1,
          maximumTeamSize: template.type === TEAM ? template.max : 1,
          scoringFormat: template.scoring,
          venue: template.venue,
          capacity: template.capacity === undefined ? 60 : template.capacity,
          waitlistEnabled: template.capacity != null,
          feeAmountPaise: template.fee || 0,
          prizePoolDescription: template.prize || null,
          requiresMedicalDeclaration: Boolean(template.medical),
          customQuestions: buildCustomQuestions(template.questions),
          registeredCount: 0,
          status: EVENT_STATUSES.PUBLISHED,
          ...schedule,
        });
        createdEvents += 1;
      }
      console.log(`Seeded ${templates.length} events for ${fest.festName}`);
    }

    const [fests, events] = await Promise.all([FestModel.countDocuments(), EventModel.countDocuments()]);
    console.log("--- Demo events seed summary ---");
    console.log(`Events created: ${createdEvents}`);
    console.log(`Total fests:    ${fests}`);
    console.log(`Total events:   ${events}`);
  } catch (error) {
    console.error(`Seed failed: ${error.message}`);
    exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => undefined);
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
  process.exit(exitCode);
}

main();
