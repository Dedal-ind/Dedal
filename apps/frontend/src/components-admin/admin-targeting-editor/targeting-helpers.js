// targeting-helpers.js
// Shape constants and pure helpers for the targeting predicate. Kept out of
// AdminTargetingEditor.jsx so that file only exports components (fast refresh).

export const DIMENSION_ORDER = ['collegeIds', 'cities', 'departments', 'yearsOfStudy', 'festIds'];

export const EMPTY_TARGETING = {
  include: { collegeIds: [], cities: [], departments: [], yearsOfStudy: [], festIds: [] },
  exclude: { collegeIds: [], cities: [], departments: [], yearsOfStudy: [], festIds: [] },
};

export function normaliseTargeting(raw) {
  const t = { include: {}, exclude: {} };
  for (const dim of DIMENSION_ORDER) {
    t.include[dim] = raw?.include?.[dim] ?? [];
    t.exclude[dim] = raw?.exclude?.[dim] ?? [];
  }
  return t;
}

export function isTargetingEmpty(targeting) {
  for (const dim of DIMENSION_ORDER) {
    if ((targeting.include[dim]?.length ?? 0) > 0) return false;
    if ((targeting.exclude[dim]?.length ?? 0) > 0) return false;
  }
  return true;
}
