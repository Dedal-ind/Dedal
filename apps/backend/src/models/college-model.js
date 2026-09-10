const mongoose = require("mongoose");
const validator = require("validator");

const collegeSchema = new mongoose.Schema(
  {
    collegeName: { type: String, required: true, trim: true },
    commonName: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },

    /*
     * Deliberately has no `default: null`. A sparse index skips documents where
     * the field is ABSENT, but not documents where it is explicitly null — a
     * default would make the second code-less college collide on the unique
     * index below. Leave it undefined and the index ignores the document.
     */
    aisheCode: { type: String, trim: true },

    /*
     * The FULL postal address, structured. The top-level city/state above stay
     * as the display summary the participant college picker reads — they are
     * kept in step by the pre('save') sync below rather than being replaced,
     * because CollegeSelect and the seeded reference directory both depend on
     * their shape.
     *
     * Optional by design: addressLine2-4 (overflow), townOrLocality, and
     * country. AISHE's own college address form asks for line 1, optional line
     * 2, city, district, PIN and state — lines 3/4 are the client's addition
     * and no Indian college needs `country`.
     *
     * The whole subdocument is optional at the schema level so colleges seeded
     * before it existed remain loadable; the REQUIRED markers below bind only
     * once an address is present. The validator is what enforces an address on
     * the way in.
     */
    address: {
      type: new mongoose.Schema(
        {
          addressLine1: { type: String, trim: true, required: true, maxlength: 200 },
          addressLine2: { type: String, trim: true, default: null, maxlength: 200 },
          addressLine3: { type: String, trim: true, default: null, maxlength: 200 },
          addressLine4: { type: String, trim: true, default: null, maxlength: 200 },
          city: { type: String, trim: true, required: true, maxlength: 100 },
          townOrLocality: { type: String, trim: true, default: null, maxlength: 100 },
          district: { type: String, trim: true, required: true, maxlength: 100 },
          state: { type: String, trim: true, required: true, maxlength: 100 },
          /*
           * First digit 1–8 per India Post zone codes. For zero-false-positive
           * postal verification, see captn3m0/india-pincode-regex (npm). Not
           * added — this is format validation, not postal delivery
           * verification.
           */
          pinCode: { type: String, trim: true, required: true, match: /^[1-9]\d{5}$/ },
          country: { type: String, trim: true, default: "India", maxlength: 100 },
        },
        { _id: false }
      ),
      default: undefined,
    },

    usnPrefix: { type: String, trim: true, uppercase: true, default: null },
    collegeType: {
      type: String,
      enum: ["engineering", "medical", "arts", "commerce", "law", "business", "other"],
      default: "other",
    },
    logoUrl: { type: String, trim: true, default: null },
    contactEmail: { type: String, trim: true, lowercase: true, default: null },
    isVerified: { type: Boolean, default: false },
    /*
     * Separates the seeded reference directory from real SaaS tenants:
     * "reference" — directory entry for the participant dropdown, no
     * administrator; "active" — an approved tenant with an administrator;
     * "inactive" — hidden everywhere. Approval elevates reference → active.
     */
    status: {
      type: String,
      enum: ["reference", "active", "inactive"],
      default: "active",
    },
    createdByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

/*
 * The top-level city/state are a DISPLAY SUMMARY of the structured address, not
 * a second source of truth. Whenever an address is present they are rewritten
 * from it, so the two can never drift into disagreeing about where a college
 * is — which is the failure mode that made the participant picker show one city
 * while the verifier's document showed another.
 */
collegeSchema.pre("save", function syncCollegeAddressSummary(next) {
  if (this.address) {
    this.city = this.address.city;
    this.state = this.address.state;
  }
  return next();
});

collegeSchema.pre("validate", function validateCollegeContactEmail(next) {
  if (this.contactEmail && !validator.isEmail(this.contactEmail)) {
    this.invalidate("contactEmail", "contactEmail is not a valid email address.");
  }
  return next();
});

/*
 * Declared here rather than as field-level shortcuts, which would make Mongoose
 * register a second auto-named index over the same key.
 */
collegeSchema.index({ commonName: 1 }, { name: "index_colleges_commonName" });
collegeSchema.index(
  { aisheCode: 1 },
  { name: "index_colleges_aisheCode", unique: true, sparse: true }
);
collegeSchema.index({ usnPrefix: 1 }, { name: "index_colleges_usnPrefix" });

collegeSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (document, plainObject) => {
    delete plainObject._id;
    return plainObject;
  },
});

const CollegeModel = mongoose.model("College", collegeSchema);

module.exports = { CollegeModel };
