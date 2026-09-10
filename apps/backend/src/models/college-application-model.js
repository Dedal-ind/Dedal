const mongoose = require("mongoose");
const { UNKNOWN_IP_ADDRESS } = require("../constants/sign-in-constants");

const COLLEGE_APPLICATION_STATUSES = {
  PENDING: "pending",
  UNDER_REVIEW: "underReview",
  APPROVED: "approved",
  REJECTED: "rejected",
};

const EXPECTED_FEST_SIZES = ["under-500", "500-1500", "1500-5000", "5000+"];

const collegeApplicationSchema = new mongoose.Schema(
  {
    applicantEmail: { type: String, required: true, trim: true, lowercase: true },
    applicantFullName: { type: String, required: true, trim: true },
    applicantPhone: { type: String, required: true, trim: true },
    applicantRole: { type: String, required: true, trim: true },

    collegeName: { type: String, required: true, trim: true },
    collegeAddress: { type: String, required: true, trim: true },
    collegeCity: { type: String, required: true, trim: true },
    collegeState: { type: String, required: true, trim: true, default: "Karnataka" },

    /*
     * The structured postal address the applicant fills in. Carried onto the
     * College verbatim on approval, so a verified college has a real address
     * from day one and never needs the migration sentinel. Optional at the
     * schema level only so applications submitted before this field existed
     * remain loadable; the validator requires it on the way in.
     */
    collegeAddressDetail: {
      type: new mongoose.Schema(
        {
          addressLine1: { type: String, trim: true, required: true, maxlength: 200 },
          addressLine2: { type: String, trim: true, default: null, maxlength: 200 },
          addressLine3: { type: String, trim: true, default: null, maxlength: 200 },
          addressLine4: { type: String, trim: true, default: null, maxlength: 200 },
          city: { type: String, trim: true, required: true, maxlength: 100 },
          townOrLocality: { type: String, trim: true, default: null, maxlength: 100 },
          /* No longer collected by the form — see college-address-validator.
             Kept (and no longer required) so applications submitted before the
             form was simplified still load and still show their district. */
          district: { type: String, trim: true, default: null, maxlength: 100 },
          state: { type: String, trim: true, required: true, maxlength: 100 },
          pinCode: { type: String, trim: true, required: true, match: /^[1-9]\d{5}$/ },
          country: { type: String, trim: true, default: "India", maxlength: 100 },
        },
        { _id: false }
      ),
      default: undefined,
    },
    collegeWebsite: { type: String, trim: true, default: null },

    expectedFestSize: { type: String, required: true, enum: EXPECTED_FEST_SIZES },
    notesFromApplicant: { type: String, trim: true, default: null },
    documentUrls: { type: [String], default: [] },

    /*
     * Set at submit when the college name matches an existing directory entry,
     * so approval ELEVATES that college instead of duplicating it, and the
     * admin UI can badge "existing directory entry".
     */
    linkedCollegeId: { type: mongoose.Schema.Types.ObjectId, ref: "College", default: null },

    status: {
      type: String,
      enum: Object.values(COLLEGE_APPLICATION_STATUSES),
      default: COLLEGE_APPLICATION_STATUSES.PENDING,
    },
    reviewedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    rejectionReason: { type: String, trim: true, default: null },

    // The submitting IP, so an aggregate over recent rows is the per-IP
    // submission count — the same read-your-own-collection pattern as otpCodes.
    ipAddress: { type: String, trim: true, default: UNKNOWN_IP_ADDRESS },
  },
  { timestamps: true }
);

collegeApplicationSchema.index({ status: 1 }, { name: "index_collegeApplications_status" });
collegeApplicationSchema.index({ reviewedAt: 1 }, { name: "index_collegeApplications_reviewedAt" });

// Serves the per-IP rolling-window submission count.
collegeApplicationSchema.index(
  { ipAddress: 1, createdAt: -1 },
  { name: "index_collegeApplications_ipAddress_createdAt" }
);

/*
 * One PENDING application per email — a PARTIAL unique index, not a plain one:
 * an approved or rejected application is history and must never block the same
 * address from applying again. The partial filter narrows uniqueness to rows
 * whose status is "pending", so the race between two simultaneous submissions
 * is settled by the database rather than a check-then-insert in JavaScript.
 */
collegeApplicationSchema.index(
  { applicantEmail: 1 },
  {
    name: "index_collegeApplications_applicantEmail_pending",
    unique: true,
    partialFilterExpression: { status: COLLEGE_APPLICATION_STATUSES.PENDING },
  }
);

collegeApplicationSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (document, plainObject) => {
    delete plainObject._id;
    // An abuse-control detail, not application data any client needs.
    delete plainObject.ipAddress;
    return plainObject;
  },
});

const CollegeApplicationModel = mongoose.model(
  "CollegeApplication",
  collegeApplicationSchema,
  "collegeApplications"
);

module.exports = {
  CollegeApplicationModel,
  COLLEGE_APPLICATION_STATUSES,
  EXPECTED_FEST_SIZES,
};
