// OperatorStatGrid.jsx
// The staff check-in numbers as compact cards: the number in display weight, the
// word for it below, and a download icon for that exact list in the corner.
//
// ONE COMPONENT FOR BOTH STAFF SCREENS. The coordinator event screen and the
// volunteer checkpoint screen show the same four numbers and download the same
// four lists, so they render them the same way: a 2x2 grid on a phone, four in
// a row on a desktop (design/operator-kit.css). The download belongs with the
// number it lists — as a 16px icon, not a text button, so the grid stays short
// enough that the scanner button is on screen without scrolling.
//
// The stats themselves come from buildCheckInStats (helpers/check-in-stats.js),
// so the labels and download kinds cannot drift between the two screens either.

import { Download } from 'lucide-react';

function OperatorStatGrid({ stats, onDownload, isDownloadDisabled = false }) {
  return (
    <div className="dop-stats">
      {stats.map((stat) => (
        <div key={stat.key} className="dop-stat">
          <span className="dop-stat__value">{stat.value}</span>
          <span className="dop-stat__label">{stat.label}</span>
          {stat.download && onDownload ? (
            <button
              type="button"
              className="dop-stat__action"
              disabled={isDownloadDisabled}
              onClick={() => onDownload(stat.download)}
              /* Icon only, so the accessible name says which list. */
              aria-label={`Download the ${stat.label.toLowerCase()} list`}
              title={`Download the ${stat.label.toLowerCase()} list`}
            >
              <Download size={16} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export default OperatorStatGrid;
