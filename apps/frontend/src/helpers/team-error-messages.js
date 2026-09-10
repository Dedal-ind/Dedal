// team-error-messages.js
// Each backend error code the team create/join/lock endpoints can return, mapped
// to a specific, actionable message. Keyed on the ACTUAL codes the backend throws
// (see registration-guards + team-service). Falls back to the backend's own
// message, then a caller-supplied generic — so a single 403 is never flattened
// into the wrong reason. Shared by TeamManagementScreen and EventDetailScreen.

const TEAM_ERROR_MESSAGES = {
  PROFILE_INCOMPLETE: 'Complete your profile first, then create or join a team.',
  SOLO_REGISTRATION_REQUIRED: 'This event is solo-only. No team needed.',
  REGISTRATION_NOT_OPEN_YET: "Registration for this event hasn't opened yet.",
  REGISTRATION_CLOSED: 'Registration for this event has closed.',
  WRONG_COLLEGE: "This event isn't open to your college.",
  MEMBER_ALREADY_IN_TEAM: "You're already in a team for this event.",
  ALREADY_REGISTERED: "You're already registered for this event.",
  EVENT_FULL: 'This event has no capacity remaining.',
  EVENT_NOT_REGISTERABLE: "This event isn't open for registration.",
  FEST_NOT_REGISTERABLE: "This fest isn't open for registration.",
  ADMIN_CANNOT_REGISTER: "Administrator accounts can't create or join teams.",
  USER_BLOCKED: 'This account is blocked.',
  EVENT_NOT_FOUND: 'That event could not be found.',
  TEAM_NOT_FOUND: 'No team matches this invite code.',
  TEAM_NOT_ACCEPTING_MEMBERS: 'This team is no longer accepting members.',
  TEAM_FULL: 'This team is already full.',
  TEAM_LOCK_LEADER_ONLY: 'Only the team leader can lock the team.',
  MEDICAL_DECLARATION_REQUIRED:
    'This event requires the medical declaration. Accept it below and try again.',
};

export function formatTeamErrorMessage(error, fallback) {
  return TEAM_ERROR_MESSAGES[error?.code] || error?.message || fallback;
}
