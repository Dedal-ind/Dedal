const express = require("express");

const { asyncHandler } = require("../middleware/async-handler");
const staffContactService = require("../services/staff-contact-service");

/*
 * Public: the event page's CONTACT block is shown to visitors before they sign
 * in (the event page itself is public). The service exposes only names, roles
 * and the single RESOLVED contactPhone — nothing else about the staff member.
 */
const publicEventStaffRouter = express.Router({ mergeParams: true });

publicEventStaffRouter.get(
  "/",
  asyncHandler(async (request, response) => {
    const result = await staffContactService.listEventStaffContacts(request.params.eventId);
    return response.status(200).json({ data: result });
  })
);

module.exports = { publicEventStaffRouter };
