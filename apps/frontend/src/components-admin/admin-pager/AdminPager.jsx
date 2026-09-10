// AdminPager.jsx
// The "Showing 1–20 of 84 · Prev / Next" row under a paginated table, lifted
// verbatim from the user directory so every paginated list in the console
// pages the same way. Server-side or client-side makes no difference here:
// the caller owns `page` and `total` and this only renders and reports.
//
// Renders nothing when everything fits on one page.

import AdminExecutiveButton from '../admin-executive-button/AdminExecutiveButton.jsx';

function AdminPager({ page, limit, total, onPageChange, labels }) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  if (total <= limit) {
    return null;
  }
  const start = (currentPage - 1) * limit + 1;
  const end = Math.min(currentPage * limit, total);
  return (
    <div className="flex items-center justify-between px-4 pb-4">
      <span className="font-admin-mono text-[13px] text-admin-slate-600">
        {labels.showingRange(start, end, total)}
      </span>
      <div className="flex items-center gap-2">
        <AdminExecutiveButton
          variant="secondary"
          size="small"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
        >
          {labels.prev}
        </AdminExecutiveButton>
        <AdminExecutiveButton
          variant="secondary"
          size="small"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
        >
          {labels.next}
        </AdminExecutiveButton>
      </div>
    </div>
  );
}

export default AdminPager;
