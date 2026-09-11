// AdminBroadcastScreen.jsx
// Route: /admin/broadcast — the admin's megaphone.
//
// Pick a fest, optionally narrow to one event, pick an audience, type a
// message, send. The backend resolves the audience (confirmed participants,
// active coordinator/volunteer assignments, or the union of all three deduped)
// and delivers IN-APP notifications (the participant's bell feed), reporting
// exactly how many landed.
//
// TWO SCOPES, DECIDED BY WHETHER AN EVENT IS SELECTED.
//
// Selecting an event sends to that event. Selecting only the FEST sends to the
// whole fest, through a different endpoint that resolves every event's audience
// once and deduplicates it. That second scope used to be missing, and the only
// way to reach a whole fest was to pick each event in turn and send the same
// message again — which meant a participant registered for four events got the
// same announcement four times, each titled after a different event, and
// missing one event silently left part of the fest uninformed.
//
// The scope is therefore stated on screen and in the button label, never
// inferred quietly: the difference between these two buttons can be two orders
// of magnitude of recipients, and it is not recoverable once pressed.

import { useEffect, useState } from 'react';
import { Send } from 'lucide-react';
import apiClient from '../../api-client/api-client.js';
import AdminHierarchyFilter from '../../components-admin/admin-hierarchy-filter/AdminHierarchyFilter.jsx';
import { useAdminHierarchyScope } from '../../hooks/useAdminHierarchyScope.js';
import AdminExecutiveCard from '../../components-admin/admin-executive-card/AdminExecutiveCard.jsx';
import AdminExecutiveButton from '../../components-admin/admin-executive-button/AdminExecutiveButton.jsx';
import AdminErrorBanner from '../../components-admin/admin-error-banner/AdminErrorBanner.jsx';

const MESSAGE_MAXIMUM_LENGTH = 2000;

// Local copy — deliberately not in brand-admin/brand-copy.js.
const COPY = {
  pageTitle: 'Broadcast Message',
  intro:
    'Send an in-app announcement to a fest or to a single event — confirmed participants, assigned staff, or everyone at once. It appears in their notification feed.',
  chooseFest: 'Choose a fest above to compose a broadcast.',
  scopeFestTitle: 'Sending to the entire fest',
  scopeFestBody:
    'Everyone in the selected audience across every event of this fest. Each person is messaged once, however many events they are in.',
  /* Named by the filter directly above, not repeated here: /fests/mine does
     not carry an event list, and the filter fetches its own. Restating the name
     would mean a second request for a string the reader can already see. */
  scopeEventTitle: 'Sending to the selected event only',
  scopeEventBody: 'Only the selected audience for this event.',
  scopeHint: 'Select an event above to narrow this to a single event.',
  recipientsLegend: 'Send to',
  messageLabel: 'Message',
  messagePlaceholder: 'Type the announcement exactly as it should appear in their notifications…',
  sendButtonEvent: 'SEND BROADCAST',
  sendButtonFest: 'SEND TO ENTIRE FEST',
  sendFailed: 'The broadcast could not be sent. Try again.',
  successLine: (sent) => `Message sent to ${sent} recipient${sent === 1 ? '' : 's'}.`,
  failedSuffix: (failed) => ` ${failed} deliver${failed === 1 ? 'y' : 'ies'} failed.`,
};

const RECIPIENT_OPTIONS = [
  { value: 'participants', label: 'Participants' },
  { value: 'coordinators', label: 'Coordinators' },
  { value: 'volunteers', label: 'Volunteers' },
  { value: 'all', label: 'All' },
];

function AdminBroadcastScreen() {
  const { scope, handleScopeChange } = useAdminHierarchyScope();
  const festId = scope.festId;
  // A sub-event is itself an event; when one is picked it IS the target.
  const targetEventId = scope.subEventId || scope.eventId;

  const [fests, setFests] = useState([]);
  const [recipientType, setRecipientType] = useState('participants');
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [sendResult, setSendResult] = useState(null);

  useEffect(() => {
    let isActive = true;
    apiClient
      // The admin fest list is /fests/mine — a bare /fests does not exist.
      .get('/fests/mine')
      .then((result) => isActive && setFests(Array.isArray(result) ? result : result?.fests ?? []))
      .catch(() => isActive && setFests([]));
    return () => {
      isActive = false;
    };
  }, []);

  const trimmedMessage = message.trim();
  /*
   * An event is a NARROWING, not a requirement. A fest with no event selected
   * is the fest-wide scope, which is why the send no longer waits on
   * targetEventId — that condition was the whole reason a fest-wide
   * announcement had to be faked by sending once per event.
   */
  const isFestWide = Boolean(festId) && !targetEventId;
  const canSend = Boolean(festId && trimmedMessage) && !isSending;

  async function handleSend() {
    if (!canSend) {
      return;
    }
    setIsSending(true);
    setSendError('');
    setSendResult(null);
    try {
      /* Two endpoints, not one endpoint with a flag: the fest-wide send has no
         event to name, and hanging it off an arbitrary :eventId would file a
         fest-wide announcement in one event's audit trail. */
      const route = isFestWide
        ? `/fests/${festId}/broadcast`
        : `/fests/${festId}/events/${targetEventId}/broadcast`;
      const result = await apiClient.post(route, {
        recipientType,
        message: trimmedMessage,
      });
      setSendResult(result);
      setMessage('');
    } catch (error) {
      setSendError(error?.message || COPY.sendFailed);
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-6">
      <div>
        <p className="mt-1 font-admin-body text-[14px] leading-5 text-admin-slate-600">
          {COPY.intro}
        </p>
      </div>

      <AdminHierarchyFilter
        fests={fests}
        selectedFestId={scope.festId}
        selectedEventId={scope.eventId}
        selectedSubEventId={scope.subEventId}
        onChange={handleScopeChange}
      />

      <AdminErrorBanner message={sendError} />

      {!festId ? (
        <AdminExecutiveCard>
          <p className="py-6 font-admin-body text-[14px] text-admin-slate-600">{COPY.chooseFest}</p>
        </AdminExecutiveCard>
      ) : (
        <AdminExecutiveCard>
          <div className="flex flex-col gap-5">
            {/*
              THE BLAST RADIUS, STATED BEFORE THE MESSAGE BOX. This is the one
              control on the screen the admin does not set directly — it comes
              from the filter above — so it is the one most easily misread, and
              it is the difference between forty recipients and four thousand.
            */}
            <div
              className={[
                'rounded-md border px-3 py-2.5',
                isFestWide
                  ? 'border-admin-primary-blue/30 bg-admin-primary-blue/5'
                  : 'border-admin-slate-200 bg-admin-surface-off-white',
              ].join(' ')}
            >
              <p className="font-admin-body text-[13px] font-semibold text-admin-neutral-ink">
                {isFestWide ? COPY.scopeFestTitle : COPY.scopeEventTitle}
              </p>
              <p className="mt-0.5 font-admin-body text-[13px] leading-[18px] text-admin-slate-600">
                {isFestWide ? COPY.scopeFestBody : COPY.scopeEventBody}
              </p>
              {isFestWide ? (
                <p className="mt-1 font-admin-body text-[12px] text-admin-slate-600">
                  {COPY.scopeHint}
                </p>
              ) : null}
            </div>

            <fieldset>
              <legend className="pb-2 font-admin-body text-[12px] font-semibold uppercase tracking-admin-label text-admin-slate-600">
                {COPY.recipientsLegend}
              </legend>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                {RECIPIENT_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className="flex cursor-pointer items-center gap-2 font-admin-body text-[14px] text-admin-neutral-ink"
                  >
                    <input
                      type="radio"
                      name="broadcast-recipient-type"
                      value={option.value}
                      checked={recipientType === option.value}
                      onChange={() => setRecipientType(option.value)}
                      className="h-4 w-4 accent-admin-primary-blue"
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </fieldset>

            <div>
              <label
                htmlFor="broadcast-message"
                className="block pb-2 font-admin-body text-[12px] font-semibold uppercase tracking-admin-label text-admin-slate-600"
              >
                {COPY.messageLabel}
              </label>
              <textarea
                id="broadcast-message"
                rows={7}
                maxLength={MESSAGE_MAXIMUM_LENGTH}
                value={message}
                onChange={(changeEvent) => setMessage(changeEvent.target.value)}
                placeholder={COPY.messagePlaceholder}
                className="w-full resize-y rounded-md border border-admin-slate-200 bg-admin-surface-white px-3 py-2 font-admin-body text-[14px] leading-5 text-admin-neutral-ink outline-none placeholder:text-admin-slate-600/60 focus:border-admin-primary-blue"
              />
              <p className="mt-1 text-right font-admin-mono text-[11px] text-admin-slate-600">
                {message.length}/{MESSAGE_MAXIMUM_LENGTH}
              </p>
            </div>

            {sendResult ? (
              <p className="font-admin-body text-[14px] font-medium text-admin-status-success-green">
                {COPY.successLine(sendResult.sent ?? 0)}
                {sendResult.failed > 0 ? (
                  <span className="text-admin-status-error-red">
                    {COPY.failedSuffix(sendResult.failed)}
                  </span>
                ) : null}
              </p>
            ) : null}

            <div>
              <AdminExecutiveButton
                onClick={handleSend}
                disabled={!canSend}
                loading={isSending}
                iconLeft={<Send size={15} />}
              >
                {isFestWide ? COPY.sendButtonFest : COPY.sendButtonEvent}
              </AdminExecutiveButton>
            </div>
          </div>
        </AdminExecutiveCard>
      )}
    </div>
  );
}

export default AdminBroadcastScreen;
