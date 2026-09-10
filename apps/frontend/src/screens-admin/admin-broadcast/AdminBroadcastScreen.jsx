// AdminBroadcastScreen.jsx
// Route: /admin/broadcast — the admin's megaphone for one event.
//
// Pick a fest and event, pick an audience, type a message, send. The backend
// resolves the audience (confirmed participants, active coordinator/volunteer
// assignments covering the event, or the union of all three deduped) and
// delivers IN-APP notifications (the participant's bell feed), reporting
// exactly how many landed.

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
    'Send an in-app announcement to the people of one event — its confirmed participants, its assigned staff, or everyone at once. It appears in their notification feed.',
  chooseFest: 'Choose a fest and event above to compose a broadcast.',
  recipientsLegend: 'Send to',
  messageLabel: 'Message',
  messagePlaceholder: 'Type the announcement exactly as it should appear in their notifications…',
  sendButton: 'SEND BROADCAST',
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
  const canSend = Boolean(festId && targetEventId && trimmedMessage) && !isSending;

  async function handleSend() {
    if (!canSend) {
      return;
    }
    setIsSending(true);
    setSendError('');
    setSendResult(null);
    try {
      const result = await apiClient.post(`/fests/${festId}/events/${targetEventId}/broadcast`, {
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

      {!targetEventId ? (
        <AdminExecutiveCard>
          <p className="py-6 font-admin-body text-[14px] text-admin-slate-600">{COPY.chooseFest}</p>
        </AdminExecutiveCard>
      ) : (
        <AdminExecutiveCard>
          <div className="flex flex-col gap-5">
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
                {COPY.sendButton}
              </AdminExecutiveButton>
            </div>
          </div>
        </AdminExecutiveCard>
      )}
    </div>
  );
}

export default AdminBroadcastScreen;
