// college-options.js
// The "Other" choice in the college picker: a student whose college is not on
// the platform yet selects it and types the name instead. The profile then
// sends otherCollegeName rather than a collegeId.

export const OTHER_COLLEGE_OPTION = 'other';
export const OTHER_COLLEGE_LABEL = 'Other — my college isn’t listed';
export const OTHER_COLLEGE_NAME_MIN_LENGTH = 2;
export const OTHER_COLLEGE_NAME_MAX_LENGTH = 120;

/* The PATCH /users/me college fields for whichever the student chose. */
export function buildCollegePayload(collegeId, otherCollegeName) {
  if (collegeId === OTHER_COLLEGE_OPTION) {
    return { otherCollegeName: otherCollegeName.trim() };
  }
  return { collegeId, otherCollegeName: null };
}

/* Whether the college part of the profile is filled in. */
export function isCollegeChoiceComplete(collegeId, otherCollegeName) {
  if (collegeId === OTHER_COLLEGE_OPTION) {
    const length = otherCollegeName.trim().length;
    return length >= OTHER_COLLEGE_NAME_MIN_LENGTH && length <= OTHER_COLLEGE_NAME_MAX_LENGTH;
  }
  return collegeId !== '';
}
