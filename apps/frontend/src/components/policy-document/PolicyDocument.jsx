// PolicyDocument.jsx
// One legal document, fetched from the registry and rendered — used by the
// Terms of Service screen, the Privacy Policy screen, and the past-version
// screen. Give it a `kind` to show the version currently in effect, or a
// `versionId` to show one specific version exactly as it was accepted.
//
// NEVER BLANK. A legal page that silently renders empty is worse than one
// that says it could not load: somebody could tick a consent box against a
// blank screen. So the three non-content states are explicit — a static
// skeleton while loading, and a plain error/offline message with a retry —
// and the text only appears once the registry has answered.
//
// The version label and effective date sit above the text so a reader can
// see which wording they are looking at; a superseded version says so.
//
// This does not reuse the shared ScreenState/SkeletonBlock components: both
// still speak the retired Tailwind palette (surface-container, on-surface
// etc.) and Material Symbol ligatures, which this migration is removing, not
// spreading to a new screen. The states below are small enough to own here in
// tokens.

import { useCallback, useEffect, useState } from 'react';
import { useOnlineStatus } from '../../hooks/use-online-status/use-online-status.js';
import { AlertIcon, OfflineIcon, RetryIcon } from '../detail-icons/DetailIcons.jsx';
import { CONNECTION_COPY, POLICY_DOCUMENT_COPY as COPY } from '../../brand/brand-copy.js';
import {
  fetchEffectivePolicy,
  fetchPolicyVersion,
  formatPolicyDate,
  isNetworkError,
  parseMarkdownBlocks,
} from '../../helpers/policy-documents.js';

function DocumentSkeleton() {
  return (
    <div className="dpd-skeleton" role="status" aria-label={COPY.loading}>
      <div className="dpd-skeleton__bar dpd-skeleton__bar--meta" />
      <div className="dpd-skeleton__bar dpd-skeleton__bar--title dpd-skeleton__bar--gap" />
      <div className="dpd-skeleton__bar" style={{ width: '100%' }} />
      <div className="dpd-skeleton__bar" style={{ width: '92%' }} />
      <div className="dpd-skeleton__bar" style={{ width: '80%' }} />
      <div className="dpd-skeleton__bar" style={{ width: '55%', marginTop: 'var(--s5)' }} />
      <div className="dpd-skeleton__bar" style={{ width: '100%' }} />
      <div className="dpd-skeleton__bar" style={{ width: '84%' }} />
    </div>
  );
}

function DocumentProblem({ offline, onRetry }) {
  const Icon = offline ? OfflineIcon : AlertIcon;
  const headline = offline ? CONNECTION_COPY.offlineMessage : COPY.errorMessage;
  return (
    <div className="dpd-state" role="status">
      <span className="dpd-state__icon">
        <Icon size="md" />
      </span>
      <p className="dpd-state__message">{headline}</p>
      <button type="button" className="dpd-state__retry" onClick={onRetry}>
        <RetryIcon size="sm" />
        {CONNECTION_COPY.errorRetry}
      </button>
    </div>
  );
}

// The document markdown is a flat sequence of blocks — one "#" title, several
// "##" headings, paragraphs between them. There is exactly one title per
// document, so it renders as the single <h2> under the page's own <h1> (the
// screen's top-bar title); each "##" heading is the <h3> beneath it. That
// keeps the outline real for a screen reader instead of merely looking right.
function MarkdownBlocks({ text }) {
  const blocks = parseMarkdownBlocks(text);
  return blocks.map((block, index) => {
    if (block.type === 'title') {
      return (
        <h2 key={index} className="dpd-title">
          {block.text}
        </h2>
      );
    }
    if (block.type === 'heading') {
      return (
        <h3 key={index} className="dpd-heading">
          {block.text}
        </h3>
      );
    }
    return (
      <p key={index} className="dpd-paragraph">
        {block.lines.join('\n')}
      </p>
    );
  });
}

function PolicyDocument({ kind, versionId }) {
  const isOnline = useOnlineStatus();
  const [status, setStatus] = useState('loading');
  const [document, setDocument] = useState(null);
  const [errorIsNetwork, setErrorIsNetwork] = useState(false);

  const load = useCallback(async () => {
    setStatus('loading');
    setDocument(null);
    try {
      const payload = versionId ? await fetchPolicyVersion(versionId) : await fetchEffectivePolicy(kind);
      // A document with no text is a failure, whatever the status code said.
      if (!payload || typeof payload.text !== 'string' || payload.text.trim() === '') {
        throw new Error('empty document');
      }
      setDocument(payload);
      setStatus('ready');
    } catch (error) {
      setErrorIsNetwork(isNetworkError(error));
      setStatus('error');
    }
  }, [kind, versionId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (status === 'loading') {
    return <DocumentSkeleton />;
  }

  if (status === 'error') {
    const showOffline = !isOnline || errorIsNetwork;
    return <DocumentProblem offline={showOffline} onRetry={load} />;
  }

  return (
    <article className="dpd-article">
      <p className="dpd-version">
        <span className="dpd-version__label">{COPY.versionLabel(document.versionLabel)}</span>
        {' · '}
        {COPY.effectiveFrom(formatPolicyDate(document.effectiveAt))}
        {document.isEffective ? null : (
          <span className="dpd-version__superseded">{COPY.supersededNote}</span>
        )}
      </p>
      <MarkdownBlocks text={document.text} />
    </article>
  );
}

export default PolicyDocument;
