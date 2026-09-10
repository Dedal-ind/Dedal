// UserAvatar.jsx
// The one way a person is pictured across the app. Shows the Google photo when
// the account has one (profilePictureUrl, set by the Google sign-in path) and
// falls back to an initials monogram when it does not — email-OTP users, Google
// accounts with no photo, and any photo that fails to load.
//
// One shape: the Heritage Institutional soft circle — an olive fill with a white
// monogram and no border, as the top bar draws it. There used to be a second,
// hard-bordered square shape for the brutalist screens, selected by a `variant`
// prop; the brutalist system is gone, every call site had already moved to
// heritage, and the prop and its branch went with it.

import { useState } from 'react';
import { normalizeGooglePhotoUrl } from '../../helpers/google-photo-url.js';

// Rendered size in CSS pixels, with the type scale that fits inside each one.
const SIZES = {
  small: { pixels: 32, textClassName: 'text-[0.625rem]' },
  directory: { pixels: 48, textClassName: 'text-sm' },
  medium: { pixels: 56, textClassName: 'text-base' },
  large: { pixels: 72, textClassName: 'text-xl' },
};

function initialsOf(fullName) {
  return (
    (fullName || '?')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join('') || '?'
  );
}

function UserAvatar({ user, size = 'medium', className = '' }) {
  const { pixels, textClassName } = SIZES[size] ?? SIZES.medium;
  const photoUrl = user?.profilePictureUrl
    ? normalizeGooglePhotoUrl(user.profilePictureUrl, pixels)
    : null;

  /*
   * We remember WHICH url failed, not merely that one did. Once a photo 404s or
   * the network drops it, retrying it every render would flicker the monogram in
   * and out; keying on the url means a user who changes their Google photo gets
   * a fresh attempt instead of inheriting the old one's failure — and no effect
   * is needed to reset the flag.
   */
  const [failedPhotoUrl, setFailedPhotoUrl] = useState(null);
  const hasImageFailed = photoUrl !== null && photoUrl === failedPhotoUrl;

  const frameClassName = ['shrink-0 overflow-hidden rounded-pill', className]
    .filter(Boolean)
    .join(' ');
  const frameStyle = { width: `${pixels}px`, height: `${pixels}px` };

  if (photoUrl && !hasImageFailed) {
    return (
      <img
        src={photoUrl}
        // The name, not "profile picture": next to a row that already shows the
        // name this is decorative, and a screen reader reading both is noise.
        alt={user?.fullName || ''}
        width={pixels}
        height={pixels}
        style={frameStyle}
        onError={() => setFailedPhotoUrl(photoUrl)}
        className={[frameClassName, 'bg-surface-gray-light object-cover'].join(' ')}
      />
    );
  }

  return (
    <span
      style={frameStyle}
      className={[
        frameClassName,
        'flex items-center justify-center bg-olive-accent font-display font-bold text-on-tertiary',
        textClassName,
      ].join(' ')}
    >
      {initialsOf(user?.fullName)}
    </span>
  );
}

export default UserAvatar;
