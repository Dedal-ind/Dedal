// NoCrewAccessScreen.jsx
// Route: /backstage/no-access — where /backstage sends someone who taps
// Coordinator or Volunteer without holding that role.
//
// It said "Looks like you're not on the team... yet." over a large olive padlock
// in a tinted circle, with "earn your access" underneath. That is a marketing
// line on a permissions screen: it tells somebody standing in front of a locked
// door that they should feel motivated, and not one useful thing about who can
// open it. This states the fact and where the decision lives — the fest's own
// organising team — in two sentences, and drops the padlock, because an
// illustration of the problem adds nothing to the sentence describing it.
//
// The title goes to ScreenHeader, which pairs it with the back control and
// stands the app header down, so there is no second bar and no second heading.

import ScreenHeader from '../../components/screen-header/ScreenHeader.jsx';
import '../../design/backstage.css';

const COPY = {
  title: 'Crew access',
  line: 'You do not have crew access for this fest yet.',
  hint: 'Crew roles are given out by the team running the fest. Ask them to add you, and this opens up.',
};

function NoCrewAccessScreen() {
  return (
    <div className="dbk-screen">
      <ScreenHeader title={COPY.title} />

      <div className="dbk-locked">
        <p className="dbk-locked__line">{COPY.line}</p>
        <p className="dbk-locked__hint">{COPY.hint}</p>
      </div>
    </div>
  );
}

export default NoCrewAccessScreen;
