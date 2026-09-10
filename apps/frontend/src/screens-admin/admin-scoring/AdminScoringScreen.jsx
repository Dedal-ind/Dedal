// AdminScoringScreen.jsx
// Route: /admin/events/scoring — the CERTIFICATE desk. The route id still says
// "scoring" so every existing deep link and cross-link resolves; the screen has
// not been about scoring for a while and is now only about certificates.
//
// WHAT WAS REMOVED, AND WHY. This screen used to carry the admin's own scoring
// workflow: initialize the score rows, type a number per registration, finalize
// the sheet, award results. All of that is gone.
//
// Entering marks is the COORDINATOR's job. They are in the hall and they watched
// the performance; an admin typing a number from a WhatsApp message is a second
// source of truth for the same fact, and the two drifted in exactly the way two
// sources of truth always do. There is no "initialize" here now (a coordinator's
// round sheet needs no admin to open it) and no "finalize" (a mark is final when
// the coordinator saves it). Reading the result, and correcting a wrong cell,
// moved to the result board — /admin/events/results-board — where the marks are
// laid out round by round and the correction is made in place.
//
// So what is left is the one thing that was always genuinely the admin's: the
// certificate. Pick the fest and event, and the desk below does the rest.

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { LayoutList } from 'lucide-react';
import apiClient from '../../api-client/api-client.js';
import AdminHierarchyFilter from '../../components-admin/admin-hierarchy-filter/AdminHierarchyFilter.jsx';
import { useAdminHierarchyScope } from '../../hooks/useAdminHierarchyScope.js';
import AdminExecutiveCard from '../../components-admin/admin-executive-card/AdminExecutiveCard.jsx';
import AdminCertificatesSection from './AdminCertificatesSection.jsx';

const COPY = {
  pageTitle: 'Certificates',
  intro:
    'Choose an event, set its certificate artwork, and pick who receives one. Pushing generates the certificates and releases them to their owners.',
  selectPrompt: 'Choose a fest and an event to set up its certificates.',
  loadError: 'Your fests could not be loaded. Try again.',
  resultsBoardLink: 'Result board',
};

function AdminScoringScreen() {
  const [searchParameters] = useSearchParams();
  const [status, setStatus] = useState('loading');
  const [fests, setFests] = useState([]);
  /*
   * The shared cascade owns fest + event + sub-event. The certificate TARGET is
   * whichever of event/sub-event is deepest, so the event id is derived rather
   * than held separately — one selection, one target.
   */
  const { scope, handleScopeChange, setScope, activeEventId } = useAdminHierarchyScope(
    searchParameters.get('festId') ?? '',
  );
  const festId = scope.festId;

  useEffect(() => {
    let isActive = true;
    apiClient
      .get('/fests/mine')
      .then((list) => {
        if (!isActive) {
          return;
        }
        const safe = Array.isArray(list) ? list : [];
        setFests(safe);
        setScope((previous) => ({
          ...previous,
          festId: previous.festId || (safe.length === 1 ? safe[0].id : ''),
        }));
        setStatus('ready');
      })
      .catch(() => isActive && setStatus('error'));
    return () => {
      isActive = false;
    };
  }, [setScope]);

  if (status === 'loading') {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <span
          aria-label="Loading"
          className="h-6 w-6 animate-spin rounded-full border-2 border-admin-slate-200 border-t-admin-primary-blue"
        />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <AdminExecutiveCard>
        <p className="py-6 font-admin-body text-[14px] text-admin-slate-600">{COPY.loadError}</p>
      </AdminExecutiveCard>
    );
  }

  return (
    <div className="mx-auto flex max-w-[1000px] flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="mt-1 max-w-prose font-admin-body text-[14px] leading-5 text-admin-slate-600">
            {COPY.intro}
          </p>
        </div>
        {/* Winners on the checklist come from the board, so the board is where
            an admin goes to check or correct one. */}
        <Link
          to={festId ? `/admin/events/results-board?festId=${festId}` : '/admin/events/results-board'}
          className="inline-flex shrink-0 items-center gap-1 font-admin-body text-[13px] font-medium text-admin-primary-blue underline"
        >
          <LayoutList size={14} />
          {COPY.resultsBoardLink}
        </Link>
      </div>

      <AdminHierarchyFilter
        fests={fests}
        selectedFestId={scope.festId}
        selectedEventId={scope.eventId}
        selectedSubEventId={scope.subEventId}
        onChange={handleScopeChange}
        className="sticky top-0 z-10 bg-admin-surface-off-white py-2"
      />

      {!festId || !activeEventId ? (
        <AdminExecutiveCard>
          <p className="py-6 font-admin-body text-[14px] text-admin-slate-600">{COPY.selectPrompt}</p>
        </AdminExecutiveCard>
      ) : (
        <AdminCertificatesSection festId={festId} eventId={activeEventId} />
      )}
    </div>
  );
}

export default AdminScoringScreen;
