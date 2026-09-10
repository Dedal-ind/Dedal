const mongoose = require("mongoose");
const { OFFER_SCOPES } = require("../constants/fest-constants");

/*
 * A PAID add-on purchase made against a registration that is ALREADY CONFIRMED —
 * the participant joined a team by code, took their seat, and is now buying food
 * or accommodation on top of it.
 *
 * WHY THIS IS NOT JUST A SECOND REGISTRATION ROW.
 *
 * The registration payment path works by holding rows in PENDING and confirming
 * them when the money lands. That shape cannot express this purchase: the row is
 * already CONFIRMED and its seat is already taken, so pushing it back to PENDING
 * to reuse the machinery would un-confirm a seat the participant holds and hand
 * the expiry sweep licence to release it. Somebody buying a meal would risk
 * losing their place in the event.
 *
 * So the intent is parked HERE while the payment is in flight, and the
 * registration is not touched until the money is captured. If the payment never
 * lands, this row simply stays pending and the registration is exactly as it was.
 *
 * The selections are stored RESOLVED (already run through resolveOfferSelections
 * against the live offer list) so the price the participant was quoted is the
 * price that is applied — an admin editing an offer's rate mid-checkout must not
 * silently change what is delivered.
 */
const addOnOrderSchema = new mongoose.Schema(
  {
    registrationId: { type: mongoose.Schema.Types.ObjectId, ref: "Registration", required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    festId: { type: mongoose.Schema.Types.ObjectId, ref: "Fest", required: true },
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true },
    /* Shared with the PaymentOrder row, exactly as a registration group's is. */
    paymentGroupId: { type: String, required: true },

    offerSelections: {
      type: [
        new mongoose.Schema(
          {
            offerId: { type: mongoose.Schema.Types.ObjectId, required: true },
            offerKey: { type: String, required: true, trim: true },
            scope: {
              type: String,
              enum: Object.values(OFFER_SCOPES),
              required: true,
              default: OFFER_SCOPES.FEST,
            },
            numberOfPeople: { type: Number, min: 0, required: true, default: 1 },
            numberOfDays: { type: Number, min: 0, required: true, default: 1 },
          },
          { _id: false }
        ),
      ],
      default: [],
    },

    /* The add-ons alone, in integer paise. Platform fee and GST are added by the order. */
    amountPaise: { type: Number, required: true, min: 0 },

    status: {
      type: String,
      required: true,
      enum: ["pending", "completed", "cancelled"],
      default: "pending",
    },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

addOnOrderSchema.index({ paymentGroupId: 1 }, { name: "index_addOnOrders_paymentGroupId" });
addOnOrderSchema.index(
  { registrationId: 1, status: 1 },
  { name: "index_addOnOrders_registrationId_status" }
);

addOnOrderSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (document, plainObject) => {
    delete plainObject._id;
    return plainObject;
  },
});

const AddOnOrderModel = mongoose.model("AddOnOrder", addOnOrderSchema, "addOnOrders");

module.exports = { AddOnOrderModel };
