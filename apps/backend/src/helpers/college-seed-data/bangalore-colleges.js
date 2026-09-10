/*
 * Curated seed of real Bangalore colleges for the profile-completion dropdown.
 *
 * Sources (fetched 2026-07-28):
 *   - Wikipedia category pages: "Colleges in Bengaluru", "Engineering colleges
 *     in Bengaluru", "Colleges affiliated to Bangalore University"
 *   - VTU Bangalore-region college code list (USN prefixes) via
 *     easenotes.com/blogs/vtu-college-codes, cross-checked against VTU records
 *
 * Field notes:
 *   - collegeName: full official name. commonName: the short name people
 *     actually search for (RVCE, BMSCE, ...). The dropdown matches on both.
 *   - aisheCode is OMITTED (not null) when unknown — the colleges collection
 *     has a sparse unique index on it, and an explicit null would collide.
 *   - usnPrefix is set only for VTU-affiliated colleges, verified against the
 *     VTU code list; null otherwise.
 *
 * To add another city later: create `<city>-colleges.js` next to this file with
 * the same shape, and register it in the CITY_SEED_FILES map inside
 * migrate-bangalore-colleges.js (see docs/college-seed-migration.md).
 */

const bangaloreCollegeSeedData = [
  // ---- Engineering (VTU-affiliated, verified USN prefixes) ----
  { collegeName: "R.V. College of Engineering", commonName: "RVCE", usnPrefix: "1RV", collegeType: "engineering" },
  { collegeName: "B.M.S. College of Engineering", commonName: "BMSCE", usnPrefix: "1BM", collegeType: "engineering" },
  { collegeName: "B.M.S. Institute of Technology and Management", commonName: "BMSIT", usnPrefix: "1BY", collegeType: "engineering" },
  { collegeName: "M.S. Ramaiah Institute of Technology", commonName: "MSRIT", usnPrefix: "1MS", collegeType: "engineering" },
  { collegeName: "Dayananda Sagar College of Engineering", commonName: "DSCE", usnPrefix: "1DS", collegeType: "engineering" },
  { collegeName: "Dayananda Sagar Academy of Technology and Management", commonName: "DSATM", usnPrefix: "1DT", collegeType: "engineering" },
  { collegeName: "Bangalore Institute of Technology", commonName: "BIT", usnPrefix: "1BI", collegeType: "engineering" },
  { collegeName: "B.N.M. Institute of Technology", commonName: "BNMIT", usnPrefix: "1BG", collegeType: "engineering" },
  { collegeName: "Sir M. Visvesvaraya Institute of Technology", commonName: "Sir MVIT", usnPrefix: "1MV", collegeType: "engineering" },
  { collegeName: "J.S.S. Academy of Technical Education", commonName: "JSSATE", usnPrefix: "1JS", collegeType: "engineering" },
  { collegeName: "CMR Institute of Technology", commonName: "CMRIT", usnPrefix: "1CR", collegeType: "engineering" },
  { collegeName: "Nitte Meenakshi Institute of Technology", commonName: "NMIT", usnPrefix: "1NT", collegeType: "engineering" },
  { collegeName: "RNS Institute of Technology", commonName: "RNSIT", usnPrefix: "1RN", collegeType: "engineering" },
  { collegeName: "New Horizon College of Engineering", commonName: "NHCE", usnPrefix: "1NH", collegeType: "engineering" },
  { collegeName: "MVJ College of Engineering", commonName: "MVJCE", usnPrefix: "1MJ", collegeType: "engineering" },
  { collegeName: "Dr. Ambedkar Institute of Technology", commonName: "Dr. AIT", usnPrefix: "1DA", collegeType: "engineering" },
  { collegeName: "Atria Institute of Technology", commonName: "Atria", usnPrefix: "1AT", collegeType: "engineering" },
  { collegeName: "AMC Engineering College", commonName: "AMC", usnPrefix: "1AM", collegeType: "engineering" },
  { collegeName: "Acharya Institute of Technology", commonName: "Acharya", usnPrefix: "1AY", collegeType: "engineering" },
  { collegeName: "Global Academy of Technology", commonName: "GAT", usnPrefix: "1GA", collegeType: "engineering" },
  { collegeName: "Cambridge Institute of Technology", commonName: "CITech", usnPrefix: "1CD", collegeType: "engineering" },
  { collegeName: "Don Bosco Institute of Technology", commonName: "DBIT", usnPrefix: "1DB", collegeType: "engineering" },
  { collegeName: "East West Institute of Technology", commonName: "EWIT", usnPrefix: "1EW", collegeType: "engineering" },
  { collegeName: "East Point College of Engineering and Technology", commonName: "EPCET", usnPrefix: "1EP", collegeType: "engineering" },
  { collegeName: "HKBK College of Engineering", commonName: "HKBK", usnPrefix: "1HK", collegeType: "engineering" },
  { collegeName: "K.S. Institute of Technology", commonName: "KSIT", usnPrefix: "1KS", collegeType: "engineering" },
  { collegeName: "The Oxford College of Engineering", commonName: "TOCE", usnPrefix: "1OX", collegeType: "engineering" },
  { collegeName: "Sapthagiri College of Engineering", commonName: "Sapthagiri", usnPrefix: "1SG", collegeType: "engineering" },
  { collegeName: "SJB Institute of Technology", commonName: "SJBIT", usnPrefix: "1JB", collegeType: "engineering" },
  { collegeName: "Vemana Institute of Technology", commonName: "Vemana IT", usnPrefix: "1VI", collegeType: "engineering" },
  { collegeName: "Vivekananda Institute of Technology", commonName: "VKIT", usnPrefix: "1VK", collegeType: "engineering" },
  { collegeName: "Brindavan College of Engineering", commonName: "Brindavan", usnPrefix: "1BO", collegeType: "engineering" },
  { collegeName: "Sai Vidya Institute of Technology", commonName: "Sai Vidya", usnPrefix: "1VA", collegeType: "engineering" },

  // ---- Engineering / technology (universities and non-VTU institutes) ----
  { collegeName: "PES University", commonName: "PES", usnPrefix: null, collegeType: "engineering" },
  { collegeName: "University of Visvesvaraya College of Engineering", commonName: "UVCE", usnPrefix: null, collegeType: "engineering" },
  { collegeName: "International Institute of Information Technology Bangalore", commonName: "IIIT-B", usnPrefix: null, collegeType: "engineering" },
  { collegeName: "Ramaiah University of Applied Sciences", commonName: "MSRUAS", usnPrefix: null, collegeType: "engineering" },
  { collegeName: "REVA University", commonName: "REVA", usnPrefix: null, collegeType: "engineering" },
  { collegeName: "Indian Institute of Science", commonName: "IISc", usnPrefix: null, collegeType: "other" },

  // ---- Medical and dental ----
  { collegeName: "St. John's Medical College", commonName: "St John's Medical", usnPrefix: null, collegeType: "medical" },
  { collegeName: "Bangalore Medical College and Research Institute", commonName: "BMCRI", usnPrefix: null, collegeType: "medical" },
  { collegeName: "M.S. Ramaiah Medical College", commonName: "MSRMC", usnPrefix: null, collegeType: "medical" },
  { collegeName: "Kempegowda Institute of Medical Sciences", commonName: "KIMS", usnPrefix: null, collegeType: "medical" },
  { collegeName: "Vydehi Institute of Medical Sciences and Research Centre", commonName: "Vydehi", usnPrefix: null, collegeType: "medical" },
  { collegeName: "Rajarajeswari Medical College and Hospital", commonName: "RRMCH", usnPrefix: null, collegeType: "medical" },
  { collegeName: "Government Dental College and Research Institute", commonName: "GDC Bangalore", usnPrefix: null, collegeType: "medical" },
  { collegeName: "Rajarajeswari Dental College and Hospital", commonName: "RRDCH", usnPrefix: null, collegeType: "medical" },
  { collegeName: "Sri Jayadeva Institute of Cardiovascular Sciences and Research", commonName: "Jayadeva Institute", usnPrefix: null, collegeType: "medical" },

  // ---- Arts, science and commerce ----
  { collegeName: "Christ University", commonName: "Christ", usnPrefix: null, collegeType: "arts" },
  { collegeName: "St. Joseph's University", commonName: "SJU", usnPrefix: null, collegeType: "arts" },
  { collegeName: "St. Joseph's College of Commerce", commonName: "SJCC", usnPrefix: null, collegeType: "commerce" },
  { collegeName: "Mount Carmel College", commonName: "MCC", usnPrefix: null, collegeType: "arts" },
  { collegeName: "Jyoti Nivas College", commonName: "JNC", usnPrefix: null, collegeType: "arts" },
  { collegeName: "Jain (Deemed-to-be University)", commonName: "Jain University", usnPrefix: null, collegeType: "arts" },
  { collegeName: "Kristu Jayanti College", commonName: "Kristu Jayanti", usnPrefix: null, collegeType: "arts" },
  { collegeName: "National College, Basavanagudi", commonName: "National College", usnPrefix: null, collegeType: "arts" },
  { collegeName: "Presidency College, Bangalore", commonName: "Presidency", usnPrefix: null, collegeType: "commerce" },
  { collegeName: "Central College, Bangalore", commonName: "Central College", usnPrefix: null, collegeType: "arts" },
  { collegeName: "Government Science College, Bangalore", commonName: "GSC", usnPrefix: null, collegeType: "arts" },
  { collegeName: "Vijaya College", commonName: "Vijaya", usnPrefix: null, collegeType: "arts" },
  { collegeName: "NMKRV College for Women", commonName: "NMKRV", usnPrefix: null, collegeType: "arts" },
  { collegeName: "The Oxford College of Science", commonName: "TOCS", usnPrefix: null, collegeType: "arts" },
  { collegeName: "St. Hopkins College", commonName: "St Hopkins", usnPrefix: null, collegeType: "arts" },
  { collegeName: "Krupanidhi Degree College", commonName: "Krupanidhi", usnPrefix: null, collegeType: "arts" },

  // ---- Law ----
  { collegeName: "National Law School of India University", commonName: "NLSIU", usnPrefix: null, collegeType: "law" },
  { collegeName: "University Law College, Bangalore University", commonName: "ULC", usnPrefix: null, collegeType: "law" },
  { collegeName: "St. Joseph's College of Law", commonName: "SJCL", usnPrefix: null, collegeType: "law" },
  { collegeName: "CMR University School of Legal Studies", commonName: "CMR Law", usnPrefix: null, collegeType: "law" },

  // ---- Business and management ----
  { collegeName: "Indian Institute of Management Bangalore", commonName: "IIM Bangalore", usnPrefix: null, collegeType: "business" },
  { collegeName: "Xavier Institute of Management and Entrepreneurship", commonName: "XIME", usnPrefix: null, collegeType: "business" },
  { collegeName: "Alliance University", commonName: "Alliance", usnPrefix: null, collegeType: "business" },
  { collegeName: "Acharya Bangalore Business School", commonName: "ABBS", usnPrefix: null, collegeType: "business" },
  { collegeName: "St. Joseph's Institute of Management", commonName: "SJIM", usnPrefix: null, collegeType: "business" },
  { collegeName: "Ramaiah Institute of Management", commonName: "Ramaiah Management", usnPrefix: null, collegeType: "business" },
  { collegeName: "International School of Management Excellence", commonName: "ISME", usnPrefix: null, collegeType: "business" },

  // ---- Other ----
  { collegeName: "Srishti Manipal Institute of Art, Design and Technology", commonName: "Srishti", usnPrefix: null, collegeType: "other" },
  { collegeName: "College of Fine Arts, Bengaluru", commonName: "College of Fine Arts", usnPrefix: null, collegeType: "other" },
  { collegeName: "Government College of Pharmacy, Bangalore", commonName: "GCP", usnPrefix: null, collegeType: "other" },
  { collegeName: "The Oxford College of Pharmacy", commonName: "Oxford Pharmacy", usnPrefix: null, collegeType: "other" },
].map((college) => ({
  ...college,
  city: "Bangalore",
  state: "Karnataka",
  // aisheCode deliberately omitted: none were verifiable from the fetched
  // sources, and the sparse unique index requires the field to be ABSENT
  // (not null) when unknown.
}));

module.exports = { bangaloreCollegeSeedData };
