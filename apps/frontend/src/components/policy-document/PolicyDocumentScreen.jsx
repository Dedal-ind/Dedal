// PolicyDocumentScreen.jsx
// The page frame the three policy routes share: the top bar with the back
// control, and PolicyDocument as the body. The back control's behaviour is
// the one the old hardcoded screens had — these pages open in a NEW TAB from
// the profile form, where there is no history, so a script-opened tab is
// closed and a direct visit falls through to home.

import { useTransitionNavigate } from '../route-transition/use-transition-navigate.js';
import { BackIcon } from '../detail-icons/DetailIcons.jsx';
import PolicyDocument from './PolicyDocument.jsx';

function PolicyDocumentScreen({ title, kind, versionId }) {
  const navigate = useTransitionNavigate();

  return (
    <div className="dpd-screen">
      <header className="dpd-topbar">
        <button
          type="button"
          onClick={() => {
            if (window.history.length <= 1) {
              window.close();
              setTimeout(() => navigate('/', { replace: true }), 150);
            } else {
              navigate(-1);
            }
          }}
          className="dpd-topbar__back"
          aria-label="Go back"
        >
          <BackIcon size="md" />
        </button>
        <h1 className="dpd-topbar__title">{title}</h1>
      </header>

      <main className="dpd-main">
        <div className="dpd-measure">
          <PolicyDocument kind={kind} versionId={versionId} />
        </div>
      </main>
    </div>
  );
}

export default PolicyDocumentScreen;
