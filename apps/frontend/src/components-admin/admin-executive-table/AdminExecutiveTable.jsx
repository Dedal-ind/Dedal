// AdminExecutiveTable.jsx
// A data table driven by a column spec rather than hand-written markup, so every
// table in the console shares one header treatment, one hover, and one alignment
// rule. Columns marked `numeric` render in the mono face and right-align: the
// point of the mono role is that digits line up down the column, which
// proportional type breaks.
//
// Column: { key, header, numeric?, width?, align?, render?(row, index) }

function cellValue(column, row, index) {
  if (typeof column.render === 'function') {
    return column.render(row, index);
  }
  return row[column.key];
}

function AdminExecutiveTable({
  columns,
  rows,
  rowKey = (row, index) => row.id ?? index,
  onRowClick,
  emptyMessage = 'Nothing to show yet.',
  /*
   * Opt-in vertical scrolling. Without it a long list simply grows and the last
   * rows can end up clipped by an ancestor or hidden under sticky chrome — the
   * "the panel doesn't scroll to the end" report. Passing a CSS length here
   * caps the body and scrolls INSIDE the card, with the header row pinned so
   * the columns stay readable while scrolling. Default is unchanged (grow).
   */
  maxBodyHeight,
  className = '',
}) {
  const hasRows = Array.isArray(rows) && rows.length > 0;

  return (
    <div
      className={['overflow-hidden rounded-lg border border-admin-slate-200 bg-admin-surface-white', className]
        .filter(Boolean)
        .join(' ')}
    >
      {/* Wide tables scroll inside their own container so the page never does;
          tall ones scroll vertically here too when maxBodyHeight is given. */}
      <div
        className={maxBodyHeight ? 'overflow-x-auto overflow-y-auto' : 'overflow-x-auto'}
        style={maxBodyHeight ? { maxHeight: maxBodyHeight } : undefined}
      >
        <table className="w-full border-collapse text-left">
          <thead>
            <tr
              className={[
                'border-b border-admin-slate-200 bg-admin-surface-off-white',
                // Pinned only when the body scrolls, so a normal table is untouched.
                maxBodyHeight ? 'sticky top-0 z-10' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  style={column.width ? { width: column.width } : undefined}
                  className={[
                    'px-4 py-3 font-admin-body text-[12px] font-semibold uppercase tracking-admin-label text-admin-slate-600',
                    column.numeric || column.align === 'right' ? 'text-right' : 'text-left',
                  ].join(' ')}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hasRows ? (
              rows.map((row, index) => (
                <tr
                  key={rowKey(row, index)}
                  onClick={onRowClick ? () => onRowClick(row, index) : undefined}
                  className={[
                    'border-b border-admin-slate-200 last:border-b-0 transition-colors',
                    onRowClick ? 'cursor-pointer hover:bg-admin-surface-off-white' : 'hover:bg-admin-surface-off-white',
                  ].join(' ')}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={[
                        'px-4 py-3 align-middle',
                        column.numeric
                          ? 'text-right font-admin-mono text-[13px] font-medium leading-[18px] tabular-nums text-admin-neutral-ink'
                          : 'font-admin-body text-[14px] leading-5 text-admin-neutral-ink',
                        !column.numeric && column.align === 'right' ? 'text-right' : '',
                      ].join(' ')}
                    >
                      {cellValue(column, row, index)}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-10 text-center font-admin-body text-[14px] text-admin-slate-600"
                >
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default AdminExecutiveTable;
