const { ApplicationError } = require("./application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { FEST_STATUSES } = require("../constants/fest-constants");
const { EVENT_STATUSES } = require("../constants/event-constants");

/*
 * Every rule about which event states permit which action, in one place. Each
 * guard either returns quietly or throws the 409 that names both the state it
 * found and the action it refused.
 */
function assertFestAcceptsNewEvents(fest) {
  if (fest.status === FEST_STATUSES.ARCHIVED) {
    throw new ApplicationError(
      409,
      ERROR_CODES.INVALID_FEST_STATE,
      "An archived fest cannot take new events.",
      { currentStatus: fest.status, attemptedAction: "createEvent" }
    );
  }
}

function assertEventEditable(event) {
  if (event.status === EVENT_STATUSES.CANCELLED) {
    throw new ApplicationError(
      409,
      ERROR_CODES.INVALID_EVENT_STATE,
      "A cancelled event cannot be edited.",
      { currentStatus: event.status, attemptedAction: "update" }
    );
  }
}

function assertEventPublishable(fest, event) {
  if (event.status !== EVENT_STATUSES.DRAFT) {
    throw new ApplicationError(
      409,
      ERROR_CODES.INVALID_EVENT_STATE,
      `A ${event.status} event cannot be published.`,
      { currentStatus: event.status, attemptedTransition: "publish" }
    );
  }

  // A published event inside an unpublished fest would leak once browsing exists.
  if (fest.status === FEST_STATUSES.DRAFT || fest.status === FEST_STATUSES.ARCHIVED) {
    throw new ApplicationError(
      409,
      ERROR_CODES.INVALID_FEST_STATE,
      `Cannot publish an event while the fest is ${fest.status}.`,
      { currentFestStatus: fest.status, attemptedTransition: "publish" }
    );
  }
}

function assertEventCancellable(event) {
  if (event.status === EVENT_STATUSES.CANCELLED) {
    throw new ApplicationError(
      409,
      ERROR_CODES.EVENT_ALREADY_CANCELLED,
      "This event is already cancelled.",
      { currentStatus: event.status, attemptedTransition: "cancel" }
    );
  }

  if (event.status === EVENT_STATUSES.COMPLETED) {
    throw new ApplicationError(
      409,
      ERROR_CODES.INVALID_EVENT_STATE,
      "A completed event cannot be cancelled.",
      { currentStatus: event.status, attemptedTransition: "cancel" }
    );
  }
}

module.exports = {
  assertFestAcceptsNewEvents,
  assertEventEditable,
  assertEventPublishable,
  assertEventCancellable,
};
