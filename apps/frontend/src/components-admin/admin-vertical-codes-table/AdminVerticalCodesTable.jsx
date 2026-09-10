// AdminVerticalCodesTable.jsx
// Per-vertical join-code usage for one contingent, so an admin can see at a
// glance which verticals still have seats on them.
//
// Rows are per (purchase × vertical), not per vertical: a contingent is bought
// once per visiting college, and each buyer holds their own codes and their own
// counters. Collapsing them into one row per vertical would add up strangers'
// claims and answer a question nobody asked.

import { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api-client/api-client.js';
import AdminExecutiveChip from '../admin-executive-chip/AdminExecutiveChip.jsx';
import { ADMIN_CONTINGENT_CODES_COPY as COPY } from '../../brand-admin/brand-copy.js';

function AdminVerticalCodesTable({ festId, contingentId }) {
  const [codes, setCodes] = useState([]);
  const [copiedId, setCopiedId] = useState('');

  const loadCodes = useCallback(async () => {
    try {
      const result = await apiClient.get(
        `/fests/${festId}/contingents/${contingentId}/vertical-codes`,
      );
      setCodes(Array.isArray(result) ? result : []);
    } catch {
      setCodes([]);
    }
  }, [festId, contingentId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadCodes();
  }, [loadCodes]);

  // Codes exist only once a purchase has been paid for, so an unsold contingent
  // shows nothing rather than an empty table that reads as a fault.
  if (codes.length === 0) {
    return null;
  }

  async function handleCopy(code) {
    try {
      await navigator.clipboard.writeText(code.inviteCode);
      setCopiedId(code.id);
    } catch {
      setCopiedId('');
    }
  }

  return (
    <div className="mt-4">
      <h4 className="font-admin-body text-[13px] font-semibold text-admin-neutral-ink">
        {COPY.tableTitle}
      </h4>

      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse">
          <thead>
            <tr className="border-b border-admin-slate-200 text-left">
              <th className="py-2 pr-3 font-admin-body text-[12px] font-semibold text-admin-slate-600">
                {COPY.columnVertical}
              </th>
              <th className="py-2 pr-3 font-admin-body text-[12px] font-semibold text-admin-slate-600">
                {COPY.columnCode}
              </th>
              <th className="py-2 pr-3 font-admin-body text-[12px] font-semibold text-admin-slate-600">
                {COPY.columnClaimed}
              </th>
              <th className="py-2 pr-3 font-admin-body text-[12px] font-semibold text-admin-slate-600">
                {COPY.columnCapacity}
              </th>
              <th className="py-2 font-admin-body text-[12px] font-semibold text-admin-slate-600">
                {COPY.columnStatus}
              </th>
            </tr>
          </thead>
          <tbody>
            {codes.map((code) => {
              const isFull = code.remainingSlots === 0;
              return (
                <tr key={code.id} className="border-b border-admin-slate-200/60">
                  <td className="py-2 pr-3 font-admin-body text-[13px] text-admin-neutral-ink">
                    {code.eventName}
                  </td>
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-2">
                      <code className="font-admin-mono text-[13px] text-admin-neutral-ink">
                        {code.inviteCode}
                      </code>
                      <button
                        type="button"
                        onClick={() => handleCopy(code)}
                        aria-label={COPY.copyCodeFor(code.eventName)}
                        className="rounded px-1.5 py-0.5 font-admin-body text-[11px] font-semibold text-admin-primary-blue transition-colors hover:bg-admin-surface-off-white"
                      >
                        {copiedId === code.id ? COPY.copied : COPY.copy}
                      </button>
                    </div>
                  </td>
                  <td className="py-2 pr-3 font-admin-mono text-[13px] text-admin-slate-600">
                    {code.claimedCount}
                  </td>
                  <td className="py-2 pr-3 font-admin-mono text-[13px] text-admin-slate-600">
                    {code.maxClaims}
                  </td>
                  <td className="py-2">
                    <AdminExecutiveChip tone={isFull ? 'neutral' : 'info'}>
                      {isFull ? COPY.statusFull : COPY.statusActive}
                    </AdminExecutiveChip>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default AdminVerticalCodesTable;
