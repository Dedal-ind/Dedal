// EditProfileScreen.jsx
// Route: /profile/edit — the profile form as a page.
//
// THIS SCREEN IS NOW A FRAME, NOT A FORM. The 400 lines of fields, validation
// and PATCH that used to be here moved to ProfileFieldSet.jsx, which /settings
// renders inside its inline expand. What is left is the page furniture the
// route needs — a heading, a back affordance, the centred column — around the
// same component.
//
// WHY THE ROUTE SURVIVES AT ALL, given the brief folds editing into settings:
// it is linked from outside this screen's control. The profile-completion flow
// lands people here, notification payloads carry the path, and it is the kind
// of URL people bookmark. Deleting it would 404 all of that. Redirecting it to
// /settings was the alternative, and was rejected because a deep link that
// dumps you at the top of a settings page with the editor closed has lost the
// thing you followed the link for.
//
// What was NOT acceptable was keeping both copies. Two implementations of one
// form drift — that is not a hypothetical here, it is why the registration
// surface needed rebuilding — so there is exactly one field set and both mount
// points render it.
//
// After a save this returns to /profile, which is where the previous version
// went and is where the person came from.

import { useNavigate } from 'react-router-dom';
import ScreenHeader from '../../components/screen-header/ScreenHeader.jsx';
import ProfileFieldSet from './ProfileFieldSet.jsx';
import '../settings/settings.css';

const COPY = {
  title: 'Edit profile',
  note: 'Changes are saved to your account and show on every pass and registration.',
};

function EditProfileScreen() {
  const navigate = useNavigate();

  return (
    <div className="dst-screen">
      {/* The floating back control. The column below clears it. */}
      <ScreenHeader title={COPY.title} />

      <div className="dst-col dst-col--under-chrome">
        <p className="dst-help">{COPY.note}</p>

        {/*
         * The save returns to /profile, but only AFTER the confirmation stroke
         * has had time to draw — navigating on the same tick would unmount the
         * confirmation before anybody saw it, which is the same as not
         * confirming. 1.44s is the stroke's own length.
         */}
        <ProfileFieldSet
          onSaved={() => {
            window.setTimeout(() => navigate('/profile'), 1440);
          }}
        />
      </div>
    </div>
  );
}

export default EditProfileScreen;
