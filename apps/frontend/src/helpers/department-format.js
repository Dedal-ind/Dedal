// department-format.js
// Read-time display mapping for the department field. Early rows stored the
// kebab-case values of the old four-option <select>; there is no database
// migration — mapping those legacy slugs to proper labels here is the whole
// fix. Any other non-empty stored string is already the display value.

const LEGACY_DEPARTMENT_LABELS = {
  'computer-science': 'Computer Science',
  electronics: 'Electronics',
  mechanical: 'Mechanical',
  architecture: 'Architecture',
};

export function formatDepartmentLabel(storedDepartment) {
  if (typeof storedDepartment !== 'string' || storedDepartment.trim().length === 0) {
    return null;
  }
  return LEGACY_DEPARTMENT_LABELS[storedDepartment] ?? storedDepartment;
}
