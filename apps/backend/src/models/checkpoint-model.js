const mongoose = require("mongoose");
const {
  CHECKPOINT_TYPES,
  CHECKPOINT_DIRECTION_MODES,
} = require("../constants/scan-constants");

/*
 * A place a scan happens. A gate belongs to the whole fest (eventId null); an
 * eventEntry belongs to one event. directionMode decides whether the checkpoint
 * records exits as well as entries — a gate is inAndOut, an event door inOnly.
 */
const checkpointSchema = new mongoose.Schema(
  {
    festId: { type: mongoose.Schema.Types.ObjectId, ref: "Fest", required: true },

    // null means a fest-level gate that no single event owns.
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", default: null },

    /*
     * Points at a fest.offers subdocument _id; set ONLY on OFFER checkpoints.
     * An offer's checkpoint is deactivated (never deleted) when the offer is
     * removed — scans is append-only and every scan row carries checkpointId,
     * so deleting would orphan the gate audit trail.
     */
    offerId: { type: mongoose.Schema.Types.ObjectId, default: null },

    checkpointName: { type: String, required: true, trim: true },
    checkpointType: {
      type: String,
      required: true,
      enum: Object.values(CHECKPOINT_TYPES),
    },
    directionMode: {
      type: String,
      required: true,
      enum: Object.values(CHECKPOINT_DIRECTION_MODES),
      default: CHECKPOINT_DIRECTION_MODES.IN_ONLY,
    },
    isActive: { type: Boolean, required: true, default: true },

    /*
     * Exempts this checkpoint from the Main-Gate-first rule.
     *
     * Every event door and offer counter refuses a pass whose holder has not
     * crossed the Main Gate today — you cannot be at a food counter inside the
     * campus without having entered it. TRAVEL breaks that assumption and is why
     * this flag exists: a travel desk scans people ONTO the bus that brings them
     * to campus, so by definition the participant has not entered yet. Enforcing
     * the rule there would make the shuttle unusable for exactly the people it
     * exists to carry.
     *
     * A FLAG ON THE CHECKPOINT, not a name match on the offer. Deciding
     * exemption by testing whether an offer's name contains "travel" would mean
     * a fest that calls its shuttle "Campus Shuttle" or "Bus Pass" silently
     * loses the exemption, and a fest that runs a "Travel Mug" merch stall
     * silently gains it — a security rule decided by free text an admin typed.
     * The offer key is still used to SET this flag on materialisation (see
     * checkpoint-helpers), so the common case needs no admin action, but the
     * stored flag is what the scan reads and an admin can correct it.
     */
    isExemptFromGateCheck: { type: Boolean, required: true, default: false },
  },
  { timestamps: true }
);

checkpointSchema.index({ festId: 1 }, { name: "index_checkpoints_festId" });
checkpointSchema.index({ eventId: 1 }, { name: "index_checkpoints_eventId" });
checkpointSchema.index({ festId: 1, offerId: 1 }, { name: "index_checkpoints_festId_offerId" });

checkpointSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (document, plainObject) => {
    delete plainObject._id;
    return plainObject;
  },
});

const CheckpointModel = mongoose.model("Checkpoint", checkpointSchema, "checkpoints");

module.exports = { CheckpointModel };
