// ContingentCodeCard.jsx
// One shareable contingent code: which event it is for, the code, whether it
// goes to one person or a whole team, where it stands, and — for a team code —
// who has joined so far.
//
// Copy is the same gesture for solo and team codes. The icon morphs to a tick
// for 1.5s and a polite live region says it happened, because a swapped glyph
// is silent to a screen reader.

import InviteCodeShare from '../invite-code-share/InviteCodeShare.jsx';
import { describeContingentCode } from '../../helpers/contingent-code-status.js';
import '../../design/contingent-codes.css';

function ContingentCodeCard({ entry, shareTitle = '' }) {
  const described = describeContingentCode(entry);

  return (
    <li className="dcc-card">
      <div className="dcc-card__head">
        <p className="dcc-card__event">{described.label}</p>
        <span className={`dcc-status dcc-status--${described.tone}`}>{described.statusText}</span>
      </div>

      <InviteCodeShare
        code={described.code}
        label={described.label}
        shareTitle={shareTitle}
        isDead={!described.canCopy}
      />

      <p className="dcc-card__hint">{described.hint}</p>

      {described.isTeam && (described.roster.length > 0 || described.spotsText) ? (
        <div className="dcc-roster">
          {described.roster.length > 0 ? (
            <ul className="dcc-roster__list">
              {described.roster.map((member) => (
                <li className="dcc-roster__member" key={member.key}>
                  <span>{member.name}</span>
                  {member.isCaptain ? <span className="dcc-roster__role">Captain</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
          {described.spotsText ? <p className="dcc-roster__spots">{described.spotsText}</p> : null}
        </div>
      ) : null}

    </li>
  );
}

export default ContingentCodeCard;
