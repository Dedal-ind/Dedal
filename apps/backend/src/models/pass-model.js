const mongoose = require("mongoose");
const { PASS_STATUSES, BACKUP_CODE_PATTERN } = require("../constants/pass-constants");

const passSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    festId: { type: mongoose.Schema.Types.ObjectId, ref: "Fest", required: true },

    /*
     * The only thing the QR encodes: an opaque random token. Entitlements live on
     * the server keyed by this token, so a scanned code reveals nothing on its own.
     *
     * This token is permanent for the life of the pass. It does not rotate, and
     * there is deliberately no qrTokenRotatedAt field pretending otherwise — a
     * column named for a control nobody implemented reads as protection that is
     * already there. A screenshot of a gate QR is therefore a working pass until
     * the fest ends. Rotation is one of four items in the pre-Alliance security
     * pass; see backend/docs/security-debt.md for the set and why they are one
     * piece of work rather than four.
     */
    qrToken: { type: String, required: true, minlength: 24, maxlength: 32 },

    /*
     * A 6-digit numeric fallback shown beside the QR, so a volunteer can key it
     * in when a camera or a cracked screen fails. It is as much a secret as the
     * qrToken: unique across passes and never returned outside the owner's own
     * pass endpoint.
     */
    backupCode: {
      type: String,
      required: true,
      minlength: 6,
      maxlength: 6,
      match: BACKUP_CODE_PATTERN,
    },

    status: {
      type: String,
      required: true,
      enum: Object.values(PASS_STATUSES),
      default: PASS_STATUSES.ACTIVE,
    },
    issuedAt: { type: Date, required: true, default: Date.now },

    /*
     * Stamped when the pass email leaves the process, so the participant is
     * emailed their pass exactly ONCE however many events they register for at
     * this fest (every registration path funnels through the same pass). Null
     * means "not emailed yet"; the send claims the stamp atomically before
     * dispatching and clears it again if delivery failed, so a failure retries
     * on the next registration instead of being lost. An owner-initiated resend
     * (POST /passes/:passId/resend-email) bypasses the stamp deliberately.
     */
    passEmailSentAt: { type: Date, default: null },
  },
  { timestamps: true }
);

passSchema.index({ userId: 1, festId: 1 }, { name: "index_passes_userId_festId", unique: true });
passSchema.index({ qrToken: 1 }, { name: "index_passes_qrToken", unique: true });
passSchema.index({ backupCode: 1 }, { name: "index_passes_backupCode", unique: true });

passSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (document, plainObject) => {
    delete plainObject._id;
    return plainObject;
  },
});

const PassModel = mongoose.model("Pass", passSchema, "passes");

module.exports = { PassModel };
