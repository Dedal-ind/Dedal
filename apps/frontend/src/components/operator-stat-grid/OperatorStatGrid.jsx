// OperatorStatGrid.jsx
// The staff check-in numbers as cards: the number in display weight, the word
// for it below, and a compact "Download list" for that exact list at the foot.
//
// ONE COMPONENT FOR BOTH STAFF SCREENS. The coordinator event screen and the
// volunteer checkpoint screen show the same four numbers and download the same
// four lists. They used to render them two different ways — inline per card on
// the coordinator screen, and a separate four-button "Export" section on the
// volunteer screen — so the same fact looked different depending on which role
// you held. The download belongs with the number it lists, and now there is one
// place that says so.
//
// The stats themselves come from buildCheckInStats (helpers/check-in-stats.js),
// so the labels and download kinds cannot drift between the two screens either.

import { Download } from 'lucide-react';

function OperatorStatGrid({
  stats,
  onDownload,
  isDownloadDisabled = false,
  downloadLabel = 'Download list',
}) {
  return (
    <div className="dop-stats">
      {stats.map((stat) => (
        <div key={stat.key} className="dop-stat">
          <span className="dop-stat__value">{stat.value}</span>
          <span className="dop-stat__label">{stat.label}</span>
          {stat.download && onDownload ? (
            <button
              type="button"
              className="dop-btn dop-btn--sm dop-stat__action"
              disabled={isDownloadDisabled}
              onClick={() => onDownload(stat.download)}
              /* The visible text is the same on every card; the accessible name
                 says which list, so a screen reader does not hear four identical
                 "Download list" buttons. */
              aria-label={`Download the ${stat.label.toLowerCase()} list`}
            >
              <Download size={14} aria-hidden="true" />
              {downloadLabel}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export default OperatorStatGrid;
